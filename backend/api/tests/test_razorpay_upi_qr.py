import json
import time
import hmac
import hashlib
from decimal import Decimal

from django.conf import settings
from django.contrib.auth.models import User
from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework.authtoken.models import Token

from api.models import (
    UserProfile, ValueTier, AuctionScheme, Ticket,
    MonthlyPayment, PaymentLedgerEntry, RazorpayQRCode, RazorpayWebhookEvent
)


class RazorpayUPIQRTests(APITestCase):
    def setUp(self):
        # Member 1
        self.user1 = User.objects.create_user(
            username='member1@auctionticket.com', email='member1@auctionticket.com', password='password123'
        )
        self.user1_token = Token.objects.create(user=self.user1)
        self.user1_profile = UserProfile.objects.create(
            id='usr_test_01', user=self.user1, name='Aarav Mehta',
            email='member1@auctionticket.com', phone='9876543210', role='user'
        )

        # Member 2 (Unauthorized attacker / another member)
        self.user2 = User.objects.create_user(
            username='member2@auctionticket.com', email='member2@auctionticket.com', password='password123'
        )
        self.user2_token = Token.objects.create(user=self.user2)
        self.user2_profile = UserProfile.objects.create(
            id='usr_test_02', user=self.user2, name='Kavita Nair',
            email='member2@auctionticket.com', phone='9822001122', role='user'
        )

        # Value Tier & Scheme
        self.tier = ValueTier.objects.create(
            id='silver', name='Silver Tier', range_label='1L - 2L',
            min_val=Decimal('100000.00'), max_val=Decimal('200000.00')
        )
        self.scheme = AuctionScheme.objects.create(
            id='SCH-SLV-TEST', name='Silver 1.5L Scheme', tier=self.tier,
            total_value=Decimal('150000.00'), duration_months=15,
            monthly_installment=Decimal('10000.00'), total_slots=15, booked_slots=2
        )

        # Ticket
        self.ticket1 = Ticket.objects.create(
            id='TKT-SLV-01', ticket_number=1, scheme=self.scheme,
            user=self.user1_profile, total_months_paid=0
        )

        # Due Payment Installment (₹10,000 base - ₹500 dividend discount = ₹9,500 net payable)
        self.payment1 = MonthlyPayment.objects.create(
            id='PAY-SLV-01-M1', ticket=self.ticket1, scheme=self.scheme, user=self.user1_profile,
            month_number=1, month_name='Jan', base_amount=Decimal('10000.00'),
            dividend_discount=Decimal('500.00'), net_payable=Decimal('9500.00'),
            due_date='2026-01-10', status='DUE'
        )

    def test_create_dynamic_upi_qr_success(self):
        """User can initiate a Dynamic UPI QR code with DB-computed net_payable amount"""
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.user1_token.key}')
        res = self.client.post(f'/api/payments/{self.payment1.id}/create-qr/')

        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIn('qr_code', res.data)
        qr_data = res.data['qr_code']

        # Verifications
        self.assertTrue(qr_data['id'].startswith('qr_'))
        self.assertEqual(Decimal(str(qr_data['amount'])), Decimal('9500.00'))
        self.assertEqual(qr_data['amount_paise'], 950000)
        self.assertEqual(qr_data['status'], 'active')
        self.assertTrue(bool(qr_data['image_url']))
        self.assertTrue(qr_data['upi_intent_url'].startswith('upi://pay?'))

        # DB persistence check
        qr_obj = RazorpayQRCode.objects.get(id=qr_data['id'])
        self.assertEqual(qr_obj.payment, self.payment1)
        self.assertEqual(qr_obj.amount_paise, 950000)

    def test_prevent_qr_creation_for_already_paid_installment(self):
        """Cannot generate a payment QR for an already settled installment (prevent overpayment)"""
        self.payment1.status = 'PAID'
        self.payment1.save()

        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.user1_token.key}')
        res = self.client.post(f'/api/payments/{self.payment1.id}/create-qr/')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('already', res.data['error'].lower())

    def test_unauthorized_user_cannot_create_qr_for_another_member(self):
        """Member 2 cannot create a QR code or pay for Member 1's installment"""
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.user2_token.key}')
        res = self.client.post(f'/api/payments/{self.payment1.id}/create-qr/')
        self.assertIn(res.status_code, [status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND])

    def test_qr_status_polling(self):
        """Status polling endpoint returns active and not paid initially"""
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.user1_token.key}')
        create_res = self.client.post(f'/api/payments/{self.payment1.id}/create-qr/')
        qr_id = create_res.data['qr_code']['id']

        poll_res = self.client.get(f'/api/payments/{self.payment1.id}/qr-status/?qr_id={qr_id}')
        self.assertEqual(poll_res.status_code, status.HTTP_200_OK)
        self.assertFalse(poll_res.data['is_paid'])
        self.assertFalse(poll_res.data['is_expired'])
        self.assertEqual(poll_res.data['qr_code']['id'], qr_id)

    def test_webhook_rejects_invalid_signature(self):
        """Webhook endpoint rejects requests with invalid or forged HMAC signature"""
        fake_payload = json.dumps({"event": "payment.captured", "id": "evt_fake_123"}).encode('utf-8')
        res = self.client.post(
            '/api/payments/webhook/',
            fake_payload,
            content_type='application/json',
            HTTP_X_RAZORPAY_SIGNATURE='forged_invalid_signature_hex'
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('Invalid webhook signature', res.data['error'])

    def test_webhook_qr_credited_success_and_atomic_settlement(self):
        """
        Valid webhook event 'qr_code.credited' atomically marks payment as PAID,
        increments ticket passbook, and writes to audit ledger.
        """
        # 1. Create QR session first
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.user1_token.key}')
        create_res = self.client.post(f'/api/payments/{self.payment1.id}/create-qr/')
        qr_id = create_res.data['qr_code']['id']

        # 2. Build official Razorpay webhook payload
        event_id = f"evt_test_{int(time.time())}"
        webhook_data = {
            "entity": "event",
            "account_id": "acc_test",
            "event": "qr_code.credited",
            "contains": ["qr_code", "payment"],
            "payload": {
                "qr_code": {
                    "entity": {
                        "id": qr_id,
                        "entity": "qr_code",
                        "status": "closed"
                    }
                },
                "payment": {
                    "entity": {
                        "id": "pay_test_998877",
                        "entity": "payment",
                        "amount": 950000,
                        "currency": "INR",
                        "status": "captured",
                        "method": "upi",
                        "notes": {
                            "payment_id": self.payment1.id
                        }
                    }
                }
            },
            "id": event_id
        }
        raw_body = json.dumps(webhook_data).encode('utf-8')

        # Compute valid HMAC SHA-256 signature
        secret = settings.RAZORPAY_WEBHOOK_SECRET.encode('utf-8')
        valid_signature = hmac.new(secret, raw_body, hashlib.sha256).hexdigest()

        # 3. Dispatch to webhook endpoint
        res = self.client.post(
            '/api/payments/webhook/',
            raw_body,
            content_type='application/json',
            HTTP_X_RAZORPAY_SIGNATURE=valid_signature
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['status'], 'ok')

        # 4. Verify Database state
        self.payment1.refresh_from_db()
        self.ticket1.refresh_from_db()
        qr_obj = RazorpayQRCode.objects.get(id=qr_id)

        self.assertEqual(self.payment1.status, 'PAID')
        self.assertTrue(self.payment1.is_verified)
        self.assertEqual(self.payment1.payment_method, 'Razorpay Dynamic UPI QR')
        self.assertEqual(self.payment1.transaction_ref, 'pay_test_998877')
        self.assertTrue(self.payment1.receipt_number.startswith('REC-RZP-'))
        self.assertEqual(self.ticket1.total_months_paid, 1)

        self.assertEqual(qr_obj.status, 'paid')
        self.assertEqual(qr_obj.razorpay_payment_id, 'pay_test_998877')

        # Verify audit ledger entry
        ledger = PaymentLedgerEntry.objects.filter(payment=self.payment1).first()
        self.assertIsNotNone(ledger)
        self.assertEqual(ledger.amount, Decimal('9500.00'))
        self.assertEqual(ledger.new_status, 'PAID')

        # 5. Verify Idempotency: Re-dispatching the exact same event
        res_duplicate = self.client.post(
            '/api/payments/webhook/',
            raw_body,
            content_type='application/json',
            HTTP_X_RAZORPAY_SIGNATURE=valid_signature
        )
        self.assertEqual(res_duplicate.status_code, status.HTTP_200_OK)
        self.assertIn('already processed', res_duplicate.data['message'])

        # Must not re-increment ticket total_months_paid!
        self.ticket1.refresh_from_db()
        self.assertEqual(self.ticket1.total_months_paid, 1)

        # Must not duplicate ledger entry!
        self.assertEqual(PaymentLedgerEntry.objects.filter(payment=self.payment1).count(), 1)

    def test_webhook_rejects_underpayment(self):
        """Webhook does not mark payment as paid if received amount is less than required"""
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.user1_token.key}')
        create_res = self.client.post(f'/api/payments/{self.payment1.id}/create-qr/')
        qr_id = create_res.data['qr_code']['id']

        event_id = f"evt_underpay_{int(time.time())}"
        webhook_data = {
            "entity": "event",
            "event": "qr_code.credited",
            "payload": {
                "qr_code": {"entity": {"id": qr_id}},
                "payment": {
                    "entity": {
                        "id": "pay_short_123",
                        "amount": 500000, # Only 5000.00 instead of 9500.00
                        "status": "captured"
                    }
                }
            },
            "id": event_id
        }
        raw_body = json.dumps(webhook_data).encode('utf-8')
        secret = settings.RAZORPAY_WEBHOOK_SECRET.encode('utf-8')
        valid_signature = hmac.new(secret, raw_body, hashlib.sha256).hexdigest()

        res = self.client.post(
            '/api/payments/webhook/',
            raw_body,
            content_type='application/json',
            HTTP_X_RAZORPAY_SIGNATURE=valid_signature
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        self.payment1.refresh_from_db()
        # Must still be DUE!
        self.assertEqual(self.payment1.status, 'DUE')
