from rest_framework.test import APITestCase
from rest_framework import status
from django.contrib.auth.models import User
from rest_framework.authtoken.models import Token
from api.models import (
    UserProfile, ValueTier, AuctionScheme, Ticket,
    MonthlyPayment, PaymentLedgerEntry
)
from decimal import Decimal

class PaymentProcessingTests(APITestCase):
    def setUp(self):
        # User 1
        self.user1 = User.objects.create_user(username='user1@auctionticket.com', email='user1@auctionticket.com', password='user123')
        self.user1_token = Token.objects.create(user=self.user1)
        self.user1_profile = UserProfile.objects.create(
            id='usr_01', user=self.user1, name='Rahul Sharma', email='user1@auctionticket.com',
            phone='9876543210', role='user'
        )

        # User 2
        self.user2 = User.objects.create_user(username='user2@auctionticket.com', email='user2@auctionticket.com', password='user123')
        self.user2_token = Token.objects.create(user=self.user2)
        self.user2_profile = UserProfile.objects.create(
            id='usr_02', user=self.user2, name='Priya Sundaram', email='user2@auctionticket.com',
            phone='9822011223', role='user'
        )

        # Tier & Scheme
        self.tier = ValueTier.objects.create(
            id='bronze', name='Bronze Tier', range_label='50k - 1L',
            min_val=Decimal('50000.00'), max_val=Decimal('100000.00')
        )
        self.scheme = AuctionScheme.objects.create(
            id='SCH-BRZ-1L', name='Lakshya 1.0 Lakh Scheme', tier=self.tier,
            total_value=Decimal('100000.00'), duration_months=20, monthly_installment=Decimal('5000.00'),
            total_slots=20, booked_slots=2
        )

        # Ticket & Payment
        self.ticket1 = Ticket.objects.create(
            id='TKT-1L-01', ticket_number=1, scheme=self.scheme, user=self.user1_profile, total_months_paid=0
        )
        self.payment1 = MonthlyPayment.objects.create(
            id='PAY-1L-01-M1', ticket=self.ticket1, scheme=self.scheme, user=self.user1_profile,
            month_number=1, month_name='Jan', base_amount=Decimal('5000.00'),
            dividend_discount=Decimal('0.00'), net_payable=Decimal('5000.00'),
            due_date='2026-01-10', status='DUE'
        )

    def test_payment_clearance_and_idempotency(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.user1_token.key}')

        # 1. First payment attempt
        res1 = self.client.post(f'/api/payments/{self.payment1.id}/pay/', {'payment_method': 'UPI (GPay)'})
        self.assertEqual(res1.status_code, status.HTTP_200_OK)
        self.assertEqual(res1.data['payment']['status'], 'PAID')

        self.payment1.refresh_from_db()
        self.ticket1.refresh_from_db()
        self.assertEqual(self.payment1.status, 'PAID')
        self.assertEqual(self.ticket1.total_months_paid, 1)

        first_receipt = self.payment1.receipt_number
        first_ref = self.payment1.transaction_ref
        self.assertTrue(first_receipt.startswith('REC-'))
        self.assertTrue(first_ref.startswith('DEMO-UPI-'))

        # Check ledger entry created
        ledger_count = PaymentLedgerEntry.objects.filter(payment=self.payment1).count()
        self.assertEqual(ledger_count, 1)

        # 2. Duplicate payment attempt (e.g. double click or re-submission)
        res2 = self.client.post(f'/api/payments/{self.payment1.id}/pay/', {'payment_method': 'UPI (GPay)'})
        self.assertEqual(res2.status_code, status.HTTP_200_OK)
        self.assertTrue(res2.data.get('is_duplicate', False) or res2.data.get('receipt', {}).get('is_duplicate', False))

        self.payment1.refresh_from_db()
        self.ticket1.refresh_from_db()
        # Must NOT re-increment months paid!
        self.assertEqual(self.ticket1.total_months_paid, 1)
        # Receipt number must stay identical!
        self.assertEqual(self.payment1.receipt_number, first_receipt)
        self.assertEqual(self.payment1.transaction_ref, first_ref)

        # No duplicate ledger entry
        self.assertEqual(PaymentLedgerEntry.objects.filter(payment=self.payment1).count(), 1)

    def test_user_cannot_pay_another_user_payment(self):
        # User 2 tries to pay User 1's installment
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.user2_token.key}')
        res = self.client.post(f'/api/payments/{self.payment1.id}/pay/', {'payment_method': 'UPI (GPay)'})
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        self.payment1.refresh_from_db()
        self.assertEqual(self.payment1.status, 'DUE')

    def test_filter_upcoming_and_all_dues(self):
        # Create an upcoming payment for user 1
        payment_upcoming = MonthlyPayment.objects.create(
            id='PAY-1L-01-M2', ticket=self.ticket1, scheme=self.scheme, user=self.user1_profile,
            month_number=2, month_name='Feb', base_amount=Decimal('5000.00'),
            dividend_discount=Decimal('500.00'), net_payable=Decimal('4500.00'),
            due_date='2026-02-10', status='UPCOMING'
        )

        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.user1_token.key}')

        # 1. Filter by UPCOMING
        res_upcoming = self.client.get('/api/payments/?status=UPCOMING')
        self.assertEqual(res_upcoming.status_code, status.HTTP_200_OK)
        ids_upcoming = [p['id'] for p in res_upcoming.data]
        self.assertIn(payment_upcoming.id, ids_upcoming)
        self.assertNotIn(self.payment1.id, ids_upcoming)

        # 2. Filter by DUE
        res_due = self.client.get('/api/payments/?status=DUE')
        self.assertEqual(res_due.status_code, status.HTTP_200_OK)
        ids_due = [p['id'] for p in res_due.data]
        self.assertIn(self.payment1.id, ids_due)
        self.assertNotIn(payment_upcoming.id, ids_due)

        # 3. Filter by ALL_DUES (should return both DUE and UPCOMING)
        res_all_dues = self.client.get('/api/payments/?status=ALL_DUES')
        self.assertEqual(res_all_dues.status_code, status.HTTP_200_OK)
        ids_all_dues = [p['id'] for p in res_all_dues.data]
        self.assertIn(self.payment1.id, ids_all_dues)
        self.assertIn(payment_upcoming.id, ids_all_dues)

        # 4. Overview stats includes upcoming dues
        res_stats = self.client.get(f'/api/overview-stats/?user_id={self.user1_profile.id}')
        self.assertEqual(res_stats.status_code, status.HTTP_200_OK)
        # Expected: 5000 (payment1 DUE) + 4500 (payment_upcoming UPCOMING) = 9500
        self.assertEqual(res_stats.data['user_stats']['upcoming_dues'], 9500.0)



class ReconcilePermissionRegressionTests(APITestCase):
    """Members must not be able to reconcile payments or send reminders."""
    def test_member_blocked_from_admin_actions(self):
        u = User.objects.create_user(username='m@x.com', email='m@x.com', password='p')
        tok = Token.objects.create(user=u)
        UserProfile.objects.create(id='usr_m', user=u, name='M', email='m@x.com', phone='9000000099', role='user')
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {tok.key}')
        for action in ('reconcile', 'send_reminder'):
            res = self.client.post(f'/api/payments/ANY/{action}/')
            self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN, action)
