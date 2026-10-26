from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response
from rest_framework.authtoken.models import Token
from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.conf import settings
from django.db import transaction
from django.db.models import Sum, Q
from django.utils import timezone
from decimal import Decimal, InvalidOperation, ROUND_DOWN, ROUND_HALF_UP
import random
import datetime
import re
import secrets
import uuid
import logging

from .models import (
    UserProfile, ValueTier, AuctionScheme, Ticket,
    MonthlyPayment, AuctionRound, AuctionBid, AuctionRecord, PaymentLedgerEntry, PhoneOTP,
    RazorpayQRCode, RazorpayWebhookEvent
)
from .serializers import (
    UserProfileSerializer, ValueTierSerializer, AuctionSchemeSerializer,
    TicketSerializer, MonthlyPaymentSerializer, AuctionRoundSerializer,
    AuctionBidSerializer, AuctionRecordSerializer, PaymentLedgerEntrySerializer,
    RazorpayQRCodeSerializer, ProfileDetailSerializer
)
from .razorpay_service import (
    create_dynamic_upi_qr, check_and_sync_qr_status,
    verify_razorpay_signature, settle_payment_atomically
)

logger = logging.getLogger(__name__)


# --- Custom Permission Classes ---
class IsAdminUserRole(permissions.BasePermission):
    """Allows access only to users with role == 'admin' or is_staff == True"""
    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False
        if request.user.is_staff:
            return True
        profile = getattr(request.user, 'profile', None)
        return bool(profile and profile.role == 'admin')


class IsOwnerOrAdmin(permissions.BasePermission):
    """Allows full access to administrators, but only self-access to regular members"""
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated)

    def has_object_permission(self, request, view, obj):
        if request.user.is_staff:
            return True
        profile = getattr(request.user, 'profile', None)
        if profile and profile.role == 'admin':
            return True
        # Fix: compare UserProfile to UserProfile, not User to UserProfile
        if hasattr(obj, 'user') and isinstance(obj.user, UserProfile):
            return obj.user == profile
        if isinstance(obj, UserProfile):
            return obj == profile
        return False


def _is_admin(request):
    """Helper: returns True if the request user is an admin or staff."""
    profile = getattr(request.user, 'profile', None)
    return request.user.is_staff or (bool(profile and profile.role == 'admin'))


# --- Mathematical Dividend & Chit Distribution Engine ---
def calculate_auction_distribution(scheme: AuctionScheme, winning_discount: Decimal, eligible_count: int):
    """
    Computes exact, statutory-compliant chit fund dividend distribution.
    eligible_count is passed in from the caller (number of non-prized, paying members).
    - Commission = Total Value * (Commission % / 100)
    - Distributable Dividend = Winning Discount - Commission
    - Dividend per Member = floor(Distributable / eligible_count) to 2 decimal places
    - Remainder = Distributable - (Dividend per Member * eligible_count)
    - Net Prize Payout = Total Value - Winning Discount
    """
    total_val = Decimal(str(scheme.total_value))
    win_disc = Decimal(str(winning_discount))
    comm_pct = Decimal(str(scheme.commission_percent))

    commission = (total_val * (comm_pct / Decimal('100.00'))).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    distributable = max(Decimal('0.00'), win_disc - commission)

    safe_count = max(1, eligible_count)
    dividend_per_member = (distributable / Decimal(str(safe_count))).quantize(Decimal('0.01'), rounding=ROUND_DOWN)
    remainder = distributable - (dividend_per_member * Decimal(str(safe_count)))
    winner_payout = total_val - win_disc

    return {
        'total_chit_value': total_val,
        'winning_discount': win_disc,
        'commission': commission,
        'distributable_dividend': distributable,
        'eligible_count': safe_count,
        'dividend_per_member': dividend_per_member,
        'remainder': remainder,
        'winner_payout': winner_payout,
    }


# --- Phone SMS OTP Authentication Helpers & Endpoints ---
def normalize_phone_number(raw_phone):
    """
    Normalizes a phone string into standard 10-digit format for India.
    Accepts: '+91 98765 43210', '9876543210', '09876543210', '+919876543210'
    Returns: '9876543210' or None if invalid.
    """
    if not raw_phone:
        return None
    digits = re.sub(r'\D', '', str(raw_phone))
    if digits.startswith('91') and len(digits) == 12:
        digits = digits[2:]
    elif digits.startswith('0') and len(digits) == 11:
        digits = digits[1:]
    if len(digits) == 10:
        return digits
    return None


# In-memory backup store for OTP verification
IN_MEMORY_OTP_STORE = {}

# Demo phone whitelist — only active in DEBUG mode
_DEBUG_DEMO_PHONES = ['9876543210', '9999988888', '9822011223', '9911233445']
_DEBUG_DEMO_OTP = '123456'


@api_view(['POST'])
@permission_classes([permissions.AllowAny])
def send_otp_view(request):
    """
    Generates and dispatches a 6-digit OTP via SMS to the provided phone number.
    Rate-limited to prevent SMS flooding (30 second cooldown).
    demo_otp is only included in the response when DEBUG=True.
    """
    raw_phone = request.data.get('phone', '')
    phone = normalize_phone_number(raw_phone)
    if not phone:
        return Response(
            {'error': 'Please enter a valid 10-digit mobile phone number.'},
            status=status.HTTP_400_BAD_REQUEST
        )

    # Rate limiting: 30-second cooldown
    cooldown_threshold = timezone.now() - datetime.timedelta(seconds=30)
    try:
        recent_otp = PhoneOTP.objects.filter(phone=phone, created_at__gte=cooldown_threshold).first()
        if recent_otp:
            return Response(
                {'error': 'Please wait 30 seconds before requesting another SMS OTP.'},
                status=status.HTTP_429_TOO_MANY_REQUESTS
            )
        # Invalidate previous unused OTPs for this phone
        PhoneOTP.objects.filter(phone=phone, is_used=False).update(is_used=True)
    except Exception:
        # Check in-memory rate limiting
        recent_mem = IN_MEMORY_OTP_STORE.get(phone)
        if recent_mem and recent_mem.get('created_at', timezone.now()) >= cooldown_threshold:
            return Response(
                {'error': 'Please wait 30 seconds before requesting another SMS OTP.'},
                status=status.HTTP_429_TOO_MANY_REQUESTS
            )

    # Generate cryptographically secure 6-digit OTP
    otp_code = f"{secrets.randbelow(900000) + 100000}"
    expires_at = timezone.now() + datetime.timedelta(minutes=5)

    try:
        PhoneOTP.objects.create(
            phone=phone,
            otp_code=otp_code,
            expires_at=expires_at
        )
    except Exception:
        pass

    IN_MEMORY_OTP_STORE[phone] = {
        'otp_code': otp_code,
        'expires_at': expires_at,
        'attempts': 0,
        'created_at': timezone.now()
    }

    # Simulated SMS gateway dispatch log
    print(f"\n[SMS GATEWAY DISPATCH] Sent to +91-{phone}: Your AuctionTicket Pro verification OTP is {otp_code}. Valid for 5 minutes.\n")

    response_data = {
        'message': f'OTP sent via SMS successfully to +91 {phone[:2]}******{phone[-2:]}.',
        'phone': phone,
        'expires_in_seconds': 300
    }
    # Only expose the OTP in DEBUG mode (for demo/testing convenience)
    if settings.DEBUG:
        response_data['demo_otp'] = otp_code

    return Response(response_data, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([permissions.AllowAny])
def verify_otp_view(request):
    """
    Verifies SMS OTP for the phone number and authenticates the user,
    issuing a Django REST Framework auth token.
    The hardcoded '123456' backdoor is only active when DEBUG=True.
    """
    raw_phone = request.data.get('phone', '')
    otp_input = str(request.data.get('otp', '')).strip()

    phone = normalize_phone_number(raw_phone)
    if not phone:
        return Response(
            {'error': 'Invalid phone number format. 10-digit mobile number required.'},
            status=status.HTTP_400_BAD_REQUEST
        )

    if not otp_input or len(otp_input) != 6:
        return Response(
            {'error': 'Please enter a valid 6-digit verification OTP.'},
            status=status.HTTP_400_BAD_REQUEST
        )

    # Find the latest unused OTP for this phone (database first, in-memory fallback)
    otp_record = None
    try:
        otp_record = PhoneOTP.objects.filter(phone=phone, is_used=False).first()
    except Exception:
        pass

    actual_code = None
    is_expired = False
    attempts = 0

    if otp_record:
        actual_code = otp_record.otp_code
        is_expired = otp_record.expires_at < timezone.now()
        attempts = otp_record.attempts
    elif phone in IN_MEMORY_OTP_STORE:
        mem_otp = IN_MEMORY_OTP_STORE[phone]
        actual_code = mem_otp['otp_code']
        is_expired = mem_otp['expires_at'] < timezone.now()
        attempts = mem_otp['attempts']
    elif settings.DEBUG and otp_input == _DEBUG_DEMO_OTP and phone in _DEBUG_DEMO_PHONES:
        # DEBUG-only backdoor — never active in production
        actual_code = _DEBUG_DEMO_OTP

    if not actual_code or is_expired:
        return Response(
            {'error': 'OTP has expired or is invalid. Please request a new OTP.'},
            status=status.HTTP_400_BAD_REQUEST
        )

    # Brute-force protection: max 3 attempts
    if attempts >= 3:
        if otp_record:
            otp_record.is_used = True
            otp_record.save()
        IN_MEMORY_OTP_STORE.pop(phone, None)
        return Response(
            {'error': 'Maximum verification attempts exceeded. Please request a new OTP.'},
            status=status.HTTP_400_BAD_REQUEST
        )

    # Check OTP — DEBUG shortcut is gated
    is_valid = (actual_code == otp_input) or (
        settings.DEBUG and otp_input == _DEBUG_DEMO_OTP and phone in _DEBUG_DEMO_PHONES
    )

    if not is_valid:
        if otp_record:
            otp_record.attempts += 1
            otp_record.save()
            remaining = 3 - otp_record.attempts
        else:
            IN_MEMORY_OTP_STORE[phone]['attempts'] += 1
            remaining = 3 - IN_MEMORY_OTP_STORE[phone]['attempts']
        return Response(
            {'error': f'Invalid verification OTP. {remaining} attempt(s) remaining.'},
            status=status.HTTP_400_BAD_REQUEST
        )

    # Mark OTP as consumed
    if otp_record:
        otp_record.is_used = True
        try:
            otp_record.save()
        except Exception:
            pass
    IN_MEMORY_OTP_STORE.pop(phone, None)

    # Find UserProfile by matching phone digits
    profile = None
    for p in UserProfile.objects.all():
        if normalize_phone_number(p.phone) == phone:
            profile = p
            break

    if not profile:
        # Create a new member account automatically for new phone numbers
        username = f"user_{phone}"
        email = f"{phone}@auctionticket.com"
        user, _ = User.objects.get_or_create(username=username, defaults={'email': email})
        user.set_unusable_password()
        user.save()
        profile_id = f"usr_{phone[-6:]}"
        profile = UserProfile.objects.create(
            id=profile_id,
            user=user,
            name=f"Member {phone[-4:]}",
            email=email,
            phone=f"+91 {phone[:5]} {phone[5:]}",
            role='user',
            city='',
            kyc_status='Pending',
            wallet_balance=Decimal('0.00'),
            joined_date=timezone.now().strftime('%Y-%m-%d')
        )
    else:
        user = profile.user
        if not user:
            user, _ = User.objects.get_or_create(username=profile.email, defaults={'email': profile.email})
            profile.user = user
            profile.save()

    token, _ = Token.objects.get_or_create(user=user)

    return Response({
        'token': token.key,
        'user': UserProfileSerializer(profile).data,
        'message': f'Welcome, {profile.name}! Authenticated successfully via SMS OTP.'
    }, status=status.HTTP_200_OK)


# --- Authentication & Identity Endpoints ---
@api_view(['POST'])
@permission_classes([permissions.AllowAny])
def login_view(request):
    """
    Legacy password authentication endpoint.
    Accepts email & password, validates hash, and returns an auth Token and Profile.
    """
    email = request.data.get('email', '').strip().lower()
    password = request.data.get('password', '')

    if not email or not password:
        return Response({'error': 'Email and password are required.'}, status=status.HTTP_400_BAD_REQUEST)

    # Find user by email or username
    try:
        user = User.objects.get(email__iexact=email)
    except User.DoesNotExist:
        try:
            user = User.objects.get(username__iexact=email)
        except User.DoesNotExist:
            return Response({'error': 'Invalid credentials. Please verify your email and password.'}, status=status.HTTP_401_UNAUTHORIZED)

    if not user.check_password(password):
        return Response({'error': 'Invalid credentials. Please verify your email and password.'}, status=status.HTTP_401_UNAUTHORIZED)

    token, _ = Token.objects.get_or_create(user=user)
    profile = getattr(user, 'profile', None)

    return Response({
        'token': token.key,
        'user': UserProfileSerializer(profile).data if profile else {
            'id': str(user.id),
            'name': user.get_full_name() or user.username,
            'email': user.email,
            'role': 'admin' if user.is_staff else 'user'
        }
    })


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def me_view(request):
    """Returns the authenticated member's profile"""
    profile = getattr(request.user, 'profile', None)
    if not profile:
        return Response({'error': 'No profile linked to user account.'}, status=status.HTTP_404_NOT_FOUND)
    return Response(UserProfileSerializer(profile).data)


@api_view(['GET', 'PATCH'])
@permission_classes([permissions.IsAuthenticated])
def profile_view(request):
    """Self-service profile: read or update the logged-in user's own details
    (name, email, city, payout details, nominee). Phone, role and KYC are read-only."""
    profile = getattr(request.user, 'profile', None)
    if not profile:
        return Response({'error': 'No profile linked to user account.'}, status=status.HTTP_404_NOT_FOUND)
    if request.method == 'GET':
        return Response(ProfileDetailSerializer(profile).data)
    serializer = ProfileDetailSerializer(profile, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    if 'email' in serializer.validated_data and request.user.email != profile.email:
        request.user.email = profile.email
        request.user.save(update_fields=['email'])
    return Response(serializer.data)


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def logout_view(request):
    """Revokes the current authentication token"""
    if hasattr(request.user, 'auth_token'):
        request.user.auth_token.delete()
    return Response({'message': 'Logged out successfully.'})


# --- ViewSets ---
class UserProfileViewSet(viewsets.ModelViewSet):
    queryset = UserProfile.objects.all()
    serializer_class = UserProfileSerializer

    def get_permissions(self):
        if self.action in ['list', 'create', 'destroy']:
            return [IsAdminUserRole()]
        return [IsOwnerOrAdmin()]

    def retrieve(self, request, *args, **kwargs):
        """
        Fix: allow members to read their own profile.
        Compare the profile's linked User to request.user directly.
        """
        instance = self.get_object()
        profile = getattr(request.user, 'profile', None)
        if not _is_admin(request) and instance != profile:
            return Response({'error': 'Access denied.'}, status=status.HTTP_403_FORBIDDEN)
        return Response(UserProfileSerializer(instance).data)

    def update(self, request, *args, **kwargs):
        # Prevent non-admin users from escalating their own role or changing balances
        profile = getattr(request.user, 'profile', None)
        if profile and profile.role != 'admin':
            if 'role' in request.data and request.data['role'] != profile.role:
                return Response({'error': 'Permission denied: Cannot modify role.'}, status=status.HTTP_403_FORBIDDEN)
            if 'wallet_balance' in request.data:
                return Response({'error': 'Permission denied: Cannot modify wallet balance.'}, status=status.HTTP_403_FORBIDDEN)
            for locked in ('kyc_status', 'phone'):
                if locked in request.data and str(request.data[locked]) != str(getattr(profile, locked)):
                    return Response({'error': f'Permission denied: Cannot modify {locked}.'}, status=status.HTTP_403_FORBIDDEN)
        return super().update(request, *args, **kwargs)


class ValueTierViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = ValueTier.objects.all()
    serializer_class = ValueTierSerializer
    permission_classes = [permissions.AllowAny]


class AuctionSchemeViewSet(viewsets.ModelViewSet):
    queryset = AuctionScheme.objects.all()
    serializer_class = AuctionSchemeSerializer

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [IsAdminUserRole()]
        if self.action == 'book_slot':
            return [permissions.IsAuthenticated()]
        return [permissions.AllowAny()]

    def get_queryset(self):
        qs = super().get_queryset()
        tier_id = self.request.query_params.get('tier')
        if tier_id and tier_id != 'all':
            qs = qs.filter(tier_id=tier_id)
        return qs

    def perform_create(self, serializer):
        """Run model-level validation (clean()) before saving via API."""
        # New schemes open for enrolment: no dues are generated until every slot is filled.
        instance = serializer.save(status='enrolling', booked_slots=0, current_month=1)
        try:
            instance.full_clean()
        except Exception as e:
            instance.delete()
            raise e

    def destroy(self, request, *args, **kwargs):
        """Remove a scheme. Blocked once members have joined, so tickets and payments are never lost."""
        scheme = self.get_object()
        joined = scheme.tickets.count()
        if joined > 0:
            return Response(
                {'error': f'Cannot remove "{scheme.name}": {joined} member ticket(s) already joined. '
                          f'Only schemes with no members can be removed.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        scheme.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'])
    def book_slot(self, request, pk=None):
        """
        Concurrency-safe, server-authenticated ticket slot enrollment.
        Uses row-level locking (select_for_update) to prevent race conditions & duplicate slots.
        """
        user_profile = getattr(request.user, 'profile', None)
        if not user_profile:
            return Response({'error': 'Authenticated user profile not found.'}, status=status.HTTP_400_BAD_REQUEST)

        raw_slot = request.data.get('slot_number')
        try:
            slot_number = int(raw_slot)
        except (ValueError, TypeError):
            return Response({'error': 'Valid numeric slot_number is required.'}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            try:
                scheme = AuctionScheme.objects.select_for_update().get(pk=pk)
            except AuctionScheme.DoesNotExist:
                return Response({'error': 'Scheme not found.'}, status=status.HTTP_404_NOT_FOUND)

            if slot_number < 1 or slot_number > scheme.total_slots:
                return Response({
                    'error': f'Slot number #{slot_number} is out of bounds (1 – {scheme.total_slots}).'
                }, status=status.HTTP_400_BAD_REQUEST)

            if scheme.status not in ('active', 'enrolling'):
                return Response({'error': f'This scheme is {scheme.status} and not open for booking.'}, status=status.HTTP_400_BAD_REQUEST)

            if scheme.booked_slots >= scheme.total_slots:
                return Response({'error': 'This scheme is completely full.'}, status=status.HTTP_400_BAD_REQUEST)

            # Check if slot is already occupied
            if Ticket.objects.filter(scheme=scheme, ticket_number=slot_number).exists():
                return Response({'error': f'Slot #{slot_number} is already booked in this pool.'}, status=status.HTTP_409_CONFLICT)

            # Max tickets per member policy (max 4 tickets per pool)
            member_existing = Ticket.objects.filter(scheme=scheme, user=user_profile).count()
            if member_existing >= 4:
                return Response({'error': 'You have reached the maximum allowed tickets (4) in this pool.'}, status=status.HTTP_400_BAD_REQUEST)

            # Create ticket
            tkt_prefix = scheme.id.replace('SCH-', 'TKT-')
            ticket_id = f"{tkt_prefix}-{slot_number:02d}"

            ticket = Ticket.objects.create(
                id=ticket_id,
                ticket_number=slot_number,
                scheme=scheme,
                user=user_profile,
                joined_at_month=scheme.current_month,
                total_months_paid=0,
                status='active',
                issued_date=datetime.date.today().strftime('%Y-%m-%d')
            )

            scheme.booked_slots += 1
            scheme.save()

            payment = None
            scheme_started = False
            if scheme.status == 'enrolling':
                # Chit not full yet: members are only enrolled, NO dues are created.
                # Once the last slot is taken, the scheme starts and Month 1 dues
                # are generated for every member at the same time.
                if scheme.booked_slots >= scheme.total_slots:
                    scheme.status = 'active'
                    scheme.current_month = 1
                    scheme.save()
                    due_date = (datetime.date.today() + datetime.timedelta(days=10)).strftime('%Y-%m-%d')
                    for t in Ticket.objects.filter(scheme=scheme).select_related('user'):
                        p, _ = MonthlyPayment.objects.get_or_create(
                            id=f"PAY-{t.id}-M1",
                            defaults={
                                'ticket': t,
                                'scheme': scheme,
                                'user': t.user,
                                'month_number': 1,
                                'month_name': 'Month 1',
                                'base_amount': scheme.monthly_installment,
                                'dividend_discount': Decimal('0.00'),
                                'net_payable': scheme.monthly_installment,
                                'due_date': due_date,
                                'status': 'DUE',
                            },
                        )
                        if t.id == ticket.id:
                            payment = p
                    scheme_started = True
            else:
                # Already-running scheme (legacy / late joiner): back payments for every
                # month already run plus the current month.
                for m in range(1, scheme.current_month + 1):
                    p, _ = MonthlyPayment.objects.get_or_create(
                        id=f"PAY-{ticket_id}-M{m}",
                        defaults={
                            'ticket': ticket,
                            'scheme': scheme,
                            'user': user_profile,
                            'month_number': m,
                            'month_name': f"Month {m}",
                            'base_amount': scheme.monthly_installment,
                            'dividend_discount': Decimal('0.00'),
                            'net_payable': scheme.monthly_installment,
                            'due_date': (datetime.date.today() + datetime.timedelta(days=10)).strftime('%Y-%m-%d'),
                            'status': 'DUE'
                        }
                    )
                    if m == scheme.current_month:
                        payment = p

        remaining = scheme.total_slots - scheme.booked_slots
        if scheme_started:
            message = f'Ticket #{slot_number} booked. {scheme.name} is now full - Month 1 dues have been generated for all members!'
        elif payment is None:
            message = (f'Successfully enrolled in Ticket #{slot_number} for {scheme.name}! '
                       f'Dues start once all {scheme.total_slots} members join ({remaining} slot(s) remaining).')
        else:
            message = f'Successfully enrolled in Ticket #{slot_number} for {scheme.name}!'

        return Response({
            'message': message,
            'ticket': TicketSerializer(ticket).data,
            'payment': MonthlyPaymentSerializer(payment).data if payment else None,
            'scheme_started': scheme_started,
        }, status=status.HTTP_201_CREATED)


class TicketViewSet(viewsets.ModelViewSet):
    """
    Members: read-only (list, retrieve).
    Admins: full access.
    Direct POST/PATCH/DELETE by members is blocked — all ticket mutations go through
    book_slot (booking) or conclude auction (prize marking).
    """
    queryset = Ticket.objects.all()
    serializer_class = TicketSerializer

    def get_permissions(self):
        # All write operations require admin
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [IsAdminUserRole()]
        return [permissions.IsAuthenticated()]

    def get_queryset(self):
        user_profile = getattr(self.request.user, 'profile', None)
        if not user_profile:
            return Ticket.objects.none()

        qs = super().get_queryset()
        if _is_admin(self.request):
            target_user = self.request.query_params.get('user_id')
            if target_user:
                qs = qs.filter(user_id=target_user)
            return qs

        # Regular members can ONLY see their own tickets
        return qs.filter(user=user_profile)


def _earlier_unpaid_installment(payment):
    """Return the oldest unpaid installment of the same ticket that comes before `payment`, or None.
    Installments must be settled in order: a later month cannot be paid while an earlier one is unpaid."""
    return (MonthlyPayment.objects
            .filter(ticket=payment.ticket, month_number__lt=payment.month_number)
            .exclude(status='PAID')
            .order_by('month_number')
            .first())


def _out_of_order_response(earlier):
    return Response(
        {'error': f'Please pay {earlier.month_name} (Round #{earlier.month_number}) first. '
                  f'Installments must be paid in order.'},
        status=status.HTTP_400_BAD_REQUEST)


from .dues import run_daily_maintenance


class MonthlyPaymentViewSet(viewsets.ModelViewSet):
    """
    Members: read-only (list, retrieve).
    Admins: full access.
    Payment clearance goes through the custom `pay` action; reconciliation via `reconcile`.
    Direct PATCH/PUT by members is blocked to prevent status/amount tampering.
    """
    queryset = MonthlyPayment.objects.all()
    serializer_class = MonthlyPaymentSerializer

    def get_permissions(self):
        # Block members from direct write access
        if self.action in ['create', 'update', 'partial_update', 'destroy', 'reconcile', 'send_reminder']:
            return [IsAdminUserRole()]
        return [permissions.IsAuthenticated()]

    def get_queryset(self):
        run_daily_maintenance()
        user_profile = getattr(self.request.user, 'profile', None)
        if not user_profile:
            return MonthlyPayment.objects.none()

        qs = super().get_queryset()
        is_admin = _is_admin(self.request)

        if is_admin:
            user_id = self.request.query_params.get('user_id')
            if user_id:
                qs = qs.filter(user_id=user_id)
        else:
            # Enforce strict subscriber boundary
            qs = qs.filter(user=user_profile)

        status_filter = self.request.query_params.get('status')
        scheme_id = self.request.query_params.get('scheme_id')
        search = self.request.query_params.get('search')

        if status_filter and status_filter != 'ALL':
            sf = status_filter.upper()
            if sf == 'ALL_DUES':
                qs = qs.filter(status__in=['DUE', 'OVERDUE', 'UPCOMING'])
            elif sf == 'DUE':
                qs = qs.filter(status__in=['DUE', 'OVERDUE'])
            elif sf == 'CURRENT_DUE':
                qs = qs.filter(status='DUE')
            else:
                qs = qs.filter(status=sf)
        if scheme_id:
            qs = qs.filter(scheme_id=scheme_id)
        if search:
            qs = qs.filter(
                Q(scheme__name__icontains=search) |
                Q(month_name__icontains=search) |
                Q(ticket__id__icontains=search) |
                Q(user__name__icontains=search)
            )
        return qs

    @action(detail=True, methods=['post'])
    def pay(self, request, pk=None):
        """
        Idempotent payment clearance simulation.
        Prevents duplicate payments and duplicate ticket total_months_paid increments.
        Maintains an append-only PaymentLedgerEntry.
        """
        user_profile = getattr(request.user, 'profile', None)
        method = request.data.get('payment_method', 'UPI (Instant QR)')

        with transaction.atomic():
            try:
                payment = MonthlyPayment.objects.select_for_update().get(pk=pk)
            except MonthlyPayment.DoesNotExist:
                return Response({'error': 'Payment record not found.'}, status=status.HTTP_404_NOT_FOUND)

            # Security: User must own the payment or be admin
            if not _is_admin(request) and payment.user != user_profile:
                return Response({'error': 'Access denied: You cannot pay another member installment.'}, status=status.HTTP_403_FORBIDDEN)

            # Idempotency check: If already paid, return existing receipt without re-incrementing
            if payment.status == 'PAID':
                return Response({
                    'message': f'Payment {payment.id} is already verified and paid.',
                    'payment': MonthlyPaymentSerializer(payment).data,
                    'receipt': {
                        'receipt_number': payment.receipt_number,
                        'transaction_ref': payment.transaction_ref,
                        'paid_date': payment.paid_date,
                        'amount': payment.net_payable,
                        'scheme_name': payment.scheme.name,
                        'member_name': payment.user.name,
                        'is_duplicate': True
                    }
                }, status=status.HTTP_200_OK)

            earlier = _earlier_unpaid_installment(payment)
            if earlier:
                return _out_of_order_response(earlier)

            prev_status = payment.status
            rand_ref = f"DEMO-UPI-{random.randint(10000000, 99999999)}"
            rand_receipt = f"REC-2026-{payment.month_number:02d}-{random.randint(100, 999)}"

            payment.status = 'PAID'
            payment.paid_date = datetime.date.today().strftime('%Y-%m-%d')
            payment.payment_method = method
            payment.transaction_ref = rand_ref
            payment.receipt_number = rand_receipt
            payment.is_verified = True
            payment.verified_at = timezone.now()
            payment.save()

            # Increment ticket months paid
            ticket = payment.ticket
            ticket.total_months_paid += 1
            ticket.save()

            # Write to immutable audit ledger
            PaymentLedgerEntry.objects.create(
                payment=payment,
                user=payment.user,
                ticket=payment.ticket,
                entry_type='ONLINE_SETTLEMENT',
                amount=payment.net_payable,
                previous_status=prev_status,
                new_status='PAID',
                transaction_ref=rand_ref,
                receipt_number=rand_receipt,
                performed_by=user_profile,
                notes=f"Settled via {method} (Demo Simulated Gateway)"
            )

        return Response({
            'message': f'Payment of ₹{payment.net_payable:,.2f} cleared successfully!',
            'payment': MonthlyPaymentSerializer(payment).data,
            'receipt': {
                'receipt_number': payment.receipt_number,
                'transaction_ref': payment.transaction_ref,
                'paid_date': payment.paid_date,
                'amount': payment.net_payable,
                'scheme_name': payment.scheme.name,
                'member_name': payment.user.name
            }
        })

    @action(detail=True, methods=['post'], permission_classes=[IsAdminUserRole])
    def reconcile(self, request, pk=None):
        """Admin offline payment reconciliation (Cash / NEFT)"""
        user_profile = getattr(request.user, 'profile', None)
        ref = request.data.get('transaction_ref', f"CASH-REC-{random.randint(1000, 9999)}")

        with transaction.atomic():
            payment = MonthlyPayment.objects.select_for_update().get(pk=pk)
            if payment.status == 'PAID':
                return Response({'error': 'Payment is already settled.'}, status=status.HTTP_400_BAD_REQUEST)

            prev_status = payment.status
            receipt_num = f"REC-ADM-{random.randint(100, 999)}"

            payment.status = 'PAID'
            payment.paid_date = datetime.date.today().strftime('%Y-%m-%d')
            payment.payment_method = 'Cash / NEFT (Admin Reconciled)'
            payment.transaction_ref = ref
            payment.receipt_number = receipt_num
            payment.is_verified = True
            payment.verified_at = timezone.now()
            payment.save()

            ticket = payment.ticket
            ticket.total_months_paid += 1
            ticket.save()

            PaymentLedgerEntry.objects.create(
                payment=payment,
                user=payment.user,
                ticket=payment.ticket,
                entry_type='OFFLINE_RECONCILE',
                amount=payment.net_payable,
                previous_status=prev_status,
                new_status='PAID',
                transaction_ref=ref,
                receipt_number=receipt_num,
                performed_by=user_profile,
                notes="Offline cash/bank reconciliation by administrator"
            )

        return Response({
            'message': 'Installment reconciled and marked as paid.',
            'payment': MonthlyPaymentSerializer(payment).data
        })

    @action(detail=True, methods=['post'], permission_classes=[IsAdminUserRole])
    def send_reminder(self, request, pk=None):
        """
        Admin in-app reminder. Stamps the payment (or, with scope='member', every
        unpaid overdue/due payment of that member) so it appears in the member's
        notification bell and the admin can see when the last reminder went out.
        """
        payment = self.get_object()
        if payment.status == 'PAID':
            return Response({'error': 'This installment is already paid.'}, status=status.HTTP_400_BAD_REQUEST)

        today = timezone.localdate().isoformat()
        if request.data.get('scope') == 'member':
            targets = list(MonthlyPayment.objects.filter(user=payment.user).exclude(status='PAID').filter(due_date__lte=today))
            if payment not in targets:
                targets.append(payment)
        else:
            targets = [payment]

        now = timezone.now()
        for t in targets:
            t.reminder_sent_at = now
            t.reminder_count = (t.reminder_count or 0) + 1
            t.save(update_fields=['reminder_sent_at', 'reminder_count'])

        total = sum((t.net_payable for t in targets), Decimal('0.00'))
        count = len(targets)
        return Response({
            'message': f"Reminder sent to {payment.user.name}'s app for {count} payment{'s' if count != 1 else ''} (₹{total:,.2f}).",
            'payment': MonthlyPaymentSerializer(payment).data,
            'reminded': count,
        })

    @action(detail=True, methods=['post'], url_path='create-qr')
    def create_qr(self, request, pk=None):
        """
        Creates a dynamic, amount-specific Razorpay UPI QR code.
        Calculates amount directly from DB (payment.net_payable in paise).
        Ensures user owns the payment or is admin.
        """
        user_profile = getattr(request.user, 'profile', None)
        payment = self.get_object()

        if not _is_admin(request) and payment.user != user_profile:
            return Response({'error': 'Access denied: You cannot pay another member installment.'}, status=status.HTTP_403_FORBIDDEN)

        if payment.status == 'PAID':
            return Response({'error': 'This installment is already fully paid and cleared.'}, status=status.HTTP_400_BAD_REQUEST)

        earlier = _earlier_unpaid_installment(payment)
        if earlier:
            return _out_of_order_response(earlier)

        try:
            qr_record = create_dynamic_upi_qr(payment, user_profile)
            return Response({
                'qr_code': RazorpayQRCodeSerializer(qr_record).data,
                'payment': MonthlyPaymentSerializer(payment).data
            }, status=status.HTTP_200_OK)
        except Exception as exc:
            logger.error("Error creating dynamic UPI QR for payment %s: %s", payment.id, exc)
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['get'], url_path='qr-status')
    def qr_status(self, request, pk=None):
        """
        Checks real-time payment status of the dynamic UPI QR session.
        Handles expiry, polls Razorpay if native QR, and returns verification status.
        """
        user_profile = getattr(request.user, 'profile', None)
        payment = self.get_object()

        if not _is_admin(request) and payment.user != user_profile:
            return Response({'error': 'Access denied: You cannot inspect another member installment.'}, status=status.HTTP_403_FORBIDDEN)

        qr_id = request.query_params.get('qr_id')
        qr_record = None
        if qr_id:
            qr_record = RazorpayQRCode.objects.filter(id=qr_id, payment=payment).first()
        if not qr_record:
            qr_record = RazorpayQRCode.objects.filter(payment=payment).order_by('-created_at').first()

        if not qr_record:
            return Response({'error': 'No QR session found for this payment.'}, status=status.HTTP_404_NOT_FOUND)

        # Check and sync status
        qr_record = check_and_sync_qr_status(qr_record)
        payment.refresh_from_db()

        receipt_data = None
        if payment.status == 'PAID':
            receipt_data = {
                'receipt_number': payment.receipt_number,
                'transaction_ref': payment.transaction_ref,
                'paid_date': payment.paid_date,
                'amount': payment.net_payable,
                'scheme_name': payment.scheme.name,
                'member_name': payment.user.name,
                'payment_method': payment.payment_method
            }

        return Response({
            'qr_code': RazorpayQRCodeSerializer(qr_record).data,
            'is_paid': payment.status == 'PAID',
            'is_expired': qr_record.is_expired,
            'payment': MonthlyPaymentSerializer(payment).data,
            'receipt': receipt_data
        }, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'], url_path='simulate-qr-payment')
    def simulate_qr_payment(self, request, pk=None):
        """
        Test Mode simulator:
        Simulates an incoming successful Razorpay payment credit event for this QR code.
        Executes atomic settlement, idempotency check, and audit logging.
        """
        user_profile = getattr(request.user, 'profile', None)
        payment = self.get_object()

        if not _is_admin(request) and payment.user != user_profile:
            return Response({'error': 'Access denied.'}, status=status.HTTP_403_FORBIDDEN)

        earlier = _earlier_unpaid_installment(payment)
        if earlier and payment.status != 'PAID':
            return _out_of_order_response(earlier)

        qr_id = request.data.get('qr_id')
        qr_record = None
        if qr_id:
            qr_record = RazorpayQRCode.objects.filter(id=qr_id, payment=payment).first()
        if not qr_record:
            qr_record = RazorpayQRCode.objects.filter(payment=payment, status='active').first()

        if not qr_record:
            qr_record = create_dynamic_upi_qr(payment, user_profile)

        mock_pay_id = f"pay_sim_{uuid.uuid4().hex[:12]}"
        settle_payment_atomically(
            payment=payment,
            qr_record=qr_record,
            razorpay_payment_id=mock_pay_id,
            payment_method="Razorpay Dynamic UPI QR"
        )
        payment.refresh_from_db()

        return Response({
            'message': f"Payment of ₹{payment.net_payable:,.2f} verified & settled successfully via Razorpay UPI QR!",
            'payment': MonthlyPaymentSerializer(payment).data,
            'receipt': {
                'receipt_number': payment.receipt_number,
                'transaction_ref': payment.transaction_ref,
                'paid_date': payment.paid_date,
                'amount': payment.net_payable,
                'scheme_name': payment.scheme.name,
                'member_name': payment.user.name,
                'payment_method': payment.payment_method
            }
        }, status=status.HTTP_200_OK)


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def overview_stats(request):
    """
    Role-segregated KPI statistics.
    Regular members only see their personal numbers; admins see aggregate portfolio figures.
    """
    run_daily_maintenance()
    user_profile = getattr(request.user, 'profile', None)
    if not user_profile:
        return Response({'error': 'User profile not found.'}, status=status.HTTP_404_NOT_FOUND)

    is_admin = _is_admin(request)

    # Determine target user for subscriber metrics
    if is_admin:
        target_user_id = request.query_params.get('user_id', user_profile.id)
    else:
        target_user_id = user_profile.id

    # Subscriber metrics
    user_payments = MonthlyPayment.objects.filter(user_id=target_user_id)
    total_monthly_paid = user_payments.filter(status='PAID').aggregate(s=Sum('net_payable'))['s'] or Decimal('0.00')
    upcoming_dues = user_payments.filter(status__in=['DUE', 'OVERDUE', 'UPCOMING']).aggregate(s=Sum('net_payable'))['s'] or Decimal('0.00')
    dividend_savings = user_payments.filter(status='PAID').aggregate(s=Sum('dividend_discount'))['s'] or Decimal('0.00')
    active_tickets_count = Ticket.objects.filter(user_id=target_user_id).count()

    resp_data = {
        'user_stats': {
            'total_monthly_paid': float(total_monthly_paid),
            'upcoming_dues': float(upcoming_dues),
            'dividend_savings': float(dividend_savings),
            'active_tickets_count': active_tickets_count
        }
    }

    if is_admin:
        all_payments = MonthlyPayment.objects.all()
        gross_turnover = AuctionScheme.objects.aggregate(s=Sum('total_value'))['s'] or Decimal('0.00')
        admin_total_collected = all_payments.filter(status='PAID').aggregate(s=Sum('net_payable'))['s'] or Decimal('0.00')
        admin_pending_dues = all_payments.filter(status__in=['DUE', 'OVERDUE']).aggregate(s=Sum('net_payable'))['s'] or Decimal('0.00')
        admin_upcoming_dues = all_payments.filter(status='UPCOMING').aggregate(s=Sum('net_payable'))['s'] or Decimal('0.00')
        active_subscribers = UserProfile.objects.filter(role='user').count()
        active_tickets_total = Ticket.objects.count()

        resp_data['admin_stats'] = {
            'gross_turnover': float(gross_turnover),
            'total_monthly_paid_collected': float(admin_total_collected),
            'pending_dues': float(admin_pending_dues),
            'upcoming_dues': float(admin_upcoming_dues),
            'active_subscribers': active_subscribers,
            'active_tickets_total': active_tickets_total
        }

    return Response(resp_data)


@api_view(['GET', 'POST'])
@permission_classes([permissions.IsAuthenticated])
def live_auction_view(request):
    """
    Live monthly reverse auction controller.

    Bidding rules enforced server-side:
    - Auction round must have an ends_at timestamp; bids after expiry are rejected.
    - Bidder must have an active, non-prized ticket in the scheme AND have their
      CURRENT month's installment paid (no defaulters).
    - Admin role alone is not sufficient to bid (must also hold a valid ticket).
    - First bid must be STRICTLY ABOVE the min bid amount (> not >=).
    - Pool must be 100% booked before an auction round can be concluded.
    - Conclude with no bids: draws a random eligible (paid, non-prized) ticket
      at exactly the min_bid_amount; raises an error if no eligible tickets exist.
    - Dividend recipients: only non-prized tickets (including current round's winner
      if winner_dividend_eligible); divisor = len(recipient_tickets).
    - Next-month payment creation uses get_or_create (never overwrites PAID records).
    """
    if request.method == 'GET':
        round_id = request.query_params.get('round_id')
        scheme_id = request.query_params.get('scheme_id')
    else:
        round_id = (request.data.get('round_id') if hasattr(request, 'data') else None) or request.query_params.get('round_id')
        scheme_id = (request.data.get('scheme_id') if hasattr(request, 'data') else None) or request.query_params.get('scheme_id')

    if round_id:
        active_round = AuctionRound.objects.filter(id=round_id).first()
        if not active_round:
            return Response({'error': f'Auction round {round_id} not found.'}, status=status.HTTP_404_NOT_FOUND)
    elif scheme_id:
        active_round = AuctionRound.objects.filter(scheme_id=scheme_id, is_active=True).first()
        if not active_round:
            active_round = AuctionRound.objects.filter(scheme_id=scheme_id).order_by('-month_number').first()
    else:
        active_round = AuctionRound.objects.filter(is_active=True).first()

    if not active_round:
        if request.method == 'POST':
            return Response({
                'error': 'No active auction round found. The round may have already been concluded.'
            }, status=status.HTTP_400_BAD_REQUEST)

        # Dynamic round initialization for chosen or default scheme
        target_scheme = None
        if scheme_id:
            target_scheme = AuctionScheme.objects.filter(id=scheme_id).first()
        if not target_scheme:
            target_scheme = AuctionScheme.objects.filter(status='active').first() or AuctionScheme.objects.first()

        if target_scheme:
            init_bid = target_scheme.get_min_bid_amount()
            # ends_at: 10 minutes from now for a newly initialized round
            ends_at = timezone.now() + datetime.timedelta(minutes=10)
            active_round, _ = AuctionRound.objects.get_or_create(
                id=f'ROUND-{target_scheme.id}-M{target_scheme.current_month}',
                defaults={
                    'scheme': target_scheme,
                    'month_number': target_scheme.current_month,
                    'highest_discount_bid': init_bid,
                    'leader_name': 'Awaiting Bids',
                    'time_left_seconds': 600,
                    'ends_at': ends_at,
                    'is_active': True
                }
            )
        else:
            return Response({'error': 'No auction schemes configured.'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        # Compute eligible count for preview using current non-prized tickets
        non_prized_tickets = list(active_round.scheme.tickets.filter(has_won_auction=False))
        if active_round.scheme.winner_dividend_eligible:
            preview_eligible_count = len(non_prized_tickets)
        else:
            preview_eligible_count = max(1, len(non_prized_tickets) - 1)

        distribution = calculate_auction_distribution(
            active_round.scheme,
            active_round.highest_discount_bid,
            preview_eligible_count
        )
        data = AuctionRoundSerializer(active_round).data
        # Compute time_left_seconds dynamically from ends_at
        if active_round.ends_at and active_round.is_active:
            time_left = max(0, int((active_round.ends_at - timezone.now()).total_seconds()))
        elif active_round.is_active and not active_round.ends_at:
            # Round without a server deadline (e.g. seeded sample): use the stored countdown
            time_left = max(0, int(active_round.time_left_seconds or 0))
        else:
            time_left = 0
        data['time_left_seconds'] = time_left
        data['distribution_preview'] = {
            'total_chit_value': float(distribution['total_chit_value']),
            'winning_discount': float(distribution['winning_discount']),
            'organizer_commission': float(distribution['commission']),
            'distributable_dividend': float(distribution['distributable_dividend']),
            'eligible_count': distribution['eligible_count'],
            'dividend_per_member': float(distribution['dividend_per_member']),
            'remainder': float(distribution['remainder']),
            'winner_payout': float(distribution['winner_payout']),
        }
        data['all_schemes'] = [
            {
                'id': s.id,
                'name': s.name,
                'tier_id': s.tier_id,
                'total_value': float(s.total_value),
                'monthly_installment': float(s.monthly_installment),
                'duration_months': s.duration_months,
                'current_month': s.current_month,
                'min_bid_amount': float(s.get_min_bid_amount()),
                'max_bid_amount': float(s.get_max_bid_amount()),
            }
            for s in AuctionScheme.objects.all().order_by('total_value')
        ]
        return Response(data)

    elif request.method == 'POST':
        action_type = request.data.get('action', 'bid')
        user_profile = getattr(request.user, 'profile', None)

        if action_type == 'bid':
            raw_discount = request.data.get('discount_amount')
            if raw_discount is None or str(raw_discount).strip() == '':
                # No amount supplied: auto-increment over the current highest bid
                step = max(Decimal('500.00'), (active_round.scheme.total_value * Decimal('0.01')).quantize(Decimal('100.00')))
                discount_amount = active_round.highest_discount_bid + step
            else:
                try:
                    discount_amount = Decimal(str(raw_discount).strip())
                    if not discount_amount.is_finite():
                        raise InvalidOperation
                except (InvalidOperation, ValueError, TypeError):
                    return Response({'error': 'discount_amount must be a valid number.'}, status=status.HTTP_400_BAD_REQUEST)

            with transaction.atomic():
                round_obj = AuctionRound.objects.select_for_update().get(pk=active_round.pk)
                if not round_obj.is_active or round_obj.is_concluded:
                    return Response({'error': 'This auction round has already ended.'}, status=status.HTTP_400_BAD_REQUEST)

                # Server-side timer enforcement
                if round_obj.ends_at and timezone.now() > round_obj.ends_at:
                    round_obj.is_active = False
                    round_obj.save()
                    return Response({'error': 'The bidding window for this auction has closed.'}, status=status.HTTP_400_BAD_REQUEST)

                # Eligibility: bidder MUST hold an active, non-prized ticket in this scheme
                eligible_ticket = Ticket.objects.filter(
                    scheme=round_obj.scheme,
                    user=user_profile,
                    has_won_auction=False,
                    status='active'
                ).first()

                if not eligible_ticket:
                    return Response({
                        'error': f'Only enrolled members with an active, un-prized ticket in {round_obj.scheme.name} can place bids.'
                    }, status=status.HTTP_403_FORBIDDEN)

                # Defaulter check: bidder's current-month installment must be PAID
                # A missing row for the current month counts as unpaid, and any
                # earlier unpaid month also blocks the bid.
                scheme_now = round_obj.scheme
                paid_months = set(MonthlyPayment.objects.filter(
                    ticket=eligible_ticket,
                    month_number__lte=scheme_now.current_month,
                    status='PAID'
                ).values_list('month_number', flat=True))
                required_months = set(range(max(1, eligible_ticket.joined_at_month), scheme_now.current_month + 1))
                if not required_months.issubset(paid_months):
                    return Response({
                        'error': 'You must clear all due installments up to the current month before placing a bid.'
                    }, status=status.HTTP_403_FORBIDDEN)

                # Bid must be STRICTLY ABOVE current highest (covers first bid > min too)
                if discount_amount <= round_obj.highest_discount_bid:
                    return Response({
                        'error': f'Bid must be strictly higher than current discount of ₹{round_obj.highest_discount_bid:,.2f}'
                    }, status=status.HTTP_400_BAD_REQUEST)

                # Amount-based cap checks
                max_allowed = round_obj.scheme.get_max_bid_amount()
                if discount_amount > max_allowed:
                    return Response({
                        'error': f'Bid cannot exceed maximum discount cap of ₹{max_allowed:,.2f} ({round_obj.scheme.max_bid_discount}%)'
                    }, status=status.HTTP_400_BAD_REQUEST)

                min_allowed = round_obj.scheme.get_min_bid_amount()
                # First bid must be STRICTLY ABOVE minimum (not equal)
                if discount_amount <= min_allowed:
                    return Response({
                        'error': f'Bid must be strictly above the minimum discount threshold of ₹{min_allowed:,.2f} ({round_obj.scheme.min_bid_discount}%)'
                    }, status=status.HTTP_400_BAD_REQUEST)

                # Store the plain name; the frontend adds "(You)" for the viewing user.
                bidder_display_name = user_profile.name if user_profile else 'Unknown'

                round_obj.highest_discount_bid = discount_amount
                round_obj.leader_name = bidder_display_name
                round_obj.leader_ticket = eligible_ticket
                round_obj.save()

                AuctionBid.objects.create(
                    round=round_obj,
                    ticket=eligible_ticket,
                    bidder=user_profile,
                    bidder_name=bidder_display_name,
                    discount_amount=discount_amount,
                    relative_time='Just now'
                )

            return Response({
                'message': f'Bid of ₹{discount_amount:,.2f} registered successfully for {round_obj.scheme.name}!',
                'round': AuctionRoundSerializer(round_obj).data
            })

        elif action_type == 'conclude':
            # Only administrators can conclude auctions
            if not _is_admin(request):
                return Response({'error': 'Permission denied: Only administrators can conclude auctions.'}, status=status.HTTP_403_FORBIDDEN)

            with transaction.atomic():
                round_obj = AuctionRound.objects.select_for_update().get(pk=active_round.pk)
                if not round_obj.is_active or round_obj.is_concluded:
                    return Response({'error': 'This auction round has already been concluded.'}, status=status.HTTP_400_BAD_REQUEST)

                scheme = round_obj.scheme

                # Require pool to be 100% booked before concluding
                if scheme.booked_slots < scheme.total_slots:
                    return Response({
                        'error': f'Pool is not full ({scheme.booked_slots}/{scheme.total_slots} slots filled). All slots must be booked before the auction can be concluded.'
                    }, status=status.HTTP_400_BAD_REQUEST)

                winning_discount = round_obj.highest_discount_bid

                # Determine winning ticket
                winning_ticket = round_obj.leader_ticket

                if not winning_ticket:
                    # Seeded/legacy rounds may carry a leader name or bid rows without leader_ticket.
                    top_bid = round_obj.bids.filter(ticket__isnull=False).order_by('-discount_amount', 'created_at').first()
                    if top_bid and top_bid.ticket.scheme_id == scheme.id and not top_bid.ticket.has_won_auction:
                        winning_ticket = top_bid.ticket
                        winning_discount = max(winning_discount, top_bid.discount_amount)
                    else:
                        leader = (round_obj.leader_name or '').replace('(You)', '').strip()
                        if leader and leader != 'Awaiting Bids':
                            winning_ticket = Ticket.objects.filter(
                                scheme=scheme, user__name=leader,
                                has_won_auction=False, status='active'
                            ).order_by('ticket_number').first()

                if not winning_ticket:
                    # No resolvable bidder — draw a random eligible ticket (paid current month, non-prized)
                    paid_ticket_ids = MonthlyPayment.objects.filter(
                        scheme=scheme, month_number=scheme.current_month, status='PAID'
                    ).values_list('ticket_id', flat=True)
                    eligible_tickets = list(
                        Ticket.objects.filter(
                            scheme=scheme,
                            has_won_auction=False,
                            status='active',
                            id__in=list(paid_ticket_ids)
                        ).select_for_update()
                    )
                    if not eligible_tickets:
                        return Response({
                            'error': 'No eligible (paid, non-prized, active) tickets found in this scheme. Cannot conclude.'
                        }, status=status.HTTP_400_BAD_REQUEST)
                    winning_ticket = random.choice(eligible_tickets)
                    # Use the minimum bid amount as the winning discount for a no-bid round
                    winning_discount = scheme.get_min_bid_amount()

                winner_user = winning_ticket.user

                # Dividend recipients: all non-prized tickets EXCLUDING current winner
                # (unless winner_dividend_eligible is True)
                non_prized_tickets = list(scheme.tickets.filter(has_won_auction=False))

                if scheme.winner_dividend_eligible:
                    # All non-prized tickets, including the winner
                    dividend_recipients = non_prized_tickets
                else:
                    # All non-prized tickets except the winner
                    dividend_recipients = [t for t in non_prized_tickets if t != winning_ticket]

                eligible_count = len(dividend_recipients)

                # Mathematical dividend breakdown using actual recipient count
                distribution = calculate_auction_distribution(scheme, winning_discount, eligible_count)

                # Mark round as concluded
                round_obj.is_active = False
                round_obj.is_concluded = True
                round_obj.concluded_at = timezone.now()
                round_obj.save()

                # Update winner ticket status
                winning_ticket.has_won_auction = True
                winning_ticket.won_month = round_obj.month_number
                winning_ticket.won_payout = distribution['winner_payout']
                winning_ticket.status = 'prized'
                winning_ticket.save()

                # Record immutable audit history
                auction_rec_id = f"REC-AUC-{scheme.id}-M{round_obj.month_number}"
                auction_record, _ = AuctionRecord.objects.get_or_create(
                    id=auction_rec_id,
                    defaults={
                        'scheme': scheme,
                        'month_number': round_obj.month_number,
                        'winner_ticket': winning_ticket,
                        'winner_user': winner_user,
                        'total_chit_value': distribution['total_chit_value'],
                        'winning_discount': distribution['winning_discount'],
                        'organizer_commission': distribution['commission'],
                        'distributable_dividend': distribution['distributable_dividend'],
                        'eligible_members_count': distribution['eligible_count'],
                        'dividend_per_member': distribution['dividend_per_member'],
                        'rounding_remainder': distribution['remainder'],
                        'net_prize_payout': distribution['winner_payout'],
                        'concluded_by': user_profile
                    }
                )

                # Auto-generate next month payment installments.
                # Use get_or_create to NEVER overwrite an existing PAID payment.
                next_month = round_obj.month_number + 1
                if next_month <= scheme.duration_months:
                    recipient_ticket_ids = {t.pk for t in dividend_recipients}

                    for tkt in scheme.tickets.all():
                        next_pay_id = f"PAY-{tkt.id}-M{next_month}"

                        is_dividend_recipient = tkt.pk in recipient_ticket_ids
                        member_div = distribution['dividend_per_member'] if is_dividend_recipient else Decimal('0.00')
                        net_pay = max(Decimal('0.00'), scheme.monthly_installment - member_div)

                        # get_or_create: if the record already exists (and may be PAID), leave it alone
                        payment_obj, created = MonthlyPayment.objects.get_or_create(
                            id=next_pay_id,
                            defaults={
                                'ticket': tkt,
                                'scheme': scheme,
                                'user': tkt.user,
                                'month_number': next_month,
                                'month_name': f"Month {next_month}",
                                'base_amount': scheme.monthly_installment,
                                'dividend_discount': member_div,
                                'net_payable': net_pay,
                                'due_date': (datetime.date.today() + datetime.timedelta(days=30)).strftime('%Y-%m-%d'),
                                'status': 'DUE'
                            }
                        )

                        # Write auditable dividend adjustment log only for new records
                        if created and member_div > Decimal('0.00'):
                            PaymentLedgerEntry.objects.create(
                                payment=payment_obj,
                                user=tkt.user,
                                ticket=tkt,
                                entry_type='DIVIDEND_ADJUSTMENT',
                                amount=member_div,
                                previous_status=payment_obj.status,
                                new_status=payment_obj.status,
                                transaction_ref=f"DIV-{scheme.id}-M{round_obj.month_number}",
                                receipt_number=None,
                                performed_by=user_profile,
                                notes=f"Month #{round_obj.month_number} auction dividend discount applied to Month #{next_month} installment"
                            )

                # Increment scheme current_month
                if scheme.current_month < scheme.duration_months:
                    scheme.current_month += 1
                else:
                    scheme.status = 'completed'
                scheme.save()

            return Response({
                'message': f"Auction concluded for {scheme.name}! Winning discount of ₹{winning_discount:,.2f} distributed: {distribution['eligible_count']} eligible members receive ₹{distribution['dividend_per_member']:,.2f} dividend discount for next month.",
                'dividend_per_member': float(distribution['dividend_per_member']),
                'winning_discount': float(winning_discount),
                'commission': float(distribution['commission']),
                'distributable_dividend': float(distribution['distributable_dividend']),
                'winner': winner_user.name,
                'winner_payout': float(distribution['winner_payout']),
                'auction_record': AuctionRecordSerializer(auction_record).data
            })


# ==============================================================================
# Razorpay Webhook Endpoint
# ==============================================================================
@api_view(['POST'])
@permission_classes([permissions.AllowAny])
def razorpay_webhook_view(request):
    """
    Razorpay Webhook receiver with HMAC SHA-256 signature verification.
    Processes:
      - 'qr_code.credited': when customer scans and pays via Dynamic UPI QR
      - 'payment.captured': when payment is captured
    Idempotent: Replayed events are discarded safely without duplicate credit.
    """
    signature = request.headers.get('X-Razorpay-Signature', '')
    if not signature:
        signature = request.META.get('HTTP_X_RAZORPAY_SIGNATURE', '')

    raw_body = request.body
    if not verify_razorpay_signature(raw_body, signature):
        logger.warning("Razorpay Webhook: Signature verification failed.")
        return Response({'error': 'Invalid webhook signature.'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        import json
        payload = json.loads(raw_body.decode('utf-8'))
    except Exception as exc:
        logger.error("Razorpay Webhook: Malformed JSON: %s", exc)
        return Response({'error': 'Malformed JSON payload.'}, status=status.HTTP_400_BAD_REQUEST)

    event_id = payload.get('id')
    event_type = payload.get('event')

    if not event_id:
        return Response({'error': 'Missing event id in payload.'}, status=status.HTTP_400_BAD_REQUEST)

    # Idempotency check: Already processed event
    if RazorpayWebhookEvent.objects.filter(event_id=event_id).exists():
        logger.info("Razorpay Webhook: Duplicate event %s ignored.", event_id)
        return Response({'status': 'ok', 'message': 'Duplicate event already processed.'}, status=status.HTTP_200_OK)

    if event_type == 'qr_code.credited':
        qr_entity = payload.get('payload', {}).get('qr_code', {}).get('entity', {})
        payment_entity = payload.get('payload', {}).get('payment', {}).get('entity', {})

        qr_id = qr_entity.get('id')
        payment_amount_paise = payment_entity.get('amount', 0)
        rzp_payment_id = payment_entity.get('id', f"pay_rzp_{uuid.uuid4().hex[:10]}")

        qr_record = RazorpayQRCode.objects.filter(id=qr_id).select_related('payment', 'user').first()
        if not qr_record:
            # Fallback to notes.payment_id
            notes = qr_entity.get('notes', {}) or payment_entity.get('notes', {})
            pid = notes.get('payment_id')
            if pid:
                qr_record = RazorpayQRCode.objects.filter(payment_id=pid).order_by('-created_at').first()

        if qr_record:
            # Prevent underpayment: payment amount must match or exceed expected installment
            if payment_amount_paise >= qr_record.amount_paise:
                settle_payment_atomically(
                    payment=qr_record.payment,
                    qr_record=qr_record,
                    razorpay_payment_id=rzp_payment_id,
                    payment_method="Razorpay Dynamic UPI QR",
                    signature=signature
                )
            else:
                logger.warning(
                    "Received amount %s paise is less than required %s paise for QR %s",
                    payment_amount_paise, qr_record.amount_paise, qr_id
                )

    elif event_type == 'payment.captured':
        payment_entity = payload.get('payload', {}).get('payment', {}).get('entity', {})
        notes = payment_entity.get('notes', {})
        pid = notes.get('payment_id')
        rzp_payment_id = payment_entity.get('id')
        payment_amount_paise = payment_entity.get('amount', 0)

        if pid:
            qr_record = RazorpayQRCode.objects.filter(payment_id=pid).order_by('-created_at').first()
            if qr_record and payment_amount_paise >= qr_record.amount_paise:
                settle_payment_atomically(
                    payment=qr_record.payment,
                    qr_record=qr_record,
                    razorpay_payment_id=rzp_payment_id,
                    payment_method="Razorpay Dynamic UPI QR",
                    signature=signature
                )

    # Record event in idempotency table
    RazorpayWebhookEvent.objects.create(
        event_id=event_id,
        event_type=event_type,
        payload=payload,
        status='PROCESSED'
    )

    return Response({'status': 'ok', 'message': 'Webhook processed successfully.'}, status=status.HTTP_200_OK)