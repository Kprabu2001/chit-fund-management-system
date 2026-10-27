from rest_framework import status
from rest_framework.test import APITestCase

from api.models import PrizePayout, PrizePayoutLedgerEntry
import api.tests.test_declare_winner as dw

LIST = '/api/auctions/payouts/'


class PayoutFixture:
    """1-lakh / 20-member fixture (from test_declare_winner); ticket 1 (Rahul, usr_01) wins month 1."""

    def setUp(self):
        dw.DeclareWinnerTests.setUp(self)  # fixture only; the declare tests themselves are not inherited
        self._as(self.admin_token)
        res = self._declare()
        assert res.status_code == 201, res.data
        self.payout = PrizePayout.objects.get()
        self.url = f'{LIST}{self.payout.id}/'

    _as = dw.DeclareWinnerTests._as
    _declare = dw.DeclareWinnerTests._declare

    def _give_upi(self, vpa='rahul@okbank'):
        self.u1.upi_id = vpa
        self.u1.save()

    def _give_bank(self):
        self.u1.bank_account_holder = 'Rahul Sharma'
        self.u1.bank_account_number = '123456789012'
        self.u1.bank_ifsc = 'HDFC0001234'
        self.u1.save()



class PrizePayoutTests(PayoutFixture, APITestCase):
    """Part 2: payout panel data, Mark as Paid, ledger, member visibility."""

    # --- panel -------------------------------------------------------------------------------
    def test_panel_shows_winner_details_amount_and_upi_link(self):
        self._give_upi()
        res = self.client.get(self.url)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['payout']['amount'], 80000.0)
        self.assertEqual(res.data['winner']['name'], 'Rahul Sharma')
        self.assertEqual(res.data['winner']['upi_id'], 'rahul@okbank')
        self.assertTrue(res.data['winner']['has_upi'])
        self.assertEqual(res.data['winner']['suggested_method'], 'UPI')
        self.assertIsNone(res.data['warning'])
        uri = res.data['upi_uri']
        self.assertTrue(uri.startswith('upi://pay?pa=rahul%40okbank'))
        self.assertIn('am=80000.00', uri)
        self.assertIn('cu=INR', uri)

    def test_panel_shows_bank_details(self):
        self._give_bank()
        d = self.client.get(self.url).data
        self.assertTrue(d['winner']['has_bank'])
        self.assertEqual(d['winner']['bank_account_number'], '123456789012')
        self.assertEqual(d['winner']['bank_ifsc'], 'HDFC0001234')
        self.assertEqual(d['winner']['suggested_method'], 'BANK')
        self.assertEqual(d['upi_uri'], '')

    def test_panel_warns_when_no_details_saved(self):
        d = self.client.get(self.url).data
        self.assertFalse(d['winner']['has_any_details'])
        self.assertIn('has not saved', d['warning'])
        self.assertEqual(d['upi_uri'], '')
        self.assertTrue(d['payout']['details_missing'])

    def test_incomplete_bank_details_do_not_count(self):
        self.u1.bank_account_number = '123456789012'   # no holder / IFSC
        self.u1.save()
        self.assertFalse(self.client.get(self.url).data['winner']['has_bank'])

    def test_panel_is_admin_only(self):
        self._give_upi()
        self._as(self.t1)  # the winner themself
        self.assertEqual(self.client.get(self.url).status_code, 403)
        self._as(self.t2)
        self.assertEqual(self.client.get(self.url).status_code, 403)

    def test_unknown_payout_404(self):
        self.assertEqual(self.client.get(f'{LIST}NOPE/').status_code, 404)

    # --- mark paid ---------------------------------------------------------------------------
    def test_mark_paid_records_who_when_and_ledger(self):
        self._give_upi()
        res = self.client.post(self.url + 'mark-paid/', {'method': 'UPI', 'utr': 'UTR412345678901', 'notes': 'paid 10am'}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        p = PrizePayout.objects.get()
        self.assertEqual(p.status, 'PAID')
        self.assertEqual(p.utr, 'UTR412345678901')
        self.assertEqual(p.paid_by, self.admin)
        self.assertIsNotNone(p.paid_at)
        self.assertEqual(p.method, 'UPI')
        self.assertEqual(p.destination, 'UPI ra•••@okbank')   # masked in the audit trail
        entry = PrizePayoutLedgerEntry.objects.get()
        self.assertEqual((entry.entry_type, entry.amount, entry.transaction_ref, entry.performed_by),
                         ('PAID', p.amount, 'UTR412345678901', self.admin))

    def test_mark_paid_bank_masks_account(self):
        self._give_bank()
        res = self.client.post(self.url + 'mark-paid/', {'method': 'BANK', 'utr': 'NEFT00112233'}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        dest = PrizePayout.objects.get().destination
        self.assertTrue(dest.endswith('9012 · HDFC0001234'))
        self.assertNotIn('123456789012', dest)

    def test_utr_required_and_validated(self):
        self._give_upi()
        for bad in ('', '123', 'has space 123456', 'x' * 41):
            r = self.client.post(self.url + 'mark-paid/', {'method': 'UPI', 'utr': bad}, format='json')
            self.assertEqual(r.status_code, 400, bad)
        self.assertEqual(PrizePayout.objects.get().status, 'PENDING')
        self.assertFalse(PrizePayoutLedgerEntry.objects.exists())

    def test_cannot_pay_to_method_without_details(self):
        self._give_upi()  # no bank saved
        r = self.client.post(self.url + 'mark-paid/', {'method': 'BANK', 'utr': 'NEFT00112233'}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertIn('no valid bank account', r.data['error'])
        r = self.client.post(self.url + 'mark-paid/', {'method': 'CASH', 'utr': 'NEFT00112233'}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_cannot_mark_paid_with_no_details_at_all(self):
        r = self.client.post(self.url + 'mark-paid/', {'method': 'UPI', 'utr': 'UTR412345678901'}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_cannot_pay_twice(self):
        self._give_upi()
        body = {'method': 'UPI', 'utr': 'UTR412345678901'}
        self.assertEqual(self.client.post(self.url + 'mark-paid/', body, format='json').status_code, 200)
        again = self.client.post(self.url + 'mark-paid/', {**body, 'utr': 'UTR999999999999'}, format='json')
        self.assertEqual(again.status_code, 400)
        self.assertEqual(PrizePayoutLedgerEntry.objects.count(), 1)

    def test_duplicate_utr_across_payouts_blocked(self):
        from api.models import AuctionRecord
        self._give_upi()
        rec = AuctionRecord.objects.get()
        rec.pk, rec.month_number = 'REC-X', 9
        rec.save()
        PrizePayout.objects.create(
            id='PAYOUT-X', auction_record=rec, scheme=self.scheme, ticket=self.ticket2, user=self.u2,
            month_number=9, amount=1, status='PAID', utr='UTR412345678901')
        r = self.client.post(self.url + 'mark-paid/', {'method': 'UPI', 'utr': 'utr412345678901'}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertIn('already been used', r.data['error'])

    def test_member_cannot_mark_paid(self):
        self._give_upi()
        self._as(self.t1)
        r = self.client.post(self.url + 'mark-paid/', {'method': 'UPI', 'utr': 'UTR412345678901'}, format='json')
        self.assertEqual(r.status_code, 403)
        self.assertEqual(PrizePayout.objects.get().status, 'PENDING')

    # --- visibility --------------------------------------------------------------------------
    def test_admin_list_has_all_payouts_and_filters(self):
        d = self.client.get(LIST).data
        self.assertEqual(len(d), 1)
        self.assertEqual(d[0]['winner_name'], 'Rahul Sharma')
        self.assertEqual(self.client.get(LIST + '?status=PAID').data, [])
        self.assertEqual(len(self.client.get(LIST + '?status=pending').data), 1)

    def test_winner_sees_only_own_status_amount_and_utr(self):
        self._give_upi()
        self.client.post(self.url + 'mark-paid/', {'method': 'UPI', 'utr': 'UTR412345678901'}, format='json')
        self._as(self.t1)
        rows = self.client.get(LIST).data
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual((row['status'], row['amount'], row['utr']), ('PAID', 80000.0, 'UTR412345678901'))
        flat = str(row)
        for secret in ('rahul@okbank', 'ra•••', 'phone', 'bank_account', 'destination', 'method'):
            self.assertNotIn(secret, flat)
        self.assertNotIn('paid_by_name', row)

    def test_pending_prize_hides_utr_from_member_and_other_members_see_nothing(self):
        self._as(self.t1)
        self.assertEqual(self.client.get(LIST).data[0]['utr'], '')
        self._as(self.t2)
        self.assertEqual(self.client.get(LIST).data, [])

    def test_anonymous_cannot_list(self):
        self.client.credentials()
        self.assertIn(self.client.get(LIST).status_code, (401, 403))

    def test_revert_still_works_while_pending_and_blocked_once_paid(self):
        self._give_upi()
        self.client.post(self.url + 'mark-paid/', {'method': 'UPI', 'utr': 'UTR412345678901'}, format='json')
        r = self.client.post(dw.REVERT, {'scheme_id': self.scheme.id}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertIn('already been marked Paid', r.data['error'])


class PayoutNotificationTests(PayoutFixture, APITestCase):
    """Part 3: 'add your details' notification state + admin Remind member."""

    REMIND = lambda self: f'{LIST}{self.payout.id}/remind/'  # noqa: E731

    def _member_row(self):
        self._as(self.t1)
        row = self.client.get(LIST).data[0]
        self._as(self.admin_token)
        return row

    def test_winner_is_flagged_when_details_missing_then_cleared_on_save(self):
        self.assertTrue(self._member_row()['details_missing'])
        # member saves a UPI id through the normal profile endpoint
        self._as(self.t1)
        r = self.client.patch('/api/auth/profile/', {'upi_id': 'rahul@okhdfc'}, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        self._as(self.admin_token)
        self.assertFalse(self._member_row()['details_missing'])

    def test_bank_alone_is_enough_to_clear(self):
        self._give_bank()
        self.assertFalse(self._member_row()['details_missing'])

    def test_flag_clears_once_paid(self):
        self._give_upi()
        self.client.post(self.url + 'mark-paid/', {'method': 'UPI', 'utr': 'UTR412345678901'}, format='json')
        self.assertFalse(self._member_row()['details_missing'])

    def test_admin_can_remind_and_member_sees_timestamp(self):
        r = self.client.post(self.REMIND(), format='json')
        self.assertEqual(r.status_code, 200, r.data)
        p = PrizePayout.objects.get()
        self.assertEqual(p.details_reminder_count, 1)
        self.assertIsNotNone(p.details_reminder_sent_at)
        self.assertIsNotNone(self._member_row()['details_reminder_sent_at'])
        self.assertEqual(PrizePayoutLedgerEntry.objects.filter(entry_type='REMINDER').count(), 1)
        self.assertTrue(self.client.get(LIST).data[0]['details_reminder_count'] == 1)

    def test_remind_rate_limited(self):
        self.assertEqual(self.client.post(self.REMIND(), format='json').status_code, 200)
        again = self.client.post(self.REMIND(), format='json')
        self.assertEqual(again.status_code, 429)
        self.assertEqual(PrizePayout.objects.get().details_reminder_count, 1)
        # after the cooldown it works again
        import datetime
        from django.utils import timezone
        PrizePayout.objects.update(details_reminder_sent_at=timezone.now() - datetime.timedelta(minutes=31))
        self.assertEqual(self.client.post(self.REMIND(), format='json').status_code, 200)
        self.assertEqual(PrizePayout.objects.get().details_reminder_count, 2)

    def test_cannot_remind_when_details_present_or_paid(self):
        self._give_upi()
        r = self.client.post(self.REMIND(), format='json')
        self.assertEqual(r.status_code, 400)
        self.assertIn('already saved', r.data['error'])

    def test_cannot_remind_a_paid_payout(self):
        self._give_upi()
        self.client.post(self.url + 'mark-paid/', {'method': 'UPI', 'utr': 'UTR412345678901'}, format='json')
        self.u1.upi_id = ''
        self.u1.save()
        self.assertEqual(self.client.post(self.REMIND(), format='json').status_code, 400)

    def test_member_cannot_remind(self):
        self._as(self.t1)
        self.assertEqual(self.client.post(self.REMIND(), format='json').status_code, 403)
        self.assertEqual(PrizePayout.objects.get().details_reminder_count, 0)

    def test_remind_unknown_payout_404(self):
        self.assertEqual(self.client.post(f'{LIST}NOPE/remind/', format='json').status_code, 404)

    def test_other_member_never_sees_flag(self):
        self._as(self.t2)
        self.assertEqual(self.client.get(LIST).data, [])