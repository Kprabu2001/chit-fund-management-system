from rest_framework.test import APITestCase

import api.tests.test_declare_winner as dw
from api.models import UserProfile

RESULTS = '/api/auctions/results/'


class AuctionResultsTests(APITestCase):
    """Every member of the chit hears the result, with their own dividend and new due."""

    def setUp(self):
        dw.DeclareWinnerTests.setUp(self)
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {self.admin_token.key}')
        r = self.client.post('/api/auctions/declare-winner/', {
            'scheme_id': self.scheme.id, 'ticket_id': self.ticket1.id, 'discount_amount': '20000.00'}, format='json')
        assert r.status_code == 201, r.data

    def _get(self, token):
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {token.key}')
        return self.client.get(RESULTS)

    def test_non_winner_sees_result_and_own_numbers(self):
        rows = self._get(self.t2).data
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual((row['month_number'], row['winner_name'], row['winner_ticket_number']), (1, 'Rahul Sharma', 1))
        self.assertEqual(row['winning_discount'], 20000.0)
        self.assertEqual(row['my_dividend'], 789.47)
        self.assertEqual(row['my_next_due'], 4210.53)
        self.assertFalse(row['i_won'])

    def test_winner_flagged_with_no_dividend(self):
        row = self._get(self.t1).data[0]
        self.assertTrue(row['i_won'])
        self.assertEqual(row['my_dividend'], 0.0)
        self.assertEqual(row['my_next_due'], 5000.0)

    def test_no_payout_or_private_data_leaks(self):
        flat = str(self._get(self.t2).data)
        for forbidden in ('utr', 'payout', 'upi', 'bank', 'phone', 'amount'):
            self.assertNotIn(forbidden, flat.lower().replace('winning_discount', ''))

    def test_member_of_other_chit_sees_nothing(self):
        from django.contrib.auth.models import User
        from rest_framework.authtoken.models import Token
        u = User.objects.create_user(username='out@x.com', email='out@x.com', password='x')
        tok = Token.objects.create(user=u)
        UserProfile.objects.create(id='usr_out', user=u, name='Outsider', email='out@x.com', phone='9111111111')
        self.assertEqual(self._get(tok).data, [])

    def test_admin_sees_results_without_personal_figures(self):
        rows = self._get(self.admin_token).data
        self.assertEqual(len(rows), 1)
        self.assertNotIn('my_dividend', rows[0])

    def test_old_results_drop_off(self):
        from datetime import timedelta
        from django.utils import timezone
        from api.models import AuctionRecord
        AuctionRecord.objects.update(concluded_at=timezone.now() - timedelta(days=31))
        self.assertEqual(self._get(self.t2).data, [])
