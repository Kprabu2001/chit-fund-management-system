from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    UserProfileViewSet, ValueTierViewSet, AuctionSchemeViewSet,
    TicketViewSet, MonthlyPaymentViewSet, overview_stats,
    login_view, me_view, profile_view, logout_view, send_otp_view, verify_otp_view,
    razorpay_webhook_view
)
from .winner_views import declare_winner_view, revert_winner_view
from .payout_views import payout_list_view, payout_detail_view, payout_mark_paid_view, payout_remind_view, auction_results_view

router = DefaultRouter()
router.register(r'users', UserProfileViewSet, basename='user')
router.register(r'tiers', ValueTierViewSet, basename='tier')
router.register(r'schemes', AuctionSchemeViewSet, basename='scheme')
router.register(r'tickets', TicketViewSet, basename='ticket')
router.register(r'payments', MonthlyPaymentViewSet, basename='payment')

urlpatterns = [
    # Auth endpoints
    path('auth/send-otp/', send_otp_view, name='auth-send-otp'),
    path('auth/verify-otp/', verify_otp_view, name='auth-verify-otp'),
    path('auth/login/', login_view, name='auth-login'),
    path('auth/me/', me_view, name='auth-me'),
    path('auth/profile/', profile_view, name='auth-profile'),
    path('auth/logout/', logout_view, name='auth-logout'),

    # Razorpay Webhook endpoints (Accessible by Razorpay webhook servers)
    path('payments/webhook/', razorpay_webhook_view, name='razorpay-webhook'),
    path('webhook/razorpay/', razorpay_webhook_view, name='razorpay-webhook-alias'),

    # Financial & auction endpoints
    path('overview-stats/', overview_stats, name='overview-stats'),
    path('auctions/declare-winner/', declare_winner_view, name='declare-winner'),
    path('auctions/revert-winner/', revert_winner_view, name='revert-winner'),
    path('auctions/results/', auction_results_view, name='auction-results'),
    path('auctions/payouts/', payout_list_view, name='payout-list'),
    path('auctions/payouts/<str:payout_id>/', payout_detail_view, name='payout-detail'),
    path('auctions/payouts/<str:payout_id>/mark-paid/', payout_mark_paid_view, name='payout-mark-paid'),
    path('auctions/payouts/<str:payout_id>/remind/', payout_remind_view, name='payout-remind'),

    # Router endpoints
    path('', include(router.urls)),
]