"""
Prize payout endpoints (offline auction: the admin pays the winner outside the app).

  GET  /api/auctions/payouts/                  admin: all payouts; member: only their own (limited fields)
  GET  /api/auctions/payouts/<id>/             admin only: payout panel (winner's saved UPI / bank details)
  POST /api/auctions/payouts/<id>/mark-paid/   admin only: record method + UTR, status -> PAID, ledger entry
  POST /api/auctions/payouts/<id>/remind/      admin only: nudge a winner who has no payout details saved
                                               (the member's "details missing" notification is derived from
                                               details_missing, so it disappears once they save their details)

Payout details live on the member's profile. They are returned to admins only and are never
copied onto the payout; only a masked destination is kept for the audit trail.
"""
import re
import datetime
from django.db import transaction
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from .models import AuctionRecord, MonthlyPayment, PrizePayout, PrizePayoutLedgerEntry
from .views import IsAdminUserRole

UPI_ID_RE = re.compile(r'^[A-Za-z0-9._-]{2,256}@[A-Za-z]{2,64}$')
IFSC_RE = re.compile(r'^[A-Z]{4}0[A-Z0-9]{6}$')
ACCOUNT_RE = re.compile(r'^\d{9,18}$')
UTR_RE = re.compile(r'^[A-Za-z0-9/_-]{6,40}$')


# ---- helpers shared with the notification code -------------------------------------------
def profile_has_upi(profile):
    return bool(UPI_ID_RE.match((profile.upi_id or '').strip()))


def profile_has_bank(profile):
    return bool(
        (profile.bank_account_holder or '').strip()
        and ACCOUNT_RE.match((profile.bank_account_number or '').strip())
        and IFSC_RE.match((profile.bank_ifsc or '').strip().upper())
    )


def profile_has_payout_details(profile):
    """One method is enough: a valid UPI ID OR a complete bank account."""
    return profile_has_upi(profile) or profile_has_bank(profile)


def mask_upi(value):
    value = (value or '').strip()
    if '@' not in value:
        return value
    name, handle = value.split('@', 1)
    return f"{name[:2]}{'•' * max(1, len(name) - 2)}@{handle}"


def mask_account(value):
    value = (value or '').strip()
    return '•' * max(0, len(value) - 4) + value[-4:]


def destination_label(profile, method):
    if method == 'UPI':
        return f"UPI {mask_upi(profile.upi_id)}"
    return f"A/c {mask_account(profile.bank_account_number)} · {(profile.bank_ifsc or '').upper()}"


def upi_uri(profile, amount, note):
    """UPI deep link (also the QR payload). Only built when the winner has a valid UPI ID."""
    if not profile_has_upi(profile):
        return ''
    from urllib.parse import quote
    return (f"upi://pay?pa={quote(profile.upi_id.strip())}&pn={quote(profile.name)}"
            f"&am={amount:.2f}&cu=INR&tn={quote(note)}")


def _admin_row(p):
    prof = p.user
    return {
        'id': p.id, 'scheme': p.scheme_id, 'scheme_name': p.scheme.name,
        'ticket_id': p.ticket_id, 'ticket_number': p.ticket.ticket_number,
        'user_id': prof.id, 'winner_name': prof.name,
        'month_number': p.month_number, 'amount': float(p.amount),
        'status': p.status, 'utr': p.utr, 'method': p.method, 'destination': p.destination,
        'paid_at': p.paid_at, 'paid_by_name': p.paid_by.name if p.paid_by else None,
        'created_at': p.created_at,
        'details_missing': p.status == 'PENDING' and not profile_has_payout_details(prof),
        'details_reminder_sent_at': p.details_reminder_sent_at,
        'details_reminder_count': p.details_reminder_count,
    }


def _member_row(p):
    """What the winning member may see: status, amount, UTR once paid. Never other members' data."""
    return {
        'id': p.id, 'scheme': p.scheme_id, 'scheme_name': p.scheme.name,
        'ticket_id': p.ticket_id, 'month_number': p.month_number, 'amount': float(p.amount),
        'status': p.status,
        'utr': p.utr if p.status == 'PAID' else '',
        'paid_at': p.paid_at,
        'details_missing': p.status == 'PENDING' and not profile_has_payout_details(p.user),
        'details_reminder_sent_at': p.details_reminder_sent_at,
    }


def _is_admin_request(request):
    profile = getattr(request.user, 'profile', None)
    return request.user.is_staff or bool(profile and profile.role == 'admin')


# ---- endpoints ----------------------------------------------------------------------------
@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def payout_list_view(request):
    qs = PrizePayout.objects.select_related('scheme', 'ticket', 'user', 'paid_by')
    if _is_admin_request(request):
        if request.query_params.get('scheme_id'):
            qs = qs.filter(scheme_id=request.query_params['scheme_id'])
        if request.query_params.get('status'):
            qs = qs.filter(status=request.query_params['status'].upper())
        return Response([_admin_row(p) for p in qs])
    profile = getattr(request.user, 'profile', None)
    if not profile:
        return Response([])
    return Response([_member_row(p) for p in qs.filter(user=profile)])


@api_view(['GET'])
@permission_classes([IsAdminUserRole])
def payout_detail_view(request, payout_id):
    p = PrizePayout.objects.select_related('scheme', 'ticket', 'user', 'paid_by').filter(pk=payout_id).first()
    if not p:
        return Response({'error': 'Payout not found.'}, status=status.HTTP_404_NOT_FOUND)
    prof = p.user
    has_upi, has_bank = profile_has_upi(prof), profile_has_bank(prof)
    note = f"Chit prize {p.scheme.name} month {p.month_number}"
    return Response({
        'payout': _admin_row(p),
        'winner': {
            'name': prof.name, 'phone': prof.phone, 'ticket_number': p.ticket.ticket_number,
            'upi_id': prof.upi_id or '',
            'bank_account_holder': prof.bank_account_holder or '',
            'bank_account_number': prof.bank_account_number or '',
            'bank_ifsc': (prof.bank_ifsc or '').upper(),
            'has_upi': has_upi, 'has_bank': has_bank, 'has_any_details': has_upi or has_bank,
            'suggested_method': 'UPI' if has_upi else ('BANK' if has_bank else ''),
        },
        'upi_uri': upi_uri(prof, p.amount, note) if p.status == 'PENDING' else '',
        'warning': None if (has_upi or has_bank) else
                   f"{prof.name} has not saved a UPI ID or bank account. Use Remind member, or collect the details and ask them to save them in their profile.",
        'ledger': [
            {'id': l.id, 'entry_type': l.entry_type, 'amount': float(l.amount), 'method': l.method,
             'destination': l.destination, 'transaction_ref': l.transaction_ref, 'notes': l.notes,
             'performed_by_name': l.performed_by.name if l.performed_by else None, 'created_at': l.created_at}
            for l in p.ledger_entries.select_related('performed_by')
        ],
    })


@api_view(['POST'])
@permission_classes([IsAdminUserRole])
def payout_mark_paid_view(request, payout_id):
    """Body: utr (required), method ('UPI'|'BANK', required), notes (optional).
    The destination paid to is the winner's profile details for that method; the admin cannot
    mark a payout paid to a method the winner has no valid details for."""
    method = str(request.data.get('method', '')).upper()
    utr = str(request.data.get('utr', '')).strip()
    notes = str(request.data.get('notes', '') or '').strip()[:300]
    admin_profile = getattr(request.user, 'profile', None)

    if method not in ('UPI', 'BANK'):
        return Response({'error': "method must be 'UPI' or 'BANK'."}, status=status.HTTP_400_BAD_REQUEST)
    if not UTR_RE.match(utr):
        return Response({'error': 'Enter the UTR / transaction reference (6-40 letters, digits, - _ /).'},
                        status=status.HTTP_400_BAD_REQUEST)

    with transaction.atomic():
        p = PrizePayout.objects.select_for_update().select_related('scheme', 'user').filter(pk=payout_id).first()
        if not p:
            return Response({'error': 'Payout not found.'}, status=status.HTTP_404_NOT_FOUND)
        if p.status == 'PAID':
            return Response({'error': 'This prize is already marked as paid.'}, status=status.HTTP_400_BAD_REQUEST)

        prof = p.user
        ok = profile_has_upi(prof) if method == 'UPI' else profile_has_bank(prof)
        if not ok:
            return Response({
                'error': f"{prof.name} has no valid {'UPI ID' if method == 'UPI' else 'bank account'} saved. "
                         "Ask them to add it in their profile first."
            }, status=status.HTTP_400_BAD_REQUEST)

        if PrizePayout.objects.filter(utr__iexact=utr).exclude(pk=p.pk).exists():
            return Response({'error': 'This UTR / reference has already been used for another payout.'},
                            status=status.HTTP_400_BAD_REQUEST)

        p.status = 'PAID'
        p.utr = utr
        p.method = method
        p.destination = destination_label(prof, method)
        p.notes = notes
        p.paid_by = admin_profile
        p.paid_at = timezone.now()
        p.save()

        PrizePayoutLedgerEntry.objects.create(
            payout=p, entry_type='PAID', amount=p.amount, method=method,
            destination=p.destination, transaction_ref=utr, performed_by=admin_profile, notes=notes,
        )

    return Response({
        'message': f"Prize of ₹{p.amount:,.2f} marked as paid to {prof.name}.",
        'payout': _admin_row(p),
    })


REMINDER_COOLDOWN = datetime.timedelta(minutes=30)


@api_view(['POST'])
@permission_classes([IsAdminUserRole])
def payout_remind_view(request, payout_id):
    """Remind a winner to add their UPI / bank details. Only while the payout is PENDING and the
    winner still has no valid details; limited to one reminder per 30 minutes."""
    admin_profile = getattr(request.user, 'profile', None)
    with transaction.atomic():
        p = PrizePayout.objects.select_for_update().select_related('user').filter(pk=payout_id).first()
        if not p:
            return Response({'error': 'Payout not found.'}, status=status.HTTP_404_NOT_FOUND)
        if p.status != 'PENDING':
            return Response({'error': 'This prize has already been paid.'}, status=status.HTTP_400_BAD_REQUEST)
        if profile_has_payout_details(p.user):
            return Response({'error': f'{p.user.name} has already saved payout details.'}, status=status.HTTP_400_BAD_REQUEST)

        now = timezone.now()
        if p.details_reminder_sent_at and now - p.details_reminder_sent_at < REMINDER_COOLDOWN:
            mins = int((REMINDER_COOLDOWN - (now - p.details_reminder_sent_at)).total_seconds() // 60) + 1
            return Response({'error': f'A reminder was sent recently. You can remind again in about {mins} min.'},
                            status=status.HTTP_429_TOO_MANY_REQUESTS)

        p.details_reminder_sent_at = now
        p.details_reminder_count += 1
        p.save(update_fields=['details_reminder_sent_at', 'details_reminder_count'])
        PrizePayoutLedgerEntry.objects.create(
            payout=p, entry_type='REMINDER', amount=p.amount, performed_by=admin_profile,
            notes='Asked winner to add UPI / bank details',
        )
    return Response({'message': f'Reminder sent to {p.user.name}.', 'payout': _admin_row(p)})


RESULTS_WINDOW_DAYS = 30


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def auction_results_view(request):
    """Monthly auction results for the chits the caller belongs to (recent months only).

    Every member of a chit gets the public result of its auction: month, winning ticket and name,
    discount and dividend per member, plus THEIR OWN dividend and new next-month due. It never
    includes prize payout status, UTR or anyone's payout details (those stay admin / winner only).
    Admins see all results without personal figures.
    """
    since = timezone.now() - datetime.timedelta(days=RESULTS_WINDOW_DAYS)
    qs = AuctionRecord.objects.select_related('scheme', 'winner_ticket', 'winner_user').filter(concluded_at__gte=since)
    profile = getattr(request.user, 'profile', None)
    is_admin = _is_admin_request(request)

    my_tickets = {}
    if not is_admin:
        if not profile:
            return Response([])
        for t in profile.tickets.all():
            my_tickets.setdefault(t.scheme_id, []).append(t)
        qs = qs.filter(scheme_id__in=list(my_tickets))

    rows = []
    for r in qs.order_by('-concluded_at'):
        row = {
            'id': r.id, 'scheme': r.scheme_id, 'scheme_name': r.scheme.name,
            'month_number': r.month_number, 'concluded_at': r.concluded_at,
            'winner_name': r.winner_user.name, 'winner_ticket_number': r.winner_ticket.ticket_number,
            'winning_discount': float(r.winning_discount),
            'dividend_per_member': float(r.dividend_per_member),
        }
        mine = my_tickets.get(r.scheme_id, [])
        if mine:
            nxt = {p.ticket_id: p for p in MonthlyPayment.objects.filter(
                ticket__in=mine, month_number=r.month_number + 1)}
            row['i_won'] = any(t.pk == r.winner_ticket_id for t in mine)
            row['my_dividend'] = float(sum(p.dividend_discount for p in nxt.values()))
            row['my_next_due'] = float(sum(p.net_payable for p in nxt.values())) if nxt else None
            row['my_ticket_count'] = len(mine)
        rows.append(row)
    return Response(rows)
