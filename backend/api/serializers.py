import re
from rest_framework import serializers
from .models import (
    UserProfile, ValueTier, AuctionScheme, Ticket,
    MonthlyPayment, AuctionRound, AuctionBid, AuctionRecord, PaymentLedgerEntry,
    RazorpayQRCode, classify_tier
)

class UserProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserProfile
        fields = [
            'id', 'name', 'email', 'phone', 'role', 'city',
            'kyc_status', 'wallet_balance', 'avatar', 'joined_date'
        ]
        read_only_fields = ['role', 'wallet_balance']


class ProfileDetailSerializer(serializers.ModelSerializer):
    """Self-service profile: only the fields a member may edit about themselves."""

    class Meta:
        model = UserProfile
        fields = [
            'id', 'name', 'email', 'phone', 'role', 'city', 'kyc_status', 'joined_date',
            'upi_id', 'bank_account_holder', 'bank_account_number', 'bank_ifsc',
            'nominee_name', 'nominee_relation',
        ]
        read_only_fields = ['id', 'phone', 'role', 'kyc_status', 'joined_date']

    def validate_name(self, value):
        value = value.strip()
        if len(value) < 2:
            raise serializers.ValidationError('Please enter your full name.')
        return value

    def validate_email(self, value):
        value = value.strip().lower()
        qs = UserProfile.objects.filter(email__iexact=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError('This email is already used by another account.')
        return value

    def validate_upi_id(self, value):
        value = value.strip()
        if value and not re.fullmatch(r'[A-Za-z0-9._\-]{2,256}@[A-Za-z]{2,64}', value):
            raise serializers.ValidationError('Enter a valid UPI ID, e.g. name@bank.')
        return value

    def validate_bank_account_number(self, value):
        value = re.sub(r'\s+', '', value or '')
        if value and not re.fullmatch(r'\d{9,18}', value):
            raise serializers.ValidationError('Account number must be 9 to 18 digits.')
        return value

    def validate_bank_ifsc(self, value):
        value = (value or '').strip().upper()
        if value and not re.fullmatch(r'[A-Z]{4}0[A-Z0-9]{6}', value):
            raise serializers.ValidationError('Enter a valid 11-character IFSC code, e.g. HDFC0001234.')
        return value

    def validate(self, attrs):
        inst = self.instance
        number = attrs.get('bank_account_number', getattr(inst, 'bank_account_number', ''))
        ifsc = attrs.get('bank_ifsc', getattr(inst, 'bank_ifsc', ''))
        holder = attrs.get('bank_account_holder', getattr(inst, 'bank_account_holder', ''))
        if number or ifsc:
            if not number:
                raise serializers.ValidationError({'bank_account_number': 'Enter the account number.'})
            if not ifsc:
                raise serializers.ValidationError({'bank_ifsc': 'Enter the IFSC code.'})
            if not (holder or '').strip():
                raise serializers.ValidationError({'bank_account_holder': 'Enter the account holder name.'})
        return attrs


class ValueTierSerializer(serializers.ModelSerializer):
    class Meta:
        model = ValueTier
        fields = '__all__'


class AuctionSchemeSerializer(serializers.ModelSerializer):
    tier_id = serializers.ReadOnlyField(source='tier.id')
    tier_name = serializers.ReadOnlyField(source='tier.name')
    tier_range = serializers.ReadOnlyField(source='tier.range_label')
    min_bid_amount = serializers.SerializerMethodField()
    max_bid_amount = serializers.SerializerMethodField()
    statutory_commission = serializers.SerializerMethodField()

    class Meta:
        model = AuctionScheme
        fields = '__all__'

    def get_min_bid_amount(self, obj):
        return float(obj.get_min_bid_amount())

    def get_max_bid_amount(self, obj):
        return float(obj.get_max_bid_amount())

    def get_statutory_commission(self, obj):
        return float(obj.get_statutory_commission())

    def to_internal_value(self, data):
        # Support tierId sent from frontend as tier
        data = data.copy() if hasattr(data, 'copy') else dict(data)
        if 'tierId' in data and 'tier' not in data:
            data['tier'] = data['tierId']
        if 'totalValue' in data and 'total_value' not in data:
            data['total_value'] = data['totalValue']
        if 'durationMonths' in data and 'duration_months' not in data:
            data['duration_months'] = data['durationMonths']
        if 'monthlyInstallment' in data and 'monthly_installment' not in data:
            data['monthly_installment'] = data['monthlyInstallment']
        if 'totalSlots' in data and 'total_slots' not in data:
            data['total_slots'] = data['totalSlots']
        if 'auctionDay' in data and 'auction_day' not in data:
            data['auction_day'] = data['auctionDay']
        if 'auctionTime' in data and 'auction_time' not in data:
            data['auction_time'] = data['auctionTime']
        if 'maxBidDiscount' in data and 'max_bid_discount' not in data:
            data['max_bid_discount'] = data['maxBidDiscount']
        if 'minBidDiscount' in data and 'min_bid_discount' not in data:
            data['min_bid_discount'] = data['minBidDiscount']
        if 'commissionPercent' in data and 'commission_percent' not in data:
            data['commission_percent'] = data['commissionPercent']

        # Auto-classify tier if not passed or missing
        if 'total_value' in data and ('tier' not in data or not data['tier']):
            try:
                data['tier'] = classify_tier(data['total_value'])
            except Exception:
                pass

        # Same name already used (e.g. a second "1 Lakh Chit")? Create it as a NEW chit with a
        # numbered title: "1 Lakh Chit" -> "1 Lakh Chit (1)" -> "1 Lakh Chit (2)" ...
        if self.instance is None and data.get('name'):
            import re
            base = re.sub(r'\s*(\(\d+\)|[–-]\s*Series\s+[A-Z]+)\s*$', '', str(data['name'])).strip()
            taken = {n.lower() for n in AuctionScheme.objects.filter(name__istartswith=base).values_list('name', flat=True)}
            name = base
            i = 0
            while name.lower() in taken:
                i += 1
                name = f"{base} ({i})"
            data['name'] = name

        # Admin form doesn't send an id: auto-generate one (e.g. SCH-SILVER-1P8L-A1B2C3)
        if not data.get('id'):
            import uuid
            tier_code = str(data.get('tier') or 'SCH').upper()
            try:
                lakhs = f"{float(data.get('total_value')) / 100000:g}".replace('.', 'P')
            except (TypeError, ValueError):
                lakhs = 'X'
            data['id'] = f"SCH-{tier_code}-{lakhs}L-{uuid.uuid4().hex[:6].upper()}"

        return super().to_internal_value(data)

    def validate(self, attrs):
        """
        Run the model's full_clean() on the in-memory instance so that
        tier classification, installment × duration, and bid-discount sanity
        checks are enforced through the API (not just in the admin).
        Also enforces total_slots == duration_months.
        """
        duration = attrs.get('duration_months')
        slots = attrs.get('total_slots')
        if duration is not None and slots is not None and slots != duration:
            raise serializers.ValidationError(
                f"total_slots ({slots}) must equal duration_months ({duration}) for a standard chit fund scheme."
            )
        # Build a temporary model instance to run clean()
        instance = AuctionScheme(**{k: v for k, v in attrs.items() if k != 'tier'})
        if 'tier' in attrs:
            instance.tier = attrs['tier']
            instance.tier_id = attrs['tier'].id if hasattr(attrs['tier'], 'id') else attrs['tier']
        try:
            instance.clean()
        except Exception as exc:
            raise serializers.ValidationError(str(exc))
        return attrs


class TicketSerializer(serializers.ModelSerializer):
    scheme_name = serializers.ReadOnlyField(source='scheme.name')
    tier_id = serializers.ReadOnlyField(source='scheme.tier.id')
    user_name = serializers.ReadOnlyField(source='user.name')
    user_email = serializers.ReadOnlyField(source='user.email')
    total_slots = serializers.ReadOnlyField(source='scheme.total_slots')
    duration_months = serializers.ReadOnlyField(source='scheme.duration_months')
    monthly_installment = serializers.ReadOnlyField(source='scheme.monthly_installment')

    class Meta:
        model = Ticket
        fields = '__all__'


class MonthlyPaymentSerializer(serializers.ModelSerializer):
    scheme_name = serializers.ReadOnlyField(source='scheme.name')
    tier_id = serializers.ReadOnlyField(source='scheme.tier.id')
    user_name = serializers.ReadOnlyField(source='user.name')
    ticket_id = serializers.ReadOnlyField(source='ticket.id')

    class Meta:
        model = MonthlyPayment
        fields = '__all__'


class AuctionBidSerializer(serializers.ModelSerializer):
    class Meta:
        model = AuctionBid
        fields = '__all__'


class AuctionRoundSerializer(serializers.ModelSerializer):
    scheme_name = serializers.ReadOnlyField(source='scheme.name')
    tier_id = serializers.ReadOnlyField(source='scheme.tier.id')
    total_value = serializers.ReadOnlyField(source='scheme.total_value')
    total_slots = serializers.ReadOnlyField(source='scheme.total_slots')
    monthly_installment = serializers.ReadOnlyField(source='scheme.monthly_installment')
    duration_months = serializers.ReadOnlyField(source='scheme.duration_months')
    commission_percent = serializers.ReadOnlyField(source='scheme.commission_percent')
    min_bid_discount = serializers.ReadOnlyField(source='scheme.min_bid_discount')
    max_bid_discount = serializers.ReadOnlyField(source='scheme.max_bid_discount')
    winner_dividend_eligible = serializers.ReadOnlyField(source='scheme.winner_dividend_eligible')
    min_bid_amount = serializers.SerializerMethodField()
    max_bid_amount = serializers.SerializerMethodField()
    # Dynamically computed from ends_at so the client gets an accurate countdown
    time_left_seconds = serializers.SerializerMethodField()
    leader_user_id = serializers.SerializerMethodField()
    bids = AuctionBidSerializer(many=True, read_only=True)

    class Meta:
        model = AuctionRound
        fields = '__all__'

    def get_min_bid_amount(self, obj):
        return float(obj.scheme.get_min_bid_amount()) if obj.scheme else 0.0

    def get_max_bid_amount(self, obj):
        return float(obj.scheme.get_max_bid_amount()) if obj.scheme else 0.0

    def get_leader_user_id(self, obj):
        return obj.leader_ticket.user_id if obj.leader_ticket_id else None

    def get_time_left_seconds(self, obj):
        from django.utils import timezone
        if obj.ends_at and obj.is_active:
            return max(0, int((obj.ends_at - timezone.now()).total_seconds()))
        if obj.is_active and not obj.ends_at:
            return max(0, int(obj.time_left_seconds or 0))
        return 0


class AuctionRecordSerializer(serializers.ModelSerializer):
    scheme_name = serializers.ReadOnlyField(source='scheme.name')
    winner_name = serializers.ReadOnlyField(source='winner_user.name')

    class Meta:
        model = AuctionRecord
        fields = '__all__'


class PaymentLedgerEntrySerializer(serializers.ModelSerializer):
    user_name = serializers.ReadOnlyField(source='user.name')

    class Meta:
        model = PaymentLedgerEntry
        fields = '__all__'


class RazorpayQRCodeSerializer(serializers.ModelSerializer):
    scheme_name = serializers.ReadOnlyField(source='payment.scheme.name')
    month_name = serializers.ReadOnlyField(source='payment.month_name')
    ticket_id = serializers.ReadOnlyField(source='payment.ticket.id')
    user_name = serializers.ReadOnlyField(source='user.name')

    class Meta:
        model = RazorpayQRCode
        fields = [
            'id', 'payment', 'scheme_name', 'month_name', 'ticket_id',
            'user_name', 'amount', 'amount_paise', 'currency', 'status',
            'image_url', 'upi_intent_url', 'close_by', 'razorpay_payment_id',
            'is_verified', 'verified_at', 'created_at'
        ]
        read_only_fields = fields