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