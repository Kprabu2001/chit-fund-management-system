from django.contrib import admin
from .models import (
    UserProfile, ValueTier, AuctionScheme, Ticket,
    MonthlyPayment, AuctionRound, AuctionBid, AuctionRecord, PaymentLedgerEntry, PhoneOTP
)

@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ('id', 'name', 'email', 'phone', 'role', 'kyc_status', 'wallet_balance')
    search_fields = ('name', 'email', 'phone')
    list_filter = ('role', 'kyc_status')

@admin.register(ValueTier)
class ValueTierAdmin(admin.ModelAdmin):
    list_display = ('id', 'name', 'range_label', 'min_val', 'max_val', 'badge')

@admin.register(AuctionScheme)
class AuctionSchemeAdmin(admin.ModelAdmin):
    list_display = ('id', 'name', 'tier', 'total_value', 'duration_months', 'monthly_installment', 'booked_slots', 'total_slots', 'commission_percent', 'status')
    list_filter = ('tier', 'status')
    search_fields = ('name', 'id')

@admin.register(Ticket)
class TicketAdmin(admin.ModelAdmin):
    list_display = ('id', 'ticket_number', 'scheme', 'user', 'total_months_paid', 'has_won_auction', 'status')
    list_filter = ('status', 'has_won_auction', 'scheme')
    search_fields = ('id', 'user__name', 'scheme__name')

@admin.register(MonthlyPayment)
class MonthlyPaymentAdmin(admin.ModelAdmin):
    list_display = ('id', 'ticket', 'scheme', 'user', 'month_name', 'base_amount', 'dividend_discount', 'net_payable', 'due_date', 'status')
    list_filter = ('status', 'month_number', 'scheme')
    search_fields = ('id', 'user__name', 'scheme__name', 'transaction_ref', 'receipt_number')

@admin.register(AuctionRound)
class AuctionRoundAdmin(admin.ModelAdmin):
    list_display = ('id', 'scheme', 'month_number', 'highest_discount_bid', 'leader_name', 'is_active', 'is_concluded')

@admin.register(AuctionBid)
class AuctionBidAdmin(admin.ModelAdmin):
    list_display = ('round', 'bidder_name', 'discount_amount', 'relative_time', 'created_at')

@admin.register(AuctionRecord)
class AuctionRecordAdmin(admin.ModelAdmin):
    list_display = ('id', 'scheme', 'month_number', 'winner_user', 'winning_discount', 'organizer_commission', 'dividend_per_member', 'concluded_at')
    list_filter = ('scheme', 'month_number')
    search_fields = ('id', 'winner_user__name', 'scheme__name')

@admin.register(PaymentLedgerEntry)
class PaymentLedgerEntryAdmin(admin.ModelAdmin):
    list_display = ('id', 'payment', 'user', 'entry_type', 'amount', 'new_status', 'transaction_ref', 'created_at')
    list_filter = ('entry_type', 'new_status')
    search_fields = ('transaction_ref', 'receipt_number', 'user__name')

@admin.register(PhoneOTP)
class PhoneOTPAdmin(admin.ModelAdmin):
    list_display = ('id', 'phone', 'otp_code', 'attempts', 'is_used', 'expires_at', 'created_at')
    list_filter = ('is_used', 'created_at')
    search_fields = ('phone', 'otp_code')
