"""
Shared auction-conclusion logic.

The offline-auction "Declare Winner" flow (winner_views.declare_winner_view) finishes a month
through finalize_auction(), so dividends, next-month dues, the audit record and the
prize payout are computed in exactly one place.
"""
import datetime
from decimal import Decimal, ROUND_DOWN, ROUND_HALF_UP

from django.utils import timezone

from .models import (
    AuctionRecord, AuctionScheme, MonthlyPayment, PaymentLedgerEntry, PrizePayout,
)


def calculate_auction_distribution(scheme: AuctionScheme, winning_discount: Decimal, eligible_count: int):
    """
    Computes exact, statutory-compliant chit fund dividend distribution.
    eligible_count is passed in from the caller (number of non-prized, paying members).
    - Commission = Total Value * (Commission % / 100)
    - Distributable Dividend = Winning Discount - Commission
    - Dividend per Member = floor(Distributable / eligible_count) to 2 decimal places
    - Remainder = Distributable - (Dividend per Member * eligible_count)
    - Net Prize Payout = Total Value - Winning Discount
    """
    total_val = Decimal(str(scheme.total_value))
    win_disc = Decimal(str(winning_discount))
    comm_pct = Decimal(str(scheme.commission_percent))

    commission = (total_val * (comm_pct / Decimal('100.00'))).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    distributable = max(Decimal('0.00'), win_disc - commission)

    safe_count = max(1, eligible_count)
    dividend_per_member = (distributable / Decimal(str(safe_count))).quantize(Decimal('0.01'), rounding=ROUND_DOWN)
    remainder = distributable - (dividend_per_member * Decimal(str(safe_count)))
    winner_payout = total_val - win_disc

    return {
        'total_chit_value': total_val,
        'winning_discount': win_disc,
        'commission': commission,
        'distributable_dividend': distributable,
        'eligible_count': safe_count,
        'dividend_per_member': dividend_per_member,
        'remainder': remainder,
        'winner_payout': winner_payout,
    }


def dividend_recipients(scheme: AuctionScheme, winning_ticket):
    """Non-prized tickets share the dividend; the winner is excluded unless the scheme says otherwise."""
    non_prized = list(scheme.tickets.filter(has_won_auction=False))
    if scheme.winner_dividend_eligible:
        return non_prized
    return [t for t in non_prized if t.pk != winning_ticket.pk]


def payout_id_for(scheme_id, month_number):
    return f"PAYOUT-{scheme_id}-M{month_number}"


def finalize_auction(round_obj, winning_ticket, winning_discount, performed_by):
    """
    Conclude `round_obj` with the given winner and discount. MUST be called inside
    transaction.atomic() with the round row already locked (select_for_update).

    - closes the round and marks the ticket prized
    - writes the immutable AuctionRecord
    - creates next month's installments with the dividend applied (never touching PAID ones)
    - creates the winner's PrizePayout (PENDING)
    - advances the scheme to the next month (or completes it)

    Returns a dict: distribution, auction_record, payout, winner_user.
    """
    scheme = round_obj.scheme
    winner_user = winning_ticket.user

    recipients = dividend_recipients(scheme, winning_ticket)
    distribution = calculate_auction_distribution(scheme, winning_discount, len(recipients))

    round_obj.is_active = False
    round_obj.is_concluded = True
    round_obj.concluded_at = timezone.now()
    round_obj.save()

    winning_ticket.has_won_auction = True
    winning_ticket.won_month = round_obj.month_number
    winning_ticket.won_payout = distribution['winner_payout']
    winning_ticket.status = 'prized'
    winning_ticket.save()

    auction_record, _ = AuctionRecord.objects.get_or_create(
        id=f"REC-AUC-{scheme.id}-M{round_obj.month_number}",
        defaults={
            'scheme': scheme,
            'month_number': round_obj.month_number,
            'winner_ticket': winning_ticket,
            'winner_user': winner_user,
            'total_chit_value': distribution['total_chit_value'],
            'winning_discount': distribution['winning_discount'],
            'organizer_commission': distribution['commission'],
            'distributable_dividend': distribution['distributable_dividend'],
            'eligible_members_count': distribution['eligible_count'],
            'dividend_per_member': distribution['dividend_per_member'],
            'rounding_remainder': distribution['remainder'],
            'net_prize_payout': distribution['winner_payout'],
            'concluded_by': performed_by,
        },
    )

    payout, _ = PrizePayout.objects.get_or_create(
        id=payout_id_for(scheme.id, round_obj.month_number),
        defaults={
            'auction_record': auction_record,
            'scheme': scheme,
            'ticket': winning_ticket,
            'user': winner_user,
            'month_number': round_obj.month_number,
            'amount': distribution['winner_payout'],
        },
    )

    next_month = round_obj.month_number + 1
    if next_month <= scheme.duration_months:
        recipient_ids = {t.pk for t in recipients}
        for tkt in scheme.tickets.all():
            member_div = distribution['dividend_per_member'] if tkt.pk in recipient_ids else Decimal('0.00')
            payment_obj, created = MonthlyPayment.objects.get_or_create(
                id=f"PAY-{tkt.id}-M{next_month}",
                defaults={
                    'ticket': tkt,
                    'scheme': scheme,
                    'user': tkt.user,
                    'month_number': next_month,
                    'month_name': f"Month {next_month}",
                    'base_amount': scheme.monthly_installment,
                    'dividend_discount': member_div,
                    'net_payable': max(Decimal('0.00'), scheme.monthly_installment - member_div),
                    'due_date': (datetime.date.today() + datetime.timedelta(days=30)).strftime('%Y-%m-%d'),
                    'status': 'DUE',
                },
            )

            applied = created
            if not created and payment_obj.status != 'PAID' and payment_obj.dividend_discount != member_div:
                # The daily dues generator may already have created this installment without
                # the dividend. Apply it now; a PAID installment is never touched.
                payment_obj.dividend_discount = member_div
                payment_obj.net_payable = max(Decimal('0.00'), payment_obj.base_amount - member_div)
                payment_obj.save(update_fields=['dividend_discount', 'net_payable'])
                applied = member_div > Decimal('0.00')

            if applied and member_div > Decimal('0.00'):
                PaymentLedgerEntry.objects.create(
                    payment=payment_obj,
                    user=tkt.user,
                    ticket=tkt,
                    entry_type='DIVIDEND_ADJUSTMENT',
                    amount=member_div,
                    previous_status=payment_obj.status,
                    new_status=payment_obj.status,
                    transaction_ref=f"DIV-{scheme.id}-M{round_obj.month_number}",
                    receipt_number=None,
                    performed_by=performed_by,
                    notes=f"Month #{round_obj.month_number} auction dividend discount applied to Month #{next_month} installment",
                )

    # Advance the scheme (never move backwards if the dues generator already ran ahead)
    if round_obj.month_number >= scheme.duration_months:
        scheme.status = 'completed'
    else:
        scheme.current_month = max(scheme.current_month, round_obj.month_number + 1)
    scheme.save()

    return {
        'distribution': distribution,
        'auction_record': auction_record,
        'payout': payout,
        'winner_user': winner_user,
    }