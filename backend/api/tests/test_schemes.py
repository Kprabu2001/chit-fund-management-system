from django.test import TestCase
from django.core.exceptions import ValidationError
from decimal import Decimal
from api.models import ValueTier, AuctionScheme

class ChitSchemeLogicTests(TestCase):
    def setUp(self):
        self.tier = ValueTier.objects.create(
            id='bronze', name='Bronze Tier', range_label='50k - 1L',
            min_val=Decimal('50000.00'), max_val=Decimal('100000.00')
        )

    def test_one_lakh_scheme_valid(self):
        """Verify the ₹1,00,000 Scheme logic (20 members x 20 months x ₹5,000)"""
        scheme = AuctionScheme(
            id='SCH-BRZ-1L',
            name='Lakshya 1.0 Lakh Chit Scheme',
            tier=self.tier,
            total_value=Decimal('100000.00'),
            duration_months=20,
            monthly_installment=Decimal('5000.00'),
            total_slots=20,
            commission_percent=Decimal('5.00')
        )
        # clean() should pass without ValidationError
        scheme.clean()
        scheme.save()

        # Check total collection calculation
        total_monthly_collection = scheme.monthly_installment * scheme.total_slots
        self.assertEqual(total_monthly_collection, Decimal('100000.00'))
        self.assertEqual(scheme.total_value, total_monthly_collection)

    def test_scheme_invalid_installment_rejected(self):
        """Reject scheme where total_value != monthly_installment * duration_months"""
        scheme = AuctionScheme(
            id='SCH-INVALID-01',
            name='Inconsistent Scheme',
            tier=self.tier,
            total_value=Decimal('100000.00'),
            duration_months=20,
            monthly_installment=Decimal('4000.00'), # 4000 * 20 = 80000 != 100000
            total_slots=20
        )
        with self.assertRaises(ValidationError):
            scheme.clean()

    def test_scheme_zero_duration_rejected(self):
        scheme = AuctionScheme(
            id='SCH-INVALID-02',
            name='Zero Duration',
            tier=self.tier,
            total_value=Decimal('100000.00'),
            duration_months=0,
            monthly_installment=Decimal('5000.00'),
            total_slots=20
        )
        with self.assertRaises(ValidationError):
            scheme.clean()
