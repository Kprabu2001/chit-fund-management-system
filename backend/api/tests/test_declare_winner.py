from decimal import Decimal

from django.contrib.auth.models import User
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.test import APITestCase

from api.models import (
    AuctionCorrection, AuctionRecord, AuctionRound, AuctionScheme, MonthlyPayment,
    PaymentLedgerEntry, PrizePayout, Ticket, UserProfile, ValueTier,
)

DECLARE = '/api/auctions/declare-winner/'
REVERT = '/api/auctions/revert-winner/'


def make_user(uid, name, role='user', staff=False):
    email = f'{uid}@example.com'
    user = User.objects.create_user(username=email, email=email, password='x', is_staff=staff)
    token = Token.objects.create(user=user)
    profile = UserProfile.objects.create(
        id=uid, user=user, name=name, email=email, phone=f'90000{abs(hash(uid)) % 100000:05d}', role=role)
    return profile, token


class DeclareWinnerTests(APITestCase):
    def setUp(self):
        self.admin, self.admin_token = make_user('adm_01', 'Admin Chief', role='admin', staff=True)
        self.u1, self.t1 = make_user('usr_01', 'Rahul Sharma')
        self.u2, self.t2 = make_user('usr_02', 'Priya Sundaram')
        holder, _ = make_user('usr_holder', 'Pool Holder')

        tier = ValueTier.objects.create(
            id='bronze', name='Bronze', range_label='50k-1L',
            min_val=Decimal('50000'), max_val=Decimal('100000'))
        # ₹1 lakh chit, 20 members, ₹5,000/month, 5% commission, discount limits 5%-30%
        self.scheme = AuctionScheme.objects.create(
            id='SCH-1L', name='Lakshya 1 Lakh', tier=tier, total_value=Decimal('100000.00'),
            duration_months=20, monthly_installment=Decimal('5000.00'), total_slots=20,
            booked_slots=20, commission_percent=Decimal('5.00'), current_month=1)

        self.ticket1 = Ticket.objects.create(id='TKT-01', ticket_number=1, scheme=self.scheme, user=self.u1)
        self.ticket2 = Ticket.objects.create(id='TKT-02', ticket_number=2, scheme=self.scheme, user=self.u2)
        for n in range(3, 21):
            Ticket.objects.create(id=f'TKT-{n:02d}', ticket_number=n, scheme=self.scheme, user=holder)

        # Only tickets 1 and 2 have paid Month 1
        for t in (self.ticket1, self.ticket2):
            MonthlyPayment.objects.create(
                id=f'PAY-{t.id}-M1', ticket=t, scheme=self.scheme, user=t.user, month_number=1,
                month_name='Month 1', base_amount=Decimal('5000.00'), net_payable=Decimal('5000.00'),
                due_date='2026-10-10', status='PAID')

    def _as(self, token):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {token.key}')

    def _declare(self, ticket=None, discount='20000.00', **extra):
        body = {'scheme_id': self.scheme.id, 'ticket_id': (ticket or self.ticket1).id,
                'discount_amount': discount, **extra}
        return self.client.post(DECLARE, body, format='json')

    # --- permissions -------------------------------------------------------------------------
    def test_member_cannot_declare_or_revert(self):
        self._as(self.t1)
        self.assertEqual(self._declare().status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.client.post(REVERT, {'scheme_id': self.scheme.id}, format='json').status_code,
                         status.HTTP_403_FORBIDDEN)

    # --- dry run -----------------------------------------------------------------------------
    def test_dry_run_returns_summary_and_warnings_without_changing_anything(self):
        self._as(self.admin_token)
        res = self._declare(dry_run=True)
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(res.data['dry_run'])
        s = res.data['summary']
        self.assertEqual(s['winner_name'], 'Rahul Sharma')
        self.assertEqual(s['winner_payout'], 80000.00)
        self.assertEqual(s['dividend_per_member'], 789.47)
        self.assertTrue(s['winner_paid_this_month'])
        self.assertEqual(len(s['unpaid_members']), 18)
        self.assertTrue(any('18 other member' in w for w in res.data['warnings']))
        self.assertFalse(AuctionRecord.objects.exists())
        self.ticket1.refresh_from_db()
        self.assertFalse(self.ticket1.has_won_auction)

    def test_warns_when_winner_has_not_paid(self):
        self._as(self.admin_token)
        unpaid_ticket = Ticket.objects.get(id='TKT-05')
        res = self._declare(ticket=unpaid_ticket, dry_run=True)
        self.assertFalse(res.data['summary']['winner_paid_this_month'])
        self.assertTrue(any('has not paid Month 1' in w for w in res.data['warnings']))

    # --- declare -----------------------------------------------------------------------------
    def test_declare_concludes_month_and_creates_pending_payout(self):
        self._as(self.admin_token)
        res = self._declare()
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data['payout']['status'], 'PENDING')
        self.assertEqual(res.data['payout']['amount'], 80000.00)

        self.ticket1.refresh_from_db()
        self.assertTrue(self.ticket1.has_won_auction)
        self.assertEqual(self.ticket1.status, 'prized')
        self.assertEqual(self.ticket1.won_payout, Decimal('80000.00'))

        record = AuctionRecord.objects.get(scheme=self.scheme, month_number=1)
        self.assertEqual(record.concluded_by, self.admin)
        payout = PrizePayout.objects.get(auction_record=record)
        self.assertEqual((payout.user, payout.status, payout.amount), (self.u1, 'PENDING', Decimal('80000.00')))

        self.scheme.refresh_from_db()
        self.assertEqual(self.scheme.current_month, 2)

        # Everyone but the winner gets the dividend on Month 2; the winner pays in full
        m2 = MonthlyPayment.objects.get(ticket=self.ticket2, month_number=2)
        self.assertEqual((m2.dividend_discount, m2.net_payable), (Decimal('789.47'), Decimal('4210.53')))
        winner_m2 = MonthlyPayment.objects.get(ticket=self.ticket1, month_number=2)
        self.assertEqual(winner_m2.net_payable, Decimal('5000.00'))

    def test_dividend_applied_to_installments_the_daily_generator_already_created(self):
        for t in Ticket.objects.filter(scheme=self.scheme):
            MonthlyPayment.objects.create(
                id=f'PAY-{t.id}-M2', ticket=t, scheme=self.scheme, user=t.user, month_number=2,
                month_name='Month 2', base_amount=Decimal('5000.00'), net_payable=Decimal('5000.00'),
                due_date='2026-11-10', status='UPCOMING')
        self._as(self.admin_token)
        self.assertEqual(self._declare().status_code, status.HTTP_201_CREATED)
        m2 = MonthlyPayment.objects.get(ticket=self.ticket2, month_number=2)
        self.assertEqual(m2.net_payable, Decimal('4210.53'))
        self.assertEqual(m2.status, 'UPCOMING')  # status untouched
        self.assertTrue(PaymentLedgerEntry.objects.filter(payment=m2, entry_type='DIVIDEND_ADJUSTMENT').exists())

    def test_ticket_from_another_scheme_rejected(self):
        other = AuctionScheme.objects.create(
            id='SCH-OTHER', name='Other', tier=self.scheme.tier, total_value=Decimal('100000.00'),
            duration_months=20, monthly_installment=Decimal('5000.00'), total_slots=20, booked_slots=20)
        foreign = Ticket.objects.create(id='TKT-X', ticket_number=1, scheme=other, user=self.u1)
        self._as(self.admin_token)
        res = self._declare(ticket=foreign)
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('does not belong', res.data['error'])

    def test_previous_winner_cannot_win_again(self):
        self._as(self.admin_token)
        self.assertEqual(self._declare().status_code, status.HTTP_201_CREATED)
        res = self._declare()  # month 2, same ticket
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('already won', res.data['error'])

    def test_second_month_is_declared_after_first(self):
        self._as(self.admin_token)
        self._declare()
        res = self._declare(ticket=self.ticket2, discount='10000.00')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data['summary']['month_number'], 2)
        self.assertTrue(AuctionRecord.objects.filter(scheme=self.scheme, month_number=2).exists())

    def test_discount_must_be_within_scheme_limits(self):
        self._as(self.admin_token)
        for bad in ('4999.99', '30000.01', '0', '-5', 'abc'):
            res = self._declare(discount=bad)
            self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST, bad)
        self.assertEqual(self._declare(discount='5000.00', dry_run=True).status_code, status.HTTP_200_OK)
        self.assertEqual(self._declare(discount='30000.00', dry_run=True).status_code, status.HTTP_200_OK)
        self.assertFalse(AuctionRecord.objects.exists())

    def test_pool_must_be_full(self):
        self.scheme.booked_slots = 19
        self.scheme.save()
        self._as(self.admin_token)
        self.assertEqual(self._declare().status_code, status.HTTP_400_BAD_REQUEST)

    # --- correction --------------------------------------------------------------------------
    def test_revert_while_pending_then_declare_correct_winner(self):
        self._as(self.admin_token)
        self._declare()
        res = self.client.post(REVERT, {'scheme_id': self.scheme.id, 'reason': 'Wrong ticket'}, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        self.ticket1.refresh_from_db()
        self.assertFalse(self.ticket1.has_won_auction)
        self.assertEqual(self.ticket1.status, 'active')
        self.assertFalse(AuctionRecord.objects.exists())
        self.assertFalse(PrizePayout.objects.exists())
        self.scheme.refresh_from_db()
        self.assertEqual(self.scheme.current_month, 1)
        m2 = MonthlyPayment.objects.get(ticket=self.ticket2, month_number=2)
        self.assertEqual((m2.dividend_discount, m2.net_payable), (Decimal('0.00'), Decimal('5000.00')))
        corr = AuctionCorrection.objects.get()
        self.assertEqual((corr.old_winner_ticket_id, corr.reason, corr.corrected_by), ('TKT-01', 'Wrong ticket', self.admin))
        # ledger is append-only: the original adjustment stays, a negative reversal is added
        amounts = sorted(PaymentLedgerEntry.objects.filter(payment=m2).values_list('amount', flat=True))
        self.assertEqual(amounts, [Decimal('-789.47'), Decimal('789.47')])

        res = self._declare(ticket=self.ticket2, discount='25000.00')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data['summary']['month_number'], 1)
        self.assertEqual(PrizePayout.objects.get().user, self.u2)

    def test_revert_blocked_once_payout_is_paid(self):
        self._as(self.admin_token)
        self._declare()
        PrizePayout.objects.update(status='PAID')
        res = self.client.post(REVERT, {'scheme_id': self.scheme.id}, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('already been marked Paid', res.data['error'])
        self.assertTrue(AuctionRecord.objects.exists())

    def test_revert_blocked_when_next_month_already_paid(self):
        self._as(self.admin_token)
        self._declare()
        MonthlyPayment.objects.filter(ticket=self.ticket2, month_number=2).update(status='PAID')
        res = self.client.post(REVERT, {'scheme_id': self.scheme.id}, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(AuctionRecord.objects.exists())

    def test_revert_with_nothing_declared(self):
        self._as(self.admin_token)
        res = self.client.post(REVERT, {'scheme_id': self.scheme.id}, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)