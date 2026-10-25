from rest_framework.test import APITestCase
from rest_framework import status
from django.contrib.auth.models import User
from rest_framework.authtoken.models import Token
from api.models import UserProfile, ValueTier, AuctionScheme, Ticket, MonthlyPayment
from decimal import Decimal

class TicketBookingTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='user@auctionticket.com', email='user@auctionticket.com', password='user123')
        self.token = Token.objects.create(user=self.user)
        self.profile = UserProfile.objects.create(
            id='usr_01', user=self.user, name='Rahul Sharma', email='user@auctionticket.com',
            phone='9876543210', role='user'
        )

        self.other_user = User.objects.create_user(username='priya@example.com', email='priya@example.com', password='priya123')
        self.other_token = Token.objects.create(user=self.other_user)
        self.other_profile = UserProfile.objects.create(
            id='usr_02', user=self.other_user, name='Priya Sundaram', email='priya@example.com',
            phone='9822011223', role='user'
        )

        self.tier = ValueTier.objects.create(
            id='bronze', name='Bronze Tier', range_label='50k - 1L',
            min_val=Decimal('50000.00'), max_val=Decimal('100000.00')
        )
        self.scheme = AuctionScheme.objects.create(
            id='SCH-BRZ-1L', name='Lakshya 1.0 Lakh Scheme', tier=self.tier,
            total_value=Decimal('100000.00'), duration_months=20, monthly_installment=Decimal('5000.00'),
            total_slots=20, booked_slots=0
        )

    def test_valid_booking_uses_authenticated_user(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token.key}')
        # Even if client sends malicious user_id='usr_02', server MUST assign to authenticated user usr_01
        res = self.client.post(f'/api/schemes/{self.scheme.id}/book_slot/', {
            'slot_number': 5,
            'user_id': 'usr_02'
        })
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        ticket = Ticket.objects.get(scheme=self.scheme, ticket_number=5)
        self.assertEqual(ticket.user.id, 'usr_01')
        self.scheme.refresh_from_db()
        self.assertEqual(self.scheme.booked_slots, 1)

        # Initial payment for current month created
        payment = MonthlyPayment.objects.get(ticket=ticket, month_number=self.scheme.current_month)
        self.assertEqual(payment.base_amount, Decimal('5000.00'))
        self.assertEqual(payment.net_payable, Decimal('5000.00'))
        self.assertEqual(payment.status, 'DUE')

    def test_duplicate_slot_booking_rejected(self):
        Ticket.objects.create(id='TKT-SCH-BRZ-1L-05', ticket_number=5, scheme=self.scheme, user=self.other_profile)
        self.scheme.booked_slots = 1
        self.scheme.save()

        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token.key}')
        res = self.client.post(f'/api/schemes/{self.scheme.id}/book_slot/', {'slot_number': 5})
        self.assertEqual(res.status_code, status.HTTP_409_CONFLICT)
        self.assertIn('already booked', res.data['error'])

    def test_slot_out_of_bounds_rejected(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token.key}')
        # Slot 25 on a 20-slot scheme
        res = self.client.post(f'/api/schemes/{self.scheme.id}/book_slot/', {'slot_number': 25})
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

        # Slot 0
        res = self.client.post(f'/api/schemes/{self.scheme.id}/book_slot/', {'slot_number': 0})
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_full_scheme_booking_rejected(self):
        self.scheme.booked_slots = 20
        self.scheme.save()

        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token.key}')
        res = self.client.post(f'/api/schemes/{self.scheme.id}/book_slot/', {'slot_number': 1})
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('full', res.data['error'])
