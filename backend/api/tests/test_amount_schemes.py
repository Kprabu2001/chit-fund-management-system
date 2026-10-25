from decimal import Decimal
from django.test import TestCase
from django.core.exceptions import ValidationError
from django.contrib.auth.models import User
from rest_framework.test import APITestCase
from rest_framework import status
from rest_framework.authtoken.models import Token

from api.models import (
    classify_tier,
    ValueTier,
    AuctionScheme,
    Ticket,
    MonthlyPayment,
    AuctionRound,
    AuctionRecord,
    PaymentLedgerEntry,
    UserProfile
)

class TierClassificationBoundaryTests(TestCase):
    """
    Validates Section E: Tier Classification & Non-Overlapping Boundaries.
    - Starter: ₹25,000–₹50,000 (inclusive)
    - Bronze:  (₹50,000, ₹1,00,000]
    - Silver:  (₹1,00,000, ₹2,00,000]
    - Gold:    (₹2,00,000, ₹5,00,000]
    - Diamond: (₹5,00,000, ₹10,00,000]
    Amounts outside [25000, 1000000] must be rejected with ValidationError.
    """
    def test_starter_tier_boundaries(self):
        self.assertEqual(classify_tier(Decimal('25000.00')), 'starter')
        self.assertEqual(classify_tier(Decimal('35000.00')), 'starter')
        self.assertEqual(classify_tier(Decimal('50000.00')), 'starter')

    def test_bronze_tier_boundaries(self):
        self.assertEqual(classify_tier(Decimal('50000.01')), 'bronze')
        self.assertEqual(classify_tier(Decimal('75000.00')), 'bronze')
        self.assertEqual(classify_tier(Decimal('100000.00')), 'bronze') # Exactly 1L is Bronze

    def test_silver_tier_boundaries(self):
        self.assertEqual(classify_tier(Decimal('100000.01')), 'silver')
        self.assertEqual(classify_tier(Decimal('150000.00')), 'silver') # 1.5L is Silver
        self.assertEqual(classify_tier(Decimal('200000.00')), 'silver') # Exactly 2L is Silver

    def test_gold_tier_boundaries(self):
        self.assertEqual(classify_tier(Decimal('200000.01')), 'gold')
        self.assertEqual(classify_tier(Decimal('300000.00')), 'gold') # 3.0L is Gold
        self.assertEqual(classify_tier(Decimal('500000.00')), 'gold') # Exactly 5L is Gold

    def test_diamond_tier_boundaries(self):
        self.assertEqual(classify_tier(Decimal('500000.01')), 'diamond')
        self.assertEqual(classify_tier(Decimal('750000.00')), 'diamond')
        self.assertEqual(classify_tier(Decimal('1000000.00')), 'diamond') # Exactly 10L is Diamond

    def test_out_of_bounds_rejection(self):
        # Under 25,000
        with self.assertRaises(ValidationError):
            classify_tier(Decimal('24999.99'))
        with self.assertRaises(ValidationError):
            classify_tier(Decimal('0.00'))
        with self.assertRaises(ValidationError):
            classify_tier(Decimal('-5000.00'))

        # Over 10,00,000
        with self.assertRaises(ValidationError):
            classify_tier(Decimal('1000000.01'))
        with self.assertRaises(ValidationError):
            classify_tier(Decimal('1500000.00'))


class AmountBasedSchemeModelTests(TestCase):
    """
    Validates Section A, B, C, D: Model validation for all 5 scheme configurations
    and dynamic calculation methods.
    """
    def setUp(self):
        self.tier_starter = ValueTier.objects.create(
            id='starter', name='Starter Tier', range_label='25k - 50k',
            min_val=Decimal('25000.00'), max_val=Decimal('50000.00')
        )
        self.tier_bronze = ValueTier.objects.create(
            id='bronze', name='Bronze Tier', range_label='50k - 1L',
            min_val=Decimal('50000.00'), max_val=Decimal('100000.00')
        )
        self.tier_silver = ValueTier.objects.create(
            id='silver', name='Silver Tier', range_label='1L - 2L',
            min_val=Decimal('100000.00'), max_val=Decimal('200000.00')
        )
        self.tier_gold = ValueTier.objects.create(
            id='gold', name='Gold Tier', range_label='2L - 5L',
            min_val=Decimal('200000.00'), max_val=Decimal('500000.00')
        )
        self.tier_diamond = ValueTier.objects.create(
            id='diamond', name='Diamond Tier', range_label='5L - 10L',
            min_val=Decimal('500000.00'), max_val=Decimal('1000000.00')
        )

    def test_scheme_1_lakh_bronze(self):
        """₹1,00,000 — 20 months, 20 members, ₹5,000 installment"""
        s = AuctionScheme(
            id='SCH-BRZ-1L', name='Lakshya 1.0 Lakh Scheme', tier=self.tier_bronze,
            total_value=Decimal('100000.00'), duration_months=20,
            monthly_installment=Decimal('5000.00'), total_slots=20,
            commission_percent=Decimal('5.00'), min_bid_discount=Decimal('5.00'),
            max_bid_discount=Decimal('30.00'), winner_dividend_eligible=False
        )
        s.clean()
        s.save()

        self.assertEqual(s.get_statutory_commission(), Decimal('5000.00')) # 5% of 1L
        self.assertEqual(s.get_min_bid_amount(), Decimal('5000.00')) # 5% of 1L
        self.assertEqual(s.get_max_bid_amount(), Decimal('30000.00')) # 30% of 1L
        self.assertEqual(s.get_eligible_dividend_members_count(), 19) # 20 - 1

    def test_scheme_1_5_lakh_silver(self):
        """₹1,50,000 — 15 months, 15 members, ₹10,000 installment"""
        s = AuctionScheme(
            id='SCH-SLV-01', name='Silver Crest 1.5 Lakh Pool', tier=self.tier_silver,
            total_value=Decimal('150000.00'), duration_months=15,
            monthly_installment=Decimal('10000.00'), total_slots=15,
            commission_percent=Decimal('5.00'), min_bid_discount=Decimal('5.00'),
            max_bid_discount=Decimal('30.00'), winner_dividend_eligible=False
        )
        s.clean()
        s.save()

        self.assertEqual(s.get_statutory_commission(), Decimal('7500.00')) # 5% of 1.5L
        self.assertEqual(s.get_min_bid_amount(), Decimal('7500.00'))
        self.assertEqual(s.get_max_bid_amount(), Decimal('45000.00')) # 30% of 1.5L
        self.assertEqual(s.get_eligible_dividend_members_count(), 14) # 15 - 1

    def test_scheme_2_lakh_silver(self):
        """₹2,00,000 — 20 months, 20 members, ₹10,000 installment"""
        s = AuctionScheme(
            id='SCH-SLV-02', name='Silver Prime 2.0 Lakh Pool', tier=self.tier_silver,
            total_value=Decimal('200000.00'), duration_months=20,
            monthly_installment=Decimal('10000.00'), total_slots=20,
            commission_percent=Decimal('5.00'), min_bid_discount=Decimal('5.00'),
            max_bid_discount=Decimal('30.00'), winner_dividend_eligible=False
        )
        s.clean()
        s.save()

        self.assertEqual(s.get_statutory_commission(), Decimal('10000.00')) # 5% of 2L
        self.assertEqual(s.get_min_bid_amount(), Decimal('10000.00'))
        self.assertEqual(s.get_max_bid_amount(), Decimal('60000.00')) # 30% of 2L
        self.assertEqual(s.get_eligible_dividend_members_count(), 19)

    def test_scheme_3_lakh_gold(self):
        """₹3,00,000 — 20 months, 20 members, ₹15,000 installment"""
        s = AuctionScheme(
            id='SCH-GLD-01', name='Gold Sovereign 3.0 Lakh Pool', tier=self.tier_gold,
            total_value=Decimal('300000.00'), duration_months=20,
            monthly_installment=Decimal('15000.00'), total_slots=20,
            commission_percent=Decimal('5.00'), min_bid_discount=Decimal('5.00'),
            max_bid_discount=Decimal('30.00'), winner_dividend_eligible=False
        )
        s.clean()
        s.save()

        self.assertEqual(s.get_statutory_commission(), Decimal('15000.00')) # 5% of 3L
        self.assertEqual(s.get_min_bid_amount(), Decimal('15000.00'))
        self.assertEqual(s.get_max_bid_amount(), Decimal('90000.00')) # 30% of 3L
        self.assertEqual(s.get_eligible_dividend_members_count(), 19)

    def test_scheme_10_lakh_diamond(self):
        """₹10,00,000 — 20 months, 20 members, ₹50,000 installment"""
        s = AuctionScheme(
            id='SCH-DIA-01', name='Diamond Imperial 10.0 Lakh Pool', tier=self.tier_diamond,
            total_value=Decimal('1000000.00'), duration_months=20,
            monthly_installment=Decimal('50000.00'), total_slots=20,
            commission_percent=Decimal('5.00'), min_bid_discount=Decimal('5.00'),
            max_bid_discount=Decimal('25.00'), winner_dividend_eligible=False
        )
        s.clean()
        s.save()

        self.assertEqual(s.get_statutory_commission(), Decimal('50000.00')) # 5% of 10L
        self.assertEqual(s.get_min_bid_amount(), Decimal('50000.00'))
        self.assertEqual(s.get_max_bid_amount(), Decimal('250000.00')) # 25% of 10L
        self.assertEqual(s.get_eligible_dividend_members_count(), 19)

    def test_scheme_tier_mismatch_rejected(self):
        """Scheme total_value of 3L cannot be placed in Silver tier"""
        s = AuctionScheme(
            id='SCH-MISMATCH', name='Mismatch Scheme', tier=self.tier_silver,
            total_value=Decimal('300000.00'), duration_months=20,
            monthly_installment=Decimal('15000.00'), total_slots=20
        )
        with self.assertRaises(ValidationError):
            s.clean()

    def test_scheme_inconsistent_installment_rejected(self):
        """Scheme total_value 10L != 20 months * 40,000 (8L)"""
        s = AuctionScheme(
            id='SCH-INVAL', name='Inconsistent Scheme', tier=self.tier_diamond,
            total_value=Decimal('1000000.00'), duration_months=20,
            monthly_installment=Decimal('40000.00'), total_slots=20
        )
        with self.assertRaises(ValidationError):
            s.clean()


class LiveAuctionMultiSchemeFinancialTests(APITestCase):
    """
    Validates Section B, C, D, F: Reverse auction bidding limits, commission deduction,
    dividend calculation, and passbook/ledger consistency across different schemes.
    """
    def setUp(self):
        # Admin
        self.admin_user = User.objects.create_user(username='admin@example.com', email='admin@example.com', password='pass', is_staff=True)
        self.admin_token = Token.objects.create(user=self.admin_user)
        self.admin_profile = UserProfile.objects.create(id='adm_01', user=self.admin_user, name='Admin Chief', email='admin@example.com', phone='9000000010', role='admin')

        # Subscribers
        self.user1 = User.objects.create_user(username='sub1@example.com', email='sub1@example.com', password='pass')
        self.user1_token = Token.objects.create(user=self.user1)
        self.user1_profile = UserProfile.objects.create(id='usr_01', user=self.user1, name='Rahul Sharma', email='sub1@example.com', phone='9000000011', role='user')

        self.user2 = User.objects.create_user(username='sub2@example.com', email='sub2@example.com', password='pass')
        self.user2_token = Token.objects.create(user=self.user2)
        self.user2_profile = UserProfile.objects.create(id='usr_02', user=self.user2, name='Priya Sundaram', email='sub2@example.com', phone='9000000012', role='user')

        # Tiers
        self.tier_bronze = ValueTier.objects.create(id='bronze', name='Bronze Tier', min_val=Decimal('50000.00'), max_val=Decimal('100000.00'))
        self.tier_diamond = ValueTier.objects.create(id='diamond', name='Diamond Tier', min_val=Decimal('500000.00'), max_val=Decimal('1000000.00'))

        # 1 Lakh Scheme
        self.scheme_1l = AuctionScheme.objects.create(
            id='SCH-BRZ-1L', name='Lakshya 1.0 Lakh Scheme', tier=self.tier_bronze,
            total_value=Decimal('100000.00'), duration_months=20, monthly_installment=Decimal('5000.00'),
            total_slots=20, booked_slots=2, commission_percent=Decimal('5.00'),
            min_bid_discount=Decimal('5.00'), max_bid_discount=Decimal('30.00'),
            winner_dividend_eligible=False, current_month=1
        )
        self.tkt_1l_u1 = Ticket.objects.create(id='TKT-1L-01', ticket_number=1, scheme=self.scheme_1l, user=self.user1_profile)
        self.tkt_1l_u2 = Ticket.objects.create(id='TKT-1L-02', ticket_number=2, scheme=self.scheme_1l, user=self.user2_profile)

        # 10 Lakh Scheme
        self.scheme_10l = AuctionScheme.objects.create(
            id='SCH-DIA-01', name='Diamond Imperial 10.0 Lakh Pool', tier=self.tier_diamond,
            total_value=Decimal('1000000.00'), duration_months=20, monthly_installment=Decimal('50000.00'),
            total_slots=20, booked_slots=2, commission_percent=Decimal('5.00'),
            min_bid_discount=Decimal('5.00'), max_bid_discount=Decimal('25.00'),
            winner_dividend_eligible=False, current_month=1
        )
        self.tkt_10l_u1 = Ticket.objects.create(id='TKT-10L-01', ticket_number=1, scheme=self.scheme_10l, user=self.user1_profile)
        self.tkt_10l_u2 = Ticket.objects.create(id='TKT-10L-02', ticket_number=2, scheme=self.scheme_10l, user=self.user2_profile)

        # Fill both pools (conclude requires 100% booked) and mark month-1 installments paid
        holder_user = User.objects.create_user(username='holder@example.com', email='holder@example.com', password='pass')
        holder = UserProfile.objects.create(id='usr_holder', user=holder_user, name='Pool Holder', email='holder@example.com', phone='9000000013', role='user')
        for sch, prefix in ((self.scheme_1l, 'TKT-1L'), (self.scheme_10l, 'TKT-10L')):
            for n in range(3, 21):
                Ticket.objects.create(id=f'{prefix}-{n:02d}', ticket_number=n, scheme=sch, user=holder)
            sch.booked_slots = 20
            sch.save()
        for t in (self.tkt_1l_u1, self.tkt_1l_u2, self.tkt_10l_u1, self.tkt_10l_u2):
            MonthlyPayment.objects.create(
                id=f'PAY-{t.id}-M1', ticket=t, scheme=t.scheme, user=t.user, month_number=1,
                month_name='Month 1', base_amount=t.scheme.monthly_installment,
                dividend_discount=Decimal('0.00'), net_payable=t.scheme.monthly_installment,
                due_date='2026-01-10', status='PAID'
            )

        # Active rounds
        self.round_1l = AuctionRound.objects.create(
            id='ROUND-SCH-BRZ-1L-M1', scheme=self.scheme_1l, month_number=1,
            highest_discount_bid=Decimal('5000.00'), leader_name='Rahul Sharma',
            leader_ticket=self.tkt_1l_u1, is_active=True
        )

        self.round_10l = AuctionRound.objects.create(
            id='ROUND-SCH-DIA-01-M1', scheme=self.scheme_10l, month_number=1,
            highest_discount_bid=Decimal('50000.00'), leader_name='Rahul Sharma',
            leader_ticket=self.tkt_10l_u1, is_active=True
        )

    def test_bid_limits_enforced_for_1_lakh(self):
        """For 1 Lakh: min bid discount is 5k (5%), max cap is 30k (30%)"""
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.user2_token.key}')
        
        # Bid exceeding 30k cap
        res_high = self.client.post('/api/auctions/live/', {
            'action': 'bid',
            'discount_amount': '35000.00',
            'scheme_id': 'SCH-BRZ-1L'
        })
        self.assertEqual(res_high.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('cannot exceed maximum discount cap', res_high.data['error'])

        # Valid bid within [5000.01, 30000.00]
        res_valid = self.client.post('/api/auctions/live/', {
            'action': 'bid',
            'discount_amount': '24000.00',
            'scheme_id': 'SCH-BRZ-1L'
        })
        self.assertEqual(res_valid.status_code, status.HTTP_200_OK)
        self.round_1l.refresh_from_db()
        self.assertEqual(self.round_1l.highest_discount_bid, Decimal('24000.00'))

    def test_bid_limits_enforced_for_10_lakh(self):
        """For 10 Lakh: min bid discount is 50k (5%), max cap is 250k (25%)"""
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.user2_token.key}')
        
        # Bid exceeding 250k cap
        res_high = self.client.post('/api/auctions/live/', {
            'action': 'bid',
            'discount_amount': '260000.00',
            'scheme_id': 'SCH-DIA-01'
        })
        self.assertEqual(res_high.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('cannot exceed maximum discount cap', res_high.data['error'])

        # Valid bid for 10L pool
        res_valid = self.client.post('/api/auctions/live/', {
            'action': 'bid',
            'discount_amount': '120000.00',
            'scheme_id': 'SCH-DIA-01'
        })
        self.assertEqual(res_valid.status_code, status.HTTP_200_OK)
        self.round_10l.refresh_from_db()
        self.assertEqual(self.round_10l.highest_discount_bid, Decimal('120000.00'))

    def test_auction_conclude_and_dividend_distribution_1_lakh(self):
        """
        1 Lakh Scheme:
        - Winning Discount: ₹24,000
        - Commission (5% of 1L): ₹5,000
        - Distributable: 24,000 - 5,000 = ₹19,000
        - Eligible members: 20 - 1 = 19
        - Dividend per member: 19,000 / 19 = ₹1,000
        - Net payout to winner: 1,00,000 - 24,000 = ₹76,000
        """
        # Set highest bid to 24000 with winner as user1
        self.round_1l.highest_discount_bid = Decimal('24000.00')
        self.round_1l.leader_ticket = self.tkt_1l_u1
        self.round_1l.leader_name = self.user1_profile.name
        self.round_1l.save()

        # Admin concludes round
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.admin_token.key}')
        res = self.client.post('/api/auctions/live/', {
            'action': 'conclude',
            'scheme_id': 'SCH-BRZ-1L'
        })
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        # Check AuctionRecord
        rec = AuctionRecord.objects.get(scheme=self.scheme_1l, month_number=1)
        self.assertEqual(rec.winning_discount, Decimal('24000.00'))
        self.assertEqual(rec.organizer_commission, Decimal('5000.00'))
        self.assertEqual(rec.distributable_dividend, Decimal('19000.00'))
        self.assertEqual(rec.net_prize_payout, Decimal('76000.00'))
        self.assertEqual(rec.dividend_per_member, Decimal('1000.00'))
        self.assertEqual(rec.rounding_remainder, Decimal('0.00'))

        # Winner ticket marked prized
        self.tkt_1l_u1.refresh_from_db()
        self.assertTrue(self.tkt_1l_u1.has_won_auction)
        self.assertEqual(self.tkt_1l_u1.won_month, 1)
        self.assertEqual(self.tkt_1l_u1.won_payout, Decimal('76000.00'))

        # Non-prized ticket received dividend deduction on next month
        p2 = MonthlyPayment.objects.get(ticket=self.tkt_1l_u2, month_number=2)
        self.assertEqual(p2.base_amount, Decimal('5000.00'))
        self.assertEqual(p2.dividend_discount, Decimal('1000.00'))
        self.assertEqual(p2.net_payable, Decimal('4000.00'))

        # Check ledger entry exists for dividend adjustment
        entry = PaymentLedgerEntry.objects.filter(payment=p2, entry_type='DIVIDEND_ADJUSTMENT').first()
        self.assertIsNotNone(entry)
        self.assertEqual(entry.amount, Decimal('1000.00'))

    def test_auction_conclude_and_dividend_distribution_10_lakh(self):
        """
        10 Lakh Scheme:
        - Winning Discount: ₹1,50,000
        - Commission (5% of 10L): ₹50,000
        - Distributable: 1,50,000 - 50,000 = ₹1,00,000
        - Eligible members: 20 - 1 = 19
        - Dividend per member: floor(1,00,000 / 19) = ₹5,263
        - Remainder: 1,00,000 - (5,263 * 19) = 1,00,000 - 99,997 = ₹3
        - Net payout to winner: 10,00,000 - 1,50,000 = ₹8,50,000
        """
        self.round_10l.highest_discount_bid = Decimal('150000.00')
        self.round_10l.leader_ticket = self.tkt_10l_u1
        self.round_10l.leader_name = self.user1_profile.name
        self.round_10l.save()

        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.admin_token.key}')
        res = self.client.post('/api/auctions/live/', {
            'action': 'conclude',
            'scheme_id': 'SCH-DIA-01'
        })
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        rec = AuctionRecord.objects.get(scheme=self.scheme_10l, month_number=1)
        self.assertEqual(rec.winning_discount, Decimal('150000.00'))
        self.assertEqual(rec.organizer_commission, Decimal('50000.00'))
        self.assertEqual(rec.distributable_dividend, Decimal('100000.00'))
        self.assertEqual(rec.net_prize_payout, Decimal('850000.00'))
        self.assertEqual(rec.dividend_per_member, Decimal('5263.15'))
        self.assertEqual(rec.rounding_remainder, Decimal('0.15'))

        # Check next month payment for non-prized member in 10L scheme
        p2 = MonthlyPayment.objects.get(ticket=self.tkt_10l_u2, month_number=2)
        self.assertEqual(p2.base_amount, Decimal('50000.00'))
        self.assertEqual(p2.dividend_discount, Decimal('5263.15'))
        self.assertEqual(p2.net_payable, Decimal('44736.85'))

