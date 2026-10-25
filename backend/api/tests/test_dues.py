import datetime
from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase

from api.dues import effective_status, generate_monthly_dues, sync_payment_statuses
from api.models import AuctionScheme, MonthlyPayment, Ticket, UserProfile, ValueTier


class DueDateLogicTests(TestCase):
    def setUp(self):
        u = User.objects.create_user(username='m@x.com', email='m@x.com', password='p')
        self.profile = UserProfile.objects.create(id='usr_t', user=u, name='M', email='m@x.com', phone='9000000000', role='user')
        tier = ValueTier.objects.create(id='bronze', name='Bronze', range_label='x',
                                        min_val=Decimal('50000'), max_val=Decimal('100000'))
        self.scheme = AuctionScheme.objects.create(
            id='S1', name='1 Lakh', tier=tier, total_value=Decimal('100000'), duration_months=20,
            monthly_installment=Decimal('5000'), total_slots=20, booked_slots=1, current_month=1)
        self.ticket = Ticket.objects.create(id='T1', ticket_number=1, scheme=self.scheme, user=self.profile)

    def _pay(self, m, due, status='UPCOMING'):
        return MonthlyPayment.objects.create(
            id=f'P{m}', ticket=self.ticket, scheme=self.scheme, user=self.profile, month_number=m,
            month_name=f'Month {m}', base_amount=Decimal('5000'), net_payable=Decimal('5000'),
            due_date=due, status=status)

    def test_effective_status(self):
        today = datetime.date(2026, 10, 25)
        self.assertEqual(effective_status('2026-10-10', today), 'OVERDUE')
        self.assertEqual(effective_status('2026-10-25', today), 'DUE')
        self.assertEqual(effective_status('2026-10-30', today), 'DUE')
        self.assertEqual(effective_status('2026-11-01', today), 'UPCOMING')

    def test_sync_moves_upcoming_to_due_when_month_starts(self):
        p = self._pay(2, '2026-11-10', 'UPCOMING')
        sync_payment_statuses(datetime.date(2026, 10, 25))
        p.refresh_from_db(); self.assertEqual(p.status, 'UPCOMING')
        sync_payment_statuses(datetime.date(2026, 11, 1))
        p.refresh_from_db(); self.assertEqual(p.status, 'DUE')
        sync_payment_statuses(datetime.date(2026, 11, 11))
        p.refresh_from_db(); self.assertEqual(p.status, 'OVERDUE')

    def test_paid_is_never_changed(self):
        p = self._pay(1, '2026-01-10', 'PAID')
        sync_payment_statuses(datetime.date(2026, 10, 25))
        p.refresh_from_db(); self.assertEqual(p.status, 'PAID')

    def test_generate_creates_current_and_next_month_once(self):
        self._pay(1, '2026-09-10', 'PAID')
        today = datetime.date(2026, 10, 25)
        created = generate_monthly_dues(today)
        self.assertEqual(created, 2)  # Oct 10 (month 2) and Nov 10 (month 3)
        self.assertEqual(list(MonthlyPayment.objects.order_by('month_number').values_list('due_date', flat=True)),
                         [datetime.date(2026, 9, 10), datetime.date(2026, 10, 10), datetime.date(2026, 11, 10)])
        self.assertEqual(generate_monthly_dues(today), 0)  # idempotent
        sync_payment_statuses(today)
        self.assertEqual(MonthlyPayment.objects.get(month_number=2).status, 'OVERDUE')
        self.assertEqual(MonthlyPayment.objects.get(month_number=3).status, 'UPCOMING')

    def test_stops_at_scheme_duration(self):
        self.scheme.duration_months = 2; self.scheme.save()
        self._pay(2, '2026-09-10', 'PAID')
        self.assertEqual(generate_monthly_dues(datetime.date(2026, 10, 25)), 0)

    def test_month_end_clamping(self):
        self._pay(1, '2026-01-31', 'PAID')
        generate_monthly_dues(datetime.date(2026, 1, 31))
        self.assertEqual(MonthlyPayment.objects.get(month_number=2).due_date, datetime.date(2026, 2, 28))