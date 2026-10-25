"""
Date-driven installment logic.

* sync_payment_statuses()  - sets OVERDUE / DUE / UPCOMING on every unpaid installment
                             from its due date and today's date.
* generate_monthly_dues()  - makes sure every active ticket has its installments up to
                             (and including) next calendar month, until the scheme's duration.
* run_daily_maintenance()  - runs both, at most once per calendar day per server process.
"""
import calendar
import datetime
import threading
from decimal import Decimal

from django.db import transaction

from .models import AuctionScheme, MonthlyPayment, Ticket

_lock = threading.Lock()
_last_run = None


def _parse(value):
    try:
        return datetime.datetime.strptime(str(value)[:10], '%Y-%m-%d').date()
    except (ValueError, TypeError):
        return None


def _add_month(d, day=None):
    """Same day next month (clamped to the month length), optionally forcing the day."""
    year = d.year + (1 if d.month == 12 else 0)
    month = 1 if d.month == 12 else d.month + 1
    want = day or d.day
    return datetime.date(year, month, min(want, calendar.monthrange(year, month)[1]))


def effective_status(due_date, today=None):
    """OVERDUE / DUE / UPCOMING for an unpaid installment."""
    today = today or datetime.date.today()
    due = _parse(due_date)
    if due is None:
        return None
    if due < today:
        return 'OVERDUE'
    if (due.year, due.month) <= (today.year, today.month):
        return 'DUE'
    return 'UPCOMING'


def sync_payment_statuses(today=None):
    """Bulk-update the stored status of unpaid installments from the calendar."""
    today = today or datetime.date.today()
    today_s = today.strftime('%Y-%m-%d')
    next_month_s = _add_month(today.replace(day=1)).strftime('%Y-%m-%d')

    unpaid = MonthlyPayment.objects.exclude(status='PAID')
    changed = 0
    changed += unpaid.filter(due_date__lt=today_s).exclude(status='OVERDUE').update(status='OVERDUE')
    changed += (unpaid.filter(due_date__gte=today_s, due_date__lt=next_month_s)
                .exclude(status='DUE').update(status='DUE'))
    changed += (unpaid.filter(due_date__gte=next_month_s)
                .exclude(status='UPCOMING').update(status='UPCOMING'))
    return changed


@transaction.atomic
def generate_monthly_dues(today=None, due_day=None):
    """
    For every ticket of an active scheme, create the missing installments so that one exists
    for the current calendar month and the next one (shown as UPCOMING). The new due date is
    the previous installment's due date plus one month (or `due_day` of that month if given).
    Returns the number of installments created.
    """
    today = today or datetime.date.today()
    horizon = _add_month(today.replace(day=1))  # first day of next month
    created = 0

    tickets = Ticket.objects.select_related('scheme', 'user').filter(scheme__status='active')
    for ticket in tickets:
        scheme = ticket.scheme
        last = (MonthlyPayment.objects.filter(ticket=ticket).order_by('-month_number').first())
        if last is None:
            continue  # tickets with no payment history are handled at enrollment
        month_no = last.month_number
        due = _parse(last.due_date)
        if due is None:
            continue
        while month_no < scheme.duration_months:
            nxt_due = _add_month(due, due_day)
            if (nxt_due.year, nxt_due.month) > (horizon.year, horizon.month):
                break
            month_no += 1
            _, was_created = MonthlyPayment.objects.get_or_create(
                id=f"PAY-{ticket.id}-M{month_no}",
                defaults={
                    'ticket': ticket,
                    'scheme': scheme,
                    'user': ticket.user,
                    'month_number': month_no,
                    'month_name': f"Month {month_no}",
                    'base_amount': scheme.monthly_installment,
                    'dividend_discount': Decimal('0.00'),
                    'net_payable': scheme.monthly_installment,
                    'due_date': nxt_due.strftime('%Y-%m-%d'),
                    'status': effective_status(nxt_due, today) or 'UPCOMING',
                },
            )
            created += int(was_created)
            due = nxt_due

    # Keep each scheme's running month in step with the installments that have started.
    for scheme in AuctionScheme.objects.filter(status='active'):
        started = (MonthlyPayment.objects.filter(scheme=scheme, due_date__lt=horizon.strftime('%Y-%m-%d'))
                   .order_by('-month_number').values_list('month_number', flat=True).first())
        if started and started > scheme.current_month:
            scheme.current_month = min(started, scheme.duration_months)
            scheme.save(update_fields=['current_month'])
    return created


def run_daily_maintenance(force=False):
    """Run generation + status sync once per calendar day (cheap to call on every request)."""
    global _last_run
    today = datetime.date.today()
    if not force and _last_run == today:
        return
    with _lock:
        if not force and _last_run == today:
            return
        generate_monthly_dues(today)
        sync_payment_statuses(today)
        _last_run = today