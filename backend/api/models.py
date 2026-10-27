import datetime

from django.db import models
from django.contrib.auth.models import User
from decimal import Decimal, ROUND_HALF_UP, ROUND_DOWN
from django.core.exceptions import ValidationError

def classify_tier(amount) -> str:
    """
    Classifies a chit fund scheme amount into its unambiguous, non-overlapping tier.
    Convention (Lower-exclusive, Upper-inclusive, with Starter including min):
      - Starter:  ₹25,000 <= amount <= ₹50,000
      - Bronze:   ₹50,000 < amount <= ₹1,00,000  (Includes ₹1,00,000 Lakshya Scheme)
      - Silver:   ₹1,00,000 < amount <= ₹2,00,000 (Includes ₹1,50,000 and ₹2,00,000 Schemes)
      - Gold:     ₹2,00,000 < amount <= ₹5,00,000 (Includes ₹3,00,000 Enterprise Scheme)
      - Diamond:  ₹5,00,000 < amount <= ₹10,00,000 (Includes ₹10,00,000 Elite Scheme)
    Amounts outside [₹25,000, ₹10,00,000] raise ValidationError.
    """
    try:
        val = Decimal(str(amount))
    except Exception as e:
        raise ValidationError(f"Invalid monetary amount: {amount}")

    if val < Decimal('25000.00') or val > Decimal('1000000.00'):
        raise ValidationError(
            f"Scheme amount ₹{val:,.2f} is outside the supported chit tier range (₹25,000 to ₹10,00,000)."
        )

    if Decimal('25000.00') <= val <= Decimal('50000.00'):
        return 'starter'
    elif Decimal('50000.00') < val <= Decimal('100000.00'):
        return 'bronze'
    elif Decimal('100000.00') < val <= Decimal('200000.00'):
        return 'silver'
    elif Decimal('200000.00') < val <= Decimal('500000.00'):
        return 'gold'
    elif Decimal('500000.00') < val <= Decimal('1000000.00'):
        return 'diamond'

class UserProfile(models.Model):
    id = models.CharField(max_length=50, primary_key=True)  # e.g. usr_01, adm_01
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile', null=True, blank=True)
    name = models.CharField(max_length=150)
    email = models.EmailField(unique=True)
    phone = models.CharField(max_length=30)
    role = models.CharField(max_length=20, default='user', choices=[('user', 'User/Member'), ('admin', 'Administrator')])
    city = models.CharField(max_length=100, blank=True, default='')
    kyc_status = models.CharField(max_length=30, default='Pending')
    wallet_balance = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    avatar = models.URLField(max_length=500, blank=True, null=True)
    joined_date = models.DateField(default=datetime.date.today)

    # Payout details (used to pay prizes / dividends) - member-editable
    upi_id = models.CharField(max_length=100, blank=True, default='')
    bank_account_holder = models.CharField(max_length=150, blank=True, default='')
    bank_account_number = models.CharField(max_length=30, blank=True, default='')
    bank_ifsc = models.CharField(max_length=15, blank=True, default='')

    # Nominee - member-editable
    nominee_name = models.CharField(max_length=150, blank=True, default='')
    nominee_relation = models.CharField(max_length=50, blank=True, default='')

    def __str__(self):
        return f"{self.name} ({self.role})"


class ValueTier(models.Model):
    id = models.CharField(max_length=50, primary_key=True)  # starter, bronze, silver, gold, diamond
    name = models.CharField(max_length=100)
    range_label = models.CharField(max_length=100)
    min_val = models.DecimalField(max_digits=12, decimal_places=2)
    max_val = models.DecimalField(max_digits=12, decimal_places=2)
    badge = models.CharField(max_length=100, blank=True)
    color = models.CharField(max_length=50, default='#e2e8f0')
    accent_color = models.CharField(max_length=50, default='#38bdf8')
    icon = models.CharField(max_length=50, default='award')
    description = models.TextField(blank=True)

    def __str__(self):
        return f"{self.name} ({self.range_label})"


class AuctionScheme(models.Model):
    id = models.CharField(max_length=50, primary_key=True)  # SCH-SLV-01
    name = models.CharField(max_length=200)
    tier = models.ForeignKey(ValueTier, on_delete=models.CASCADE, related_name='schemes')
    total_value = models.DecimalField(max_digits=12, decimal_places=2)
    duration_months = models.IntegerField(default=15)
    monthly_installment = models.DecimalField(max_digits=12, decimal_places=2)
    total_slots = models.IntegerField(default=15)
    booked_slots = models.IntegerField(default=0)
    auction_day = models.IntegerField(default=15)
    auction_time = models.CharField(max_length=50, default='06:00 PM')
    current_month = models.IntegerField(default=1)
    status = models.CharField(max_length=30, default='active', choices=[
        ('active', 'Active'),
        ('enrolling', 'Enrolling'),
        ('completed', 'Completed')
    ])
    max_bid_discount = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('30.00'))  # percentage cap
    min_bid_discount = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('5.00'))   # percentage minimum
    commission_percent = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('5.00')) # organizer commission
    winner_dividend_eligible = models.BooleanField(default=False) # whether prize winner shares in dividend
    description = models.TextField(blank=True)
    rules = models.TextField(blank=True)
    created_date = models.DateField(default=datetime.date.today)

    def clean(self):
        if self.duration_months <= 0:
            raise ValidationError("Duration must be at least 1 month.")
        if self.total_slots <= 0:
            raise ValidationError("Total slots must be at least 1.")
        if self.min_bid_discount < Decimal('0.00'):
            raise ValidationError("Minimum bid discount cannot be negative.")
        if self.max_bid_discount > Decimal('100.00'):
            raise ValidationError("Maximum bid discount cannot exceed 100%.")
        if self.min_bid_discount > self.max_bid_discount:
            raise ValidationError(
                f"Minimum bid discount ({self.min_bid_discount}%) cannot exceed maximum bid discount cap ({self.max_bid_discount}%)."
            )
        if self.commission_percent < Decimal('0.00') or self.commission_percent > Decimal('100.00'):
            raise ValidationError("Commission percentage must be between 0% and 100%.")

        expected_total = (self.monthly_installment * Decimal(str(self.duration_months))).quantize(Decimal('0.01'))
        if abs(self.total_value - expected_total) > Decimal('1.00'):
            raise ValidationError(
                f"Total scheme value (₹{self.total_value}) must equal monthly installment (₹{self.monthly_installment}) * duration ({self.duration_months} mo) = ₹{expected_total}."
            )

        # Validate that total_value strictly corresponds to the chosen tier
        expected_tier_id = classify_tier(self.total_value)
        if self.tier_id and self.tier_id != expected_tier_id:
            raise ValidationError(
                f"Scheme value ₹{self.total_value:,.2f} strictly belongs to '{expected_tier_id}' tier, not '{self.tier_id}'."
            )

    def get_statutory_commission(self) -> Decimal:
        """Returns the statutory organizer commission amount in ₹"""
        return (self.total_value * (self.commission_percent / Decimal('100.00'))).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

    def get_min_bid_amount(self) -> Decimal:
        """Returns the minimum bid discount in ₹"""
        return (self.total_value * (self.min_bid_discount / Decimal('100.00'))).quantize(Decimal('0.01'))

    def get_max_bid_amount(self) -> Decimal:
        """Returns the maximum bid discount cap in ₹"""
        return (self.total_value * (self.max_bid_discount / Decimal('100.00'))).quantize(Decimal('0.01'))

    def get_eligible_dividend_members_count(self) -> int:
        """Upper-bound (round 1, nobody prized yet) count of members sharing in the dividend pool.
        Declare Winner uses the actual number of non-prized tickets."""
        if self.winner_dividend_eligible:
            return self.total_slots
        return max(1, self.total_slots - 1)

    def __str__(self):
        return f"{self.name} ({self.id})"


class Ticket(models.Model):
    id = models.CharField(max_length=50, primary_key=True)  # TKT-SLV1-07
    ticket_number = models.IntegerField()
    scheme = models.ForeignKey(AuctionScheme, on_delete=models.CASCADE, related_name='tickets')
    user = models.ForeignKey(UserProfile, on_delete=models.CASCADE, related_name='tickets')
    joined_at_month = models.IntegerField(default=1)
    has_won_auction = models.BooleanField(default=False)
    won_month = models.IntegerField(null=True, blank=True)
    won_payout = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    total_months_paid = models.IntegerField(default=0)
    status = models.CharField(max_length=30, default='active', choices=[
        ('active', 'Active'),
        ('prized', 'Prized (Won)')
    ])
    issued_date = models.DateField(default=datetime.date.today)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['scheme', 'ticket_number'], name='unique_scheme_ticket_number')
        ]

    def __str__(self):
        return f"Ticket #{self.ticket_number} - {self.scheme.name} ({self.user.name})"


class MonthlyPayment(models.Model):
    id = models.CharField(max_length=60, primary_key=True)  # PAY-SLV1-07-M4
    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name='payments')
    scheme = models.ForeignKey(AuctionScheme, on_delete=models.CASCADE, related_name='payments')
    user = models.ForeignKey(UserProfile, on_delete=models.CASCADE, related_name='payments')
    month_number = models.IntegerField()
    month_name = models.CharField(max_length=50)
    base_amount = models.DecimalField(max_digits=12, decimal_places=2)
    dividend_discount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    net_payable = models.DecimalField(max_digits=12, decimal_places=2)
    due_date = models.DateField()
    paid_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, default='DUE', choices=[
        ('PAID', 'Paid'),
        ('DUE', 'Due'),
        ('OVERDUE', 'Overdue'),
        ('UPCOMING', 'Upcoming'),
    ])
    payment_method = models.CharField(max_length=100, null=True, blank=True)
    transaction_ref = models.CharField(max_length=100, null=True, blank=True)
    receipt_number = models.CharField(max_length=100, null=True, blank=True)
    is_verified = models.BooleanField(default=False)
    verified_at = models.DateTimeField(null=True, blank=True)
    # In-app reminder sent by the admin (shown in the member's notification bell)
    reminder_sent_at = models.DateTimeField(null=True, blank=True)
    reminder_count = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['month_number']
        constraints = [
            models.UniqueConstraint(fields=['ticket', 'month_number'], name='unique_ticket_month_payment')
        ]

    def __str__(self):
        return f"{self.month_name} - {self.ticket.id} - {self.status}"


class AuctionRound(models.Model):
    id = models.CharField(max_length=50, primary_key=True)
    scheme = models.ForeignKey(AuctionScheme, on_delete=models.CASCADE, related_name='auction_rounds')
    month_number = models.IntegerField(default=1)
    highest_discount_bid = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    leader_name = models.CharField(max_length=100, blank=True)
    leader_ticket = models.ForeignKey(Ticket, on_delete=models.SET_NULL, null=True, blank=True, related_name='led_rounds')
    # ends_at: server-authoritative auction deadline. time_left_seconds is computed dynamically.
    ends_at = models.DateTimeField(null=True, blank=True)
    time_left_seconds = models.IntegerField(default=600)
    is_active = models.BooleanField(default=True)
    is_concluded = models.BooleanField(default=False)
    concluded_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"Round {self.month_number} for {self.scheme.name} ({'Active' if self.is_active else 'Concluded'})"


class AuctionBid(models.Model):
    round = models.ForeignKey(AuctionRound, on_delete=models.CASCADE, related_name='bids')
    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name='auction_bids', null=True, blank=True)
    bidder = models.ForeignKey(UserProfile, on_delete=models.CASCADE, related_name='auction_bids', null=True, blank=True)
    bidder_name = models.CharField(max_length=100)
    discount_amount = models.DecimalField(max_digits=12, decimal_places=2)
    relative_time = models.CharField(max_length=50, default='Just now')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.bidder_name}: ₹{self.discount_amount}"


class AuctionRecord(models.Model):
    """Immutable audit record of a concluded auction round and dividend allocation"""
    id = models.CharField(max_length=60, primary_key=True)
    scheme = models.ForeignKey(AuctionScheme, on_delete=models.CASCADE, related_name='auction_records')
    month_number = models.IntegerField()
    winner_ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name='won_records')
    winner_user = models.ForeignKey(UserProfile, on_delete=models.CASCADE, related_name='won_records')
    total_chit_value = models.DecimalField(max_digits=12, decimal_places=2)
    winning_discount = models.DecimalField(max_digits=12, decimal_places=2)
    organizer_commission = models.DecimalField(max_digits=12, decimal_places=2)
    distributable_dividend = models.DecimalField(max_digits=12, decimal_places=2)
    eligible_members_count = models.IntegerField()
    dividend_per_member = models.DecimalField(max_digits=12, decimal_places=2)
    rounding_remainder = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    net_prize_payout = models.DecimalField(max_digits=12, decimal_places=2)
    concluded_at = models.DateTimeField(auto_now_add=True)
    concluded_by = models.ForeignKey(UserProfile, on_delete=models.SET_NULL, null=True, blank=True, related_name='concluded_records')

    class Meta:
        ordering = ['-concluded_at']
        constraints = [
            models.UniqueConstraint(fields=['scheme', 'month_number'], name='unique_scheme_concluded_month')
        ]

    def __str__(self):
        return f"Auction Record {self.scheme.name} Month #{self.month_number} (Winner: {self.winner_user.name})"


class PrizePayout(models.Model):
    """Prize owed to the winner of one auction month. Created as PENDING when the
    winner is declared and flipped to PAID when the admin records the UTR."""
    STATUS_CHOICES = [('PENDING', 'Pending'), ('PAID', 'Paid')]

    id = models.CharField(max_length=80, primary_key=True)  # PAYOUT-<scheme>-M<month>
    auction_record = models.OneToOneField(AuctionRecord, on_delete=models.CASCADE, related_name='payout')
    scheme = models.ForeignKey(AuctionScheme, on_delete=models.CASCADE, related_name='prize_payouts')
    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name='prize_payouts')
    user = models.ForeignKey(UserProfile, on_delete=models.CASCADE, related_name='prize_payouts')
    month_number = models.IntegerField()
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    status = models.CharField(max_length=10, default='PENDING', choices=STATUS_CHOICES)
    utr = models.CharField(max_length=100, blank=True, default='')
    paid_by = models.ForeignKey(UserProfile, on_delete=models.SET_NULL, null=True, blank=True, related_name='paid_out_prizes')
    paid_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    # How it was paid (masked destination only; full details are never copied off the profile)
    method = models.CharField(max_length=10, blank=True, default='', choices=[('', 'Not set'), ('UPI', 'UPI'), ('BANK', 'Bank transfer')])
    destination = models.CharField(max_length=200, blank=True, default='')
    notes = models.CharField(max_length=300, blank=True, default='')
    # Admin "Remind member" nudges when the winner has no payout details saved
    details_reminder_sent_at = models.DateTimeField(null=True, blank=True)
    details_reminder_count = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"Payout {self.id}: ₹{self.amount} ({self.status})"


class PrizePayoutLedgerEntry(models.Model):
    """Append-only audit log of prize payout events (payment recorded, member reminded)."""
    id = models.BigAutoField(primary_key=True)
    payout = models.ForeignKey(PrizePayout, on_delete=models.CASCADE, related_name='ledger_entries')
    entry_type = models.CharField(max_length=20, choices=[('PAID', 'Prize paid'), ('REMINDER', 'Details reminder sent')])
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    method = models.CharField(max_length=10, blank=True, default='')
    destination = models.CharField(max_length=200, blank=True, default='')
    transaction_ref = models.CharField(max_length=100, blank=True, default='')
    performed_by = models.ForeignKey(UserProfile, on_delete=models.SET_NULL, null=True, blank=True, related_name='prize_ledger_entries')
    notes = models.CharField(max_length=300, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at', '-id']

    def __str__(self):
        return f"{self.entry_type} {self.payout_id} ₹{self.amount}"


class AuctionCorrection(models.Model):
    """Append-only audit trail: a declared winner that was reverted while the payout was still pending."""
    id = models.BigAutoField(primary_key=True)
    scheme = models.ForeignKey(AuctionScheme, on_delete=models.CASCADE, related_name='auction_corrections')
    month_number = models.IntegerField()
    old_winner_ticket_id = models.CharField(max_length=50)
    old_winner_name = models.CharField(max_length=150)
    old_discount = models.DecimalField(max_digits=12, decimal_places=2)
    old_net_prize = models.DecimalField(max_digits=12, decimal_places=2)
    reason = models.TextField(blank=True, default='')
    corrected_by = models.ForeignKey(UserProfile, on_delete=models.SET_NULL, null=True, blank=True, related_name='auction_corrections')
    corrected_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-corrected_at']

    def __str__(self):
        return f"Correction {self.scheme_id} M{self.month_number}: {self.old_winner_name}"


class PaymentLedgerEntry(models.Model):
    """Append-only financial audit log for all payment, dividend and reconciliation events"""
    id = models.BigAutoField(primary_key=True)
    payment = models.ForeignKey(MonthlyPayment, on_delete=models.CASCADE, related_name='ledger_entries')
    user = models.ForeignKey(UserProfile, on_delete=models.CASCADE, related_name='ledger_entries')
    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name='ledger_entries')
    entry_type = models.CharField(max_length=30, choices=[
        ('ONLINE_SETTLEMENT', 'Online Settlement (Demo Gateway)'),
        ('OFFLINE_RECONCILE', 'Offline Reconciliation (Admin)'),
        ('DIVIDEND_ADJUSTMENT', 'Dividend Discount Adjustment'),
        ('REFUND', 'Payment Refund'),
    ])
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    previous_status = models.CharField(max_length=20)
    new_status = models.CharField(max_length=20)
    transaction_ref = models.CharField(max_length=100)
    receipt_number = models.CharField(max_length=100, null=True, blank=True)
    performed_by = models.ForeignKey(UserProfile, on_delete=models.SET_NULL, null=True, blank=True, related_name='performed_ledger_entries')
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"[{self.entry_type}] {self.payment.id}: ₹{self.amount} ({self.new_status})"


class PhoneOTP(models.Model):
    """Model to store SMS verification OTPs for phone-based authentication"""
    id = models.BigAutoField(primary_key=True)
    phone = models.CharField(max_length=20, db_index=True)
    otp_code = models.CharField(max_length=6)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    attempts = models.IntegerField(default=0)
    is_used = models.BooleanField(default=False)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"OTP for {self.phone} - {'Used' if self.is_used else 'Active'}"


class RazorpayQRCode(models.Model):
    """
    Stores dynamic, amount-specific Razorpay UPI QR code sessions.
    Bound to a specific MonthlyPayment installment, ensuring the amount
    is computed server-side from the database and prevents tampering/overpayment.
    """
    id = models.CharField(max_length=100, primary_key=True)
    payment = models.ForeignKey(MonthlyPayment, on_delete=models.CASCADE, related_name='razorpay_qrs')
    user = models.ForeignKey(UserProfile, on_delete=models.CASCADE, related_name='razorpay_qrs')
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    amount_paise = models.BigIntegerField()
    currency = models.CharField(max_length=10, default='INR')
    status = models.CharField(max_length=30, default='active', choices=[
        ('created', 'Created'),
        ('active', 'Active'),
        ('paid', 'Paid'),
        ('expired', 'Expired'),
        ('closed', 'Closed'),
        ('failed', 'Failed'),
    ])
    image_url = models.TextField(help_text="QR Code image URL or data URI")
    upi_intent_url = models.TextField(blank=True, null=True, help_text="Direct UPI deep link (upi://pay?...)")
    close_by = models.BigIntegerField(null=True, blank=True, help_text="Expiry Unix timestamp")
    razorpay_payment_id = models.CharField(max_length=100, null=True, blank=True)
    razorpay_signature = models.TextField(null=True, blank=True)
    is_verified = models.BooleanField(default=False)
    verified_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    @property
    def is_expired(self) -> bool:
        if not self.close_by:
            return False
        import time
        return time.time() > self.close_by

    def __str__(self):
        return f"QR {self.id} for {self.payment_id} - ₹{self.amount} ({self.status})"


class RazorpayWebhookEvent(models.Model):
    """
    Idempotent audit store for Razorpay webhook events to prevent duplicate credits.
    """
    event_id = models.CharField(max_length=100, primary_key=True)
    event_type = models.CharField(max_length=100)
    payload = models.JSONField(default=dict)
    processed_at = models.DateTimeField(auto_now_add=True)
    status = models.CharField(max_length=30, default='PROCESSED')

    class Meta:
        ordering = ['-processed_at']

    def __str__(self):
        return f"{self.event_type} ({self.event_id})"