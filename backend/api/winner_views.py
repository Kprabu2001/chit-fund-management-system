"""
Offline-auction endpoints (admin only).

The auction itself happens in person. Afterwards the admin picks the winning ticket and
enters the discount here:

  POST /api/auctions/declare-winner/   {scheme_id, ticket_id, discount_amount, dry_run?}
        dry_run=true  -> validate + return a confirmation summary and warnings, change nothing
        dry_run=false -> conclude the month via finalize_auction()
  POST /api/auctions/revert-winner/    {scheme_id, reason?}
        undo the latest declaration, allowed only while its payout is still PENDING
"""
from decimal import Decimal, InvalidOperation

from django.db import transaction
from rest_framework import permissions, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from .auction_service import (
    calculate_auction_distribution, dividend_recipients, finalize_auction,
)
from .models import (
    AuctionCorrection, AuctionRecord, AuctionRound, AuctionScheme, MonthlyPayment,
    PaymentLedgerEntry, Ticket,
)
from .serializers import AuctionRecordSerializer
from .views import _is_admin


def _err(message, code=status.HTTP_400_BAD_REQUEST):
    return Response({'error': message}, status=code)


def _parse_discount(raw):
    try:
        value = Decimal(str(raw).strip())
        if not value.is_finite():
            raise InvalidOperation
    except (InvalidOperation, ValueError, TypeError):
        return None
    return value.quantize(Decimal('0.01'))


def next_month_to_declare(scheme):
    """The month awaiting a winner = one after the latest declared month (1 if none yet)."""
    last = (AuctionRecord.objects.filter(scheme=scheme)
            .order_by('-month_number').values_list('month_number', flat=True).first())
    return (last or 0) + 1


def _unpaid_this_month(scheme, month):
    """Tickets with no PAID installment for `month` (a missing row counts as unpaid)."""
    paid_ids = set(MonthlyPayment.objects.filter(
        scheme=scheme, month_number=month, status='PAID'
    ).values_list('ticket_id', flat=True))
    return [t for t in scheme.tickets.select_related('user').order_by('ticket_number') if t.pk not in paid_ids]


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def declare_winner_view(request):
    if not _is_admin(request):
        return _err('Permission denied: Only administrators can declare a winner.', status.HTTP_403_FORBIDDEN)

    scheme_id = request.data.get('scheme_id')
    ticket_id = request.data.get('ticket_id')
    dry_run = str(request.data.get('dry_run', '')).lower() in ('1', 'true', 'yes')
    if not scheme_id or not ticket_id:
        return _err('scheme_id and ticket_id are required.')

    discount = _parse_discount(request.data.get('discount_amount'))
    if discount is None or discount <= 0:
        return _err('discount_amount must be a positive number.')

    admin_profile = getattr(request.user, 'profile', None)

    with transaction.atomic():
        scheme = AuctionScheme.objects.select_for_update().filter(pk=scheme_id).first()
        if not scheme:
            return _err(f'Scheme {scheme_id} not found.', status.HTTP_404_NOT_FOUND)
        if scheme.status == 'completed':
            return _err('This scheme is completed; there is no month left to declare.')
        if scheme.booked_slots < scheme.total_slots:
            return _err(
                f'Pool is not full ({scheme.booked_slots}/{scheme.total_slots} slots filled). '
                'All slots must be booked before a winner can be declared.'
            )

        month = next_month_to_declare(scheme)
        if month > scheme.duration_months:
            return _err('Every month of this scheme already has a declared winner.')

        ticket = Ticket.objects.select_for_update().select_related('user').filter(pk=ticket_id).first()
        if not ticket or ticket.scheme_id != scheme.id:
            return _err('That ticket does not belong to this scheme.')
        if ticket.has_won_auction or ticket.status != 'active':
            return _err(f'Ticket #{ticket.ticket_number} has already won and cannot win again.')

        min_amt, max_amt = scheme.get_min_bid_amount(), scheme.get_max_bid_amount()
        if discount < min_amt or discount > max_amt:
            return _err(
                f'Discount must be between ₹{min_amt:,.2f} ({scheme.min_bid_discount}%) and '
                f'₹{max_amt:,.2f} ({scheme.max_bid_discount}%) for this scheme.'
            )

        recipients = dividend_recipients(scheme, ticket)
        distribution = calculate_auction_distribution(scheme, discount, len(recipients))

        unpaid = _unpaid_this_month(scheme, month)
        winner_unpaid = any(t.pk == ticket.pk for t in unpaid)
        others_unpaid = [t for t in unpaid if t.pk != ticket.pk]
        warnings = []
        if winner_unpaid:
            warnings.append(f"The winner ({ticket.user.name}, ticket #{ticket.ticket_number}) has not paid Month {month}.")
        if others_unpaid:
            warnings.append(f"{len(others_unpaid)} other member(s) have not paid Month {month}.")

        summary = {
            'scheme_id': scheme.id,
            'scheme_name': scheme.name,
            'month_number': month,
            'winner_ticket_id': ticket.id,
            'winner_ticket_number': ticket.ticket_number,
            'winner_name': ticket.user.name,
            'total_chit_value': float(distribution['total_chit_value']),
            'winning_discount': float(distribution['winning_discount']),
            'organizer_commission': float(distribution['commission']),
            'distributable_dividend': float(distribution['distributable_dividend']),
            'eligible_count': distribution['eligible_count'],
            'dividend_per_member': float(distribution['dividend_per_member']),
            'winner_payout': float(distribution['winner_payout']),
            'winner_paid_this_month': not winner_unpaid,
            'unpaid_members': [
                {'ticket_id': t.id, 'ticket_number': t.ticket_number, 'name': t.user.name}
                for t in unpaid
            ],
        }

        if dry_run:
            return Response({'dry_run': True, 'summary': summary, 'warnings': warnings})

        round_obj, _ = AuctionRound.objects.select_for_update().get_or_create(
            id=f'ROUND-{scheme.id}-M{month}',
            defaults={
                'scheme': scheme,
                'month_number': month,
                'highest_discount_bid': discount,
                'leader_name': ticket.user.name,
                'is_active': True,
            },
        )
        if round_obj.is_concluded:
            return _err(f'Month {month} has already been concluded.')

        round_obj.highest_discount_bid = discount
        round_obj.leader_name = ticket.user.name
        round_obj.leader_ticket = ticket
        round_obj.is_active = True
        round_obj.save()

        result = finalize_auction(round_obj, ticket, discount, admin_profile)

    payout = result['payout']
    return Response({
        'message': f"Winner declared for {scheme.name}, Month {month}: {ticket.user.name} (ticket #{ticket.ticket_number}).",
        'summary': summary,
        'warnings': warnings,
        'winner': ticket.user.name,
        'winning_discount': float(distribution['winning_discount']),
        'winner_payout': float(distribution['winner_payout']),
        'dividend_per_member': float(distribution['dividend_per_member']),
        'auction_record': AuctionRecordSerializer(result['auction_record']).data,
        'payout': {'id': payout.id, 'status': payout.status, 'amount': float(payout.amount)},
    }, status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def revert_winner_view(request):
    """Undo the latest declared winner of a scheme. Only while the prize payout is still PENDING
    and nobody has paid the following month's (dividend-adjusted) installment."""
    if not _is_admin(request):
        return _err('Permission denied: Only administrators can correct a winner.', status.HTTP_403_FORBIDDEN)

    scheme_id = request.data.get('scheme_id')
    reason = str(request.data.get('reason', '') or '').strip()
    if not scheme_id:
        return _err('scheme_id is required.')
    admin_profile = getattr(request.user, 'profile', None)

    with transaction.atomic():
        scheme = AuctionScheme.objects.select_for_update().filter(pk=scheme_id).first()
        if not scheme:
            return _err(f'Scheme {scheme_id} not found.', status.HTTP_404_NOT_FOUND)

        record = AuctionRecord.objects.filter(scheme=scheme).order_by('-month_number').first()
        if not record:
            return _err('No declared winner to correct in this scheme.')

        payout = getattr(record, 'payout', None)
        if payout is None:
            return _err('This result has no prize payout record and cannot be corrected here.')
        if payout.status != 'PENDING':
            return _err('The prize has already been marked Paid, so the winner can no longer be changed.')

        next_month = record.month_number + 1
        next_payments = list(MonthlyPayment.objects.select_for_update().filter(scheme=scheme, month_number=next_month))
        if any(p.status == 'PAID' for p in next_payments):
            return _err(
                f'Some members have already paid Month {next_month} at the dividend-adjusted amount, '
                'so this result can no longer be changed.'
            )

        ticket = record.winner_ticket

        # Take the dividend back off next month's unpaid installments (append-only ledger: add reversals)
        for p in next_payments:
            if p.dividend_discount > Decimal('0.00'):
                removed = p.dividend_discount
                p.dividend_discount = Decimal('0.00')
                p.net_payable = p.base_amount
                p.save(update_fields=['dividend_discount', 'net_payable'])
                PaymentLedgerEntry.objects.create(
                    payment=p, user=p.user, ticket=p.ticket,
                    entry_type='DIVIDEND_ADJUSTMENT', amount=-removed,
                    previous_status=p.status, new_status=p.status,
                    transaction_ref=f"DIV-REV-{scheme.id}-M{record.month_number}",
                    performed_by=admin_profile,
                    notes=f"Month #{record.month_number} winner corrected; dividend discount reversed",
                )

        AuctionCorrection.objects.create(
            scheme=scheme, month_number=record.month_number,
            old_winner_ticket_id=ticket.id, old_winner_name=record.winner_user.name,
            old_discount=record.winning_discount, old_net_prize=record.net_prize_payout,
            reason=reason, corrected_by=admin_profile,
        )

        ticket.has_won_auction = False
        ticket.won_month = None
        ticket.won_payout = None
        ticket.status = 'active'
        ticket.save()

        round_obj = AuctionRound.objects.select_for_update().filter(
            scheme=scheme, month_number=record.month_number).first()
        if round_obj:
            round_obj.is_active = True
            round_obj.is_concluded = False
            round_obj.concluded_at = None
            round_obj.leader_ticket = None
            round_obj.leader_name = 'Awaiting Bids'
            round_obj.highest_discount_bid = scheme.get_min_bid_amount()
            round_obj.save()

        month = record.month_number
        payout.delete()
        record.delete()

        scheme.current_month = month
        if scheme.status == 'completed':
            scheme.status = 'active'
        scheme.save()

    return Response({
        'message': f'Winner for Month {month} removed. Declare the correct winner now.',
        'month_number': month,
    })