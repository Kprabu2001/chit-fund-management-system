from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    UserProfileViewSet, ValueTierViewSet, AuctionSchemeViewSet,
    TicketViewSet, MonthlyPaymentViewSet, overview_stats, live_auction_view,
    login_view, me_view, profile_view, logout_view, send_otp_view, verify_otp_view,
    razorpay_webhook_view
)

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
    path('auctions/live/', live_auction_view, name='live-auction'),
    path('auction/live/', live_auction_view, name='live-auction-singular'),

    # Router endpoints
    path('', include(router.urls)),
]