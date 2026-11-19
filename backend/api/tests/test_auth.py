from rest_framework.test import APITestCase
from rest_framework import status
from django.contrib.auth.models import User
from rest_framework.authtoken.models import Token
from api.models import UserProfile, ValueTier, AuctionScheme, Ticket, MonthlyPayment
from decimal import Decimal
from django.core.cache import cache

class AuthAndSecurityTests(APITestCase):
    def setUp(self):
        cache.clear()  # reset login throttle between tests
        # Create Member User
        self.user = User.objects.create_user(username='user@auctionticket.com', email='user@auctionticket.com', password='rahul')
        self.user_token = Token.objects.create(user=self.user)
        self.user_profile = UserProfile.objects.create(
            id='usr_01', user=self.user, name='Rahul Sharma', email='user@auctionticket.com',
            phone='9876543210', role='user', wallet_balance=Decimal('1000.00')
        )

        # Create Other Member User
        self.other_user = User.objects.create_user(username='other@auctionticket.com', email='other@auctionticket.com', password='priya')
        self.other_token = Token.objects.create(user=self.other_user)
        self.other_profile = UserProfile.objects.create(
            id='usr_02', user=self.other_user, name='Priya Sundaram', email='other@auctionticket.com',
            phone='9822011223', role='user', wallet_balance=Decimal('2000.00')
        )

        # Create Admin User
        self.admin = User.objects.create_user(username='admin@auctionticket.com', email='admin@auctionticket.com', password='admin', is_staff=True)
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

    # --- Phone + password login ---
    def test_login_valid_member(self):
        res = self.client.post('/api/auth/login/', {'phone': '9876543210', 'password': 'rahul'})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['token'], self.user_token.key)
        self.assertEqual(res.data['user']['id'], 'usr_01')
        self.assertEqual(res.data['user']['role'], 'user')

    def test_login_valid_priya(self):
        res = self.client.post('/api/auth/login/', {'phone': '9822011223', 'password': 'priya'})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['user']['id'], 'usr_02')

    def test_login_valid_admin(self):
        res = self.client.post('/api/auth/login/', {'phone': '9999988888', 'password': 'admin', 'role': 'admin'})
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['user']['role'], 'admin')

    def test_login_accepts_formatted_phone(self):
        for phone in ('+91 98765 43210', '+919876543210', '09876543210', '98765-43210'):
            res = self.client.post('/api/auth/login/', {'phone': phone, 'password': 'rahul'})
            self.assertEqual(res.status_code, status.HTTP_200_OK, phone)

    def test_login_wrong_password(self):
        res = self.client.post('/api/auth/login/', {'phone': '9876543210', 'password': 'wrongpass'})
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(res.data['error'], 'Invalid phone number or password.')

    def test_login_unknown_phone_gives_same_error(self):
        res = self.client.post('/api/auth/login/', {'phone': '9123456780', 'password': 'rahul'})
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(res.data['error'], 'Invalid phone number or password.')

    def test_login_phone_validation(self):
        bad_phones = {
            '': 'Phone number is required.',
            '12345': 'Enter a valid 10-digit mobile number starting with 6, 7, 8 or 9.',
            '5876543210': 'Enter a valid 10-digit mobile number starting with 6, 7, 8 or 9.',
            '98765abcde': 'Enter a valid 10-digit mobile number starting with 6, 7, 8 or 9.',
            '98765432101': 'Enter a valid 10-digit mobile number starting with 6, 7, 8 or 9.',
        }
        for phone, message in bad_phones.items():
            res = self.client.post('/api/auth/login/', {'phone': phone, 'password': 'rahul'})
            self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST, phone)
            self.assertEqual(res.data['errors']['phone'], message, phone)

    def test_login_password_validation(self):
        res = self.client.post('/api/auth/login/', {'phone': '9876543210', 'password': ''})
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.data['errors']['password'], 'Password is required.')

        res = self.client.post('/api/auth/login/', {'phone': '9876543210', 'password': 'abc'})
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('at least 5', res.data['errors']['password'])

        res = self.client.post('/api/auth/login/', {'phone': '9876543210', 'password': 'x' * 129})
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('at most 128', res.data['errors']['password'])

    def test_login_missing_fields(self):
        res = self.client.post('/api/auth/login/', {})
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('phone', res.data['errors'])
        self.assertIn('password', res.data['errors'])

    def test_member_cannot_use_admin_login(self):
        res = self.client.post('/api/auth/login/', {'phone': '9876543210', 'password': 'rahul', 'role': 'admin'})
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_cannot_use_member_login(self):
        res = self.client.post('/api/auth/login/', {'phone': '9999988888', 'password': 'admin', 'role': 'user'})
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    def test_wrong_password_checked_before_role(self):
        # Role mismatch must not reveal that the account exists / is an admin
        res = self.client.post('/api/auth/login/', {'phone': '9999988888', 'password': 'nope1', 'role': 'user'})
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_otp_endpoints_removed(self):
        self.assertEqual(self.client.post('/api/auth/send-otp/', {'phone': '9876543210'}).status_code, 404)
        self.assertEqual(self.client.post('/api/auth/verify-otp/', {'phone': '9876543210', 'otp': '123456'}).status_code, 404)

    def test_login_is_rate_limited(self):
        statuses = [
            self.client.post('/api/auth/login/', {'phone': '9876543210', 'password': 'wrongpass'}).status_code
            for _ in range(25)
        ]
        self.assertIn(status.HTTP_429_TOO_MANY_REQUESTS, statuses)

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