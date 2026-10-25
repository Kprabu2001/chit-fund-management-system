from django.contrib.auth.models import User
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.test import APITestCase

from api.models import UserProfile


class ProfileTests(APITestCase):
    def setUp(self):
        self.u1 = User.objects.create_user(username='u1', email='u1@x.com', password='p')
        self.p1 = UserProfile.objects.create(id='usr_1', user=self.u1, name='Rahul Sharma', email='u1@x.com',
                                             phone='+91 98765 43210', role='user', kyc_status='Pending', city='')
        self.u2 = User.objects.create_user(username='u2', email='u2@x.com', password='p')
        self.p2 = UserProfile.objects.create(id='usr_2', user=self.u2, name='Priya', email='u2@x.com',
                                             phone='+91 98220 11223', role='user')
        self.token = Token.objects.create(user=self.u1)
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.token.key}')
        self.url = '/api/auth/profile/'

    def test_get_own_profile(self):
        r = self.client.get(self.url)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['name'], 'Rahul Sharma')
        self.assertIn('upi_id', r.data)

    def test_update_details_payout_and_nominee(self):
        r = self.client.patch(self.url, {
            'name': 'Rahul S', 'city': 'Pune', 'email': 'rahul@new.com',
            'upi_id': 'rahul@okhdfc', 'bank_account_holder': 'Rahul S', 'bank_account_number': '123456789012',
            'bank_ifsc': 'hdfc0001234', 'nominee_name': 'Sita', 'nominee_relation': 'Spouse'}, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        self.p1.refresh_from_db(); self.u1.refresh_from_db()
        self.assertEqual(self.p1.city, 'Pune')
        self.assertEqual(self.p1.bank_ifsc, 'HDFC0001234')
        self.assertEqual(self.p1.nominee_name, 'Sita')
        self.assertEqual(self.u1.email, 'rahul@new.com')

    def test_phone_role_kyc_cannot_be_changed(self):
        r = self.client.patch(self.url, {'phone': '+91 11111 11111', 'role': 'admin', 'kyc_status': 'Verified'}, format='json')
        self.assertEqual(r.status_code, 200)
        self.p1.refresh_from_db()
        self.assertEqual(self.p1.phone, '+91 98765 43210')
        self.assertEqual(self.p1.role, 'user')
        self.assertEqual(self.p1.kyc_status, 'Pending')

    def test_validation_errors(self):
        for payload in ({'upi_id': 'not-a-upi'}, {'bank_ifsc': 'BAD'}, {'bank_account_number': '12ab'},
                        {'email': 'u2@x.com'}, {'name': ' '},
                        {'bank_account_number': '123456789012', 'bank_ifsc': 'HDFC0001234'}):
            r = self.client.patch(self.url, payload, format='json')
            self.assertEqual(r.status_code, 400, payload)

    def test_member_cannot_self_verify_via_users_endpoint(self):
        r = self.client.patch(f'/api/users/{self.p1.id}/', {'kyc_status': 'Verified'}, format='json')
        self.assertEqual(r.status_code, 403)
        self.p1.refresh_from_db(); self.assertEqual(self.p1.kyc_status, 'Pending')

    def test_requires_login(self):
        self.client.credentials()
        self.assertEqual(self.client.get(self.url).status_code, 401)