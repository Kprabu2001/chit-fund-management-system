from rest_framework.test import APITestCase
from rest_framework import status
from django.contrib.auth.models import User
from rest_framework.authtoken.models import Token
from api.models import UserProfile, ValueTier, AuctionScheme, Ticket, MonthlyPayment
from decimal import Decimal
from django.test import override_settings

class AuthAndSecurityTests(APITestCase):
    def setUp(self):
        # Create Member User
        self.user = User.objects.create_user(username='user@auctionticket.com', email='user@auctionticket.com', password='user123')
        self.user_token = Token.objects.create(user=self.user)
        self.user_profile = UserProfile.objects.create(
            id='usr_01', user=self.user, name='Rahul Sharma', email='user@auctionticket.com',
            phone='9876543210', role='user', wallet_balance=Decimal('1000.00')
        )

        # Create Other Member User
        self.other_user = User.objects.create_user(username='other@auctionticket.com', email='other@auctionticket.com', password='other123')
        self.other_token = Token.objects.create(user=self.other_user)
        self.other_profile = UserProfile.objects.create(
            id='usr_02', user=self.other_user, name='Priya Sundaram', email='other@auctionticket.com',
            phone='9822011223', role='user', wallet_balance=Decimal('2000.00')
        )

        # Create Admin User
        self.admin = User.objects.create_user(username='admin@auctionticket.com', email='admin@auctionticket.com', password='admin123', is_staff=True)
        self.admin_token = Token.objects.create(user=self.admin)
        self.admin_profile = UserProfile.objects.create(
            id='adm_01', user=self.admin, name='Admin Chief', email='admin@auctionticket.com',
            phone='9999988888', role='admin', wallet_balance=Decimal('50000.00')
        )

        # Create Tier & Scheme
        self.tier = ValueTier.objects.create(
            id='silver', name='Silver Tier', range_label='1L-2L',
            min_val=Decimal('100000.00'), max_val=Decimal('200000.00')
        )
        self.scheme = AuctionScheme.objects.create(
            id='SCH-SLV-01', name='Silver Test Pool', tier=self.tier,
            total_value=Decimal('150000.00'), duration_months=15, monthly_installment=Decimal('10000.00'),
            total_slots=15, booked_slots=2, commission_percent=Decimal('5.00')
        )

        # Tickets & Payments
        self.user_ticket = Ticket.objects.create(
            id='TKT-SLV-01', ticket_number=1, scheme=self.scheme, user=self.user_profile
        )
        self.other_ticket = Ticket.objects.create(
            id='TKT-SLV-02', ticket_number=2, scheme=self.scheme, user=self.other_profile
        )

        self.user_payment = MonthlyPayment.objects.create(
            id='PAY-01', ticket=self.user_ticket, scheme=self.scheme, user=self.user_profile,
            month_number=1, month_name='Jan', base_amount=Decimal('10000.00'),
            dividend_discount=Decimal('0.00'), net_payable=Decimal('10000.00'),
            due_date='2026-01-10', status='DUE'
        )
        self.other_payment = MonthlyPayment.objects.create(
            id='PAY-02', ticket=self.other_ticket, scheme=self.scheme, user=self.other_profile,
            month_number=1, month_name='Jan', base_amount=Decimal('10000.00'),
            dividend_discount=Decimal('0.00'), net_payable=Decimal('10000.00'),
            due_date='2026-01-10', status='DUE'
        )

    def test_login_valid_credentials(self):
        res = self.client.post('/api/auth/login/', {'email': 'user@auctionticket.com', 'password': 'user123'})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIn('token', res.data)
        self.assertEqual(res.data['token'], self.user_token.key)
        self.assertEqual(res.data['user']['id'], 'usr_01')

    def test_login_invalid_password(self):
        res = self.client.post('/api/auth/login/', {'email': 'user@auctionticket.com', 'password': 'wrongpassword'})
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertIn('error', res.data)

    def test_login_nonexistent_email(self):
        res = self.client.post('/api/auth/login/', {'email': 'ghost@example.com', 'password': 'user123'})
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_unauthenticated_request_rejected(self):
        res = self.client.get('/api/tickets/')
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_regular_user_cannot_access_other_user_tickets(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.user_token.key}')
        # User tries to filter by other user id
        res = self.client.get(f'/api/tickets/?user_id={self.other_profile.id}')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        # Server must override client-supplied user_id and return only self tickets
        ticket_ids = [t['id'] for t in res.data]
        self.assertIn(self.user_ticket.id, ticket_ids)
        self.assertNotIn(self.other_ticket.id, ticket_ids)

    def test_regular_user_cannot_access_other_user_payments(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.user_token.key}')
        res = self.client.get(f'/api/payments/?user_id={self.other_profile.id}')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        payment_ids = [p['id'] for p in res.data]
        self.assertIn(self.user_payment.id, payment_ids)
        self.assertNotIn(self.other_payment.id, payment_ids)

    def test_regular_user_cannot_reconcile_payments(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.user_token.key}')
        res = self.client.post(f'/api/payments/{self.user_payment.id}/reconcile/')
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_can_reconcile_payments(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.admin_token.key}')
        res = self.client.post(f'/api/payments/{self.user_payment.id}/reconcile/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.user_payment.refresh_from_db()
        self.assertEqual(self.user_payment.status, 'PAID')

    def test_regular_user_cannot_escalate_role(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.user_token.key}')
        res = self.client.patch(f'/api/users/{self.user_profile.id}/', {'role': 'admin'})
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        self.user_profile.refresh_from_db()
        self.assertEqual(self.user_profile.role, 'user')

    # --- Phone SMS OTP Tests ---
    @override_settings(DEBUG=True)
    def test_send_otp_valid_phone(self):
        res = self.client.post('/api/auth/send-otp/', {'phone': '+91 98765 43210'})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIn('demo_otp', res.data)
        self.assertEqual(len(res.data['demo_otp']), 6)
        self.assertIn('message', res.data)

    def test_send_otp_invalid_phone(self):
        res = self.client.post('/api/auth/send-otp/', {'phone': '123'})
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('error', res.data)

    def test_send_otp_rate_limiting(self):
        # 1st request succeeds
        res1 = self.client.post('/api/auth/send-otp/', {'phone': '9876543210'})
        self.assertEqual(res1.status_code, status.HTTP_200_OK)

        # Immediate 2nd request within 30 seconds is throttled
        res2 = self.client.post('/api/auth/send-otp/', {'phone': '9876543210'})
        self.assertEqual(res2.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertIn('error', res2.data)

    @override_settings(DEBUG=True)
    def test_verify_otp_success_existing_user(self):
        # Send OTP
        res_send = self.client.post('/api/auth/send-otp/', {'phone': '+91 98765 43210'})
        otp_code = res_send.data['demo_otp']

        # Verify OTP
        res_verify = self.client.post('/api/auth/verify-otp/', {'phone': '9876543210', 'otp': otp_code})
        self.assertEqual(res_verify.status_code, status.HTTP_200_OK)
        self.assertIn('token', res_verify.data)
        self.assertEqual(res_verify.data['user']['id'], 'usr_01')
        self.assertEqual(res_verify.data['user']['name'], 'Rahul Sharma')

    def test_verify_otp_invalid_code(self):
        # Send OTP
        self.client.post('/api/auth/send-otp/', {'phone': '9822011223'})

        # Verify with wrong OTP
        res = self.client.post('/api/auth/verify-otp/', {'phone': '9822011223', 'otp': '000000'})
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('error', res.data)

    @override_settings(DEBUG=True)
    def test_verify_otp_auto_registers_new_member(self):
        new_phone = '9123456789'
        res_send = self.client.post('/api/auth/send-otp/', {'phone': new_phone})
        otp = res_send.data['demo_otp']

        res_verify = self.client.post('/api/auth/verify-otp/', {'phone': new_phone, 'otp': otp})
        self.assertEqual(res_verify.status_code, status.HTTP_200_OK)
        self.assertIn('token', res_verify.data)
        self.assertEqual(res_verify.data['user']['phone'], f"+91 {new_phone[:5]} {new_phone[5:]}")
        self.assertEqual(res_verify.data['user']['role'], 'user')

