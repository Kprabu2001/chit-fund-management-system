from rest_framework.test import APITestCase
from rest_framework import status
from django.contrib.auth.models import User
from rest_framework.authtoken.models import Token
from api.models import (
    UserProfile, ValueTier, AuctionScheme, Ticket,
    MonthlyPayment, AuctionRound, AuctionRecord
)
from decimal import Decimal

class AuctionAndDividendTests(APITestCase):
    def setUp(self):
        # Admin User
        self.admin = User.objects.create_user(username='admin@auctionticket.com', email='admin@auctionticket.com', password='admin123', is_staff=True)
        self.admin_token = Token.objects.create(user=self.admin)
        self.admin_profile = UserProfile.objects.create(
            id='adm_01', user=self.admin, name='Admin Chief', email='admin@auctionticket.com',
            phone='9999988888', role='admin'
        )

        # Member 1 (Bidder / Winner)
        self.user1 = User.objects.create_user(username='user1@auctionticket.com', email='user1@auctionticket.com', password='user123')
        self.user1_token = Token.objects.create(user=self.user1)
        self.user1_profile = UserProfile.objects.create(
            id='usr_01', user=self.user1, name='Rahul Sharma', email='user1@auctionticket.com',
            phone='9876543210', role='user'
        )

        # Member 2 (Non-winning participant)
        self.user2 = User.objects.create_user(username='user2@auctionticket.com', email='user2@auctionticket.com', password='user123')
        self.user2_token = Token.objects.create(user=self.user2)
        self.user2_profile = UserProfile.objects.create(
            id='usr_02', user=self.user2, name='Priya Sundaram', email='user2@auctionticket.com',
            phone='9822011223', role='user'
        )

        # Member 3 (Unenrolled user)
        self.user3 = User.objects.create_user(username='user3@auctionticket.com', email='user3@auctionticket.com', password='user123')
        self.user3_token = Token.objects.create(user=self.user3)
        self.user3_profile = UserProfile.objects.create(
            id='usr_03', user=self.user3, name='Vikram Malhotra', email='user3@auctionticket.com',
            phone='9911233445', role='user'
        )

        # 1 Lakh Scheme: 20 members, 20 months, ₹5,000/mo, 5% commission
        self.tier = ValueTier.objects.create(
            id='bronze', name='Bronze Tier', range_label='50k - 1L',
            min_val=Decimal('50000.00'), max_val=Decimal('100000.00')
        )
        self.scheme = AuctionScheme.objects.create(
            id='SCH-BRZ-1L', name='Lakshya 1.0 Lakh Scheme', tier=self.tier,
            total_value=Decimal('100000.00'), duration_months=20, monthly_installment=Decimal('5000.00'),
            total_slots=20, booked_slots=2, commission_percent=Decimal('5.00'),
            winner_dividend_eligible=False, current_month=1
        )

        # Tickets for user1 and user2
        self.ticket1 = Ticket.objects.create(
            id='TKT-1L-01', ticket_number=1, scheme=self.scheme, user=self.user1_profile, status='active'
        )
        self.ticket2 = Ticket.objects.create(
            id='TKT-1L-02', ticket_number=2, scheme=self.scheme, user=self.user2_profile, status='active'
        )

        # Fill the pool (conclude requires 100% booked): tickets 3-20 held by a separate member
        holder_user = User.objects.create_user(username='holder@auctionticket.com', email='holder@auctionticket.com', password='user123')
        holder_profile = UserProfile.objects.create(
            id='usr_holder', user=holder_user, name='Pool Holder', email='holder@auctionticket.com',
            phone='9000000001', role='user'
        )
        for n in range(3, 21):
            Ticket.objects.create(
                id=f'TKT-1L-{n:02d}', ticket_number=n, scheme=self.scheme,
                user=holder_profile, status='active'
            )
        self.scheme.booked_slots = 20
        self.scheme.save()

        # Bidders must have paid their current-month installment
        for t in (self.ticket1, self.ticket2):
            MonthlyPayment.objects.create(
                id=f'PAY-{t.id}-M1', ticket=t, scheme=self.scheme, user=t.user,
                month_number=1, month_name='Month 1', base_amount=Decimal('5000.00'),
                dividend_discount=Decimal('0.00'), net_payable=Decimal('5000.00'),
                due_date='2026-01-10', status='PAID'
            )

        # Active Auction Round for Month 1
        self.round = AuctionRound.objects.create(
            id='ROUND-1L-M1', scheme=self.scheme, month_number=1,
            highest_discount_bid=Decimal('10000.00'), leader_name='Initial',
            leader_ticket=self.ticket1, is_active=True
        )

    def test_bid_placement_valid(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.user1_token.key}')
        res = self.client.post('/api/auctions/live/', {
            'action': 'bid',
            'discount_amount': '20000.00'
        })
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.round.refresh_from_db()
        self.assertEqual(self.round.highest_discount_bid, Decimal('20000.00'))
        self.assertEqual(self.round.leader_ticket, self.ticket1)

    def test_bid_by_unenrolled_member_rejected(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.user3_token.key}')
        res = self.client.post('/api/auctions/live/', {
            'action': 'bid',
            'discount_amount': '15000.00'
        })
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        self.assertIn('enrolled', res.data['error'])

    def test_bid_lower_than_current_highest_rejected(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.user1_token.key}')
        res = self.client.post('/api/auctions/live/', {
            'action': 'bid',
            'discount_amount': '8000.00' # Current highest is 10000
        })
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_bid_exceeding_max_discount_cap_rejected(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.user1_token.key}')
        # Cap is 30% of 1,00,000 = 30,000. Attempt 35,000
        res = self.client.post('/api/auctions/live/', {
            'action': 'bid',
            'discount_amount': '35000.00'
        })
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('maximum discount cap', res.data['error'])

    def test_conclude_auction_unauthorized_for_regular_member(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.user1_token.key}')
        res = self.client.post('/api/auctions/live/', {'action': 'conclude'})
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    def test_conclude_auction_exact_dividend_math_and_ledger(self):
        """
        Verify exact math from section 5 specification:
        - Total Chit Value: ₹1,00,000
        - Winning Discount: ₹20,000
        - Commission (5%): ₹5,000
        - Distributable Dividend: ₹15,000
        - 19 eligible members: ₹15,000 / 19 = ₹789.47 per member
        - Remainder: ₹0.07
        - Winner Payout: ₹1,00,000 - ₹20,000 = ₹80,000
        """
        self.round.highest_discount_bid = Decimal('20000.00')
        self.round.leader_ticket = self.ticket1
        self.round.save()

        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.admin_token.key}')
        res = self.client.post('/api/auctions/live/', {'action': 'conclude'})
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        self.assertEqual(res.data['winning_discount'], 20000.00)
        self.assertEqual(res.data['commission'], 5000.00)
        self.assertEqual(res.data['distributable_dividend'], 15000.00)
        self.assertEqual(res.data['dividend_per_member'], 789.47)
        self.assertEqual(res.data['winner_payout'], 80000.00)

        # Verify Round state
        self.round.refresh_from_db()
        self.assertTrue(self.round.is_concluded)
        self.assertFalse(self.round.is_active)

        # Verify Winner Ticket
        self.ticket1.refresh_from_db()
        self.assertTrue(self.ticket1.has_won_auction)
        self.assertEqual(self.ticket1.won_month, 1)
        self.assertEqual(self.ticket1.won_payout, Decimal('80000.00'))
        self.assertEqual(self.ticket1.status, 'prized')

        # Verify Immutable AuctionRecord created
        record = AuctionRecord.objects.get(scheme=self.scheme, month_number=1)
        self.assertEqual(record.winner_ticket, self.ticket1)
        self.assertEqual(record.dividend_per_member, Decimal('789.47'))
        self.assertEqual(record.rounding_remainder, Decimal('0.07'))

        # Verify next month payment for Member 2 has dividend deduction
        pay_m2 = MonthlyPayment.objects.get(ticket=self.ticket2, month_number=2)
        self.assertEqual(pay_m2.base_amount, Decimal('5000.00'))
        self.assertEqual(pay_m2.dividend_discount, Decimal('789.47'))
        self.assertEqual(pay_m2.net_payable, Decimal('4210.53')) # 5000 - 789.47

        # Verify Winner (ticket1) next month installment has 0 dividend (ineligible)
        pay_m1 = MonthlyPayment.objects.get(ticket=self.ticket1, month_number=2)
        self.assertEqual(pay_m1.dividend_discount, Decimal('0.00'))
        self.assertEqual(pay_m1.net_payable, Decimal('5000.00'))

    def test_duplicate_conclude_rejected(self):
        self.round.highest_discount_bid = Decimal('20000.00')
        self.round.leader_ticket = self.ticket1
        self.round.save()

        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.admin_token.key}')
        res1 = self.client.post('/api/auctions/live/', {'action': 'conclude'})
        self.assertEqual(res1.status_code, status.HTTP_200_OK)

        # Second conclude attempt must be rejected
        res2 = self.client.post('/api/auctions/live/', {'action': 'conclude'})
        self.assertEqual(res2.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('already been concluded', res2.data['error'])
