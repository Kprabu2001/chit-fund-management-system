import { formatINR } from '../data/initialData';

const DAY = 24 * 60 * 60 * 1000;
const SOON_DAYS = 7;
const RECENT_DAYS = 7;

const statusOf = (p) => (p.status || '').toUpperCase();
const amountOf = (p) => Number(p.netPayable ?? p.net_payable ?? 0);
const dueOf = (p) => p.dueDate || p.due_date || '';
const monthOf = (p) => p.monthNumber ?? p.month_number;
const schemeOf = (p) => p.schemeName || p.scheme_name || 'Chit';

const toDay = (value) => {
  if (!value) return null;
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
};

const today = () => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
};

/**
 * Builds in-app notifications from payment data (no backend needed).
 * Each item: { id, type: 'danger'|'warn'|'ok'|'info', title, body, time, action }
 * action: { kind: 'pay'|'receipt'|'ledger', payment? }
 */
export function buildNotifications(payments = [], currentUser, payouts = [], results = []) {
  const now = today();
  const isAdmin = currentUser?.role === 'admin';
  const mine = isAdmin ? payments : payments.filter(p => !currentUser?.id || (p.userId || p.user_id) === currentUser.id);
  const items = [];

  const overdue = [];
  const dueSoon = [];
  const recentlyPaid = [];

  mine.forEach(p => {
    const st = statusOf(p);
    const due = toDay(dueOf(p));
    if (st === 'OVERDUE') {
      overdue.push(p);
    } else if ((st === 'DUE' || st === 'UPCOMING') && due) {
      const days = Math.round((due - now) / DAY);
      // DUE = this month's installment (always notify); UPCOMING only when it is close
      if (st === 'DUE' || days <= SOON_DAYS) dueSoon.push({ p, days });
    } else if (st === 'PAID') {
      const paid = toDay(p.paidDate || p.paid_date);
      if (paid) {
        const ago = Math.round((now - paid) / DAY);
        if (ago >= 0 && ago <= RECENT_DAYS) recentlyPaid.push({ p, ago, paid });
      }
    }
  });

  if (isAdmin) {
    if (overdue.length) {
      const members = new Set(overdue.map(p => p.userId || p.user_id || p.userName)).size;
      items.push({
        id: `admin-overdue-${overdue.length}-${overdue.reduce((s, p) => s + amountOf(p), 0)}`,
        type: 'danger',
        title: `${overdue.length} overdue payment${overdue.length > 1 ? 's' : ''}`,
        body: `${formatINR(overdue.reduce((s, p) => s + amountOf(p), 0))} pending from ${members} member${members > 1 ? 's' : ''}.`,
        sort: 0,
        action: { kind: 'ledger' }
      });
    }
    if (dueSoon.length) {
      items.push({
        id: `admin-soon-${dueSoon.length}-${dueSoon.reduce((s, x) => s + amountOf(x.p), 0)}`,
        type: 'warn',
        title: `${dueSoon.length} payment${dueSoon.length > 1 ? 's' : ''} due soon`,
        body: `${formatINR(dueSoon.reduce((s, x) => s + amountOf(x.p), 0))} expected this month.`,
        sort: 1,
        action: { kind: 'ledger' }
      });
    }
    const pendingPrizes = payouts.filter(x => x.status === 'PENDING');
    if (pendingPrizes.length) {
      const noDetails = pendingPrizes.filter(x => x.details_missing).length;
      items.push({
        id: `admin-prizes-${pendingPrizes.map(x => x.id).join(',')}-${noDetails}`,
        type: 'warn',
        title: `${pendingPrizes.length} prize payout${pendingPrizes.length > 1 ? 's' : ''} pending`,
        body: `${formatINR(pendingPrizes.reduce((sum, x) => sum + Number(x.amount), 0))} to pay${noDetails ? `; ${noDetails} winner${noDetails > 1 ? 's have' : ' has'} not added UPI / bank details` : ''}.`,
        sort: 1,
        action: { kind: 'prizes' }
      });
    }
    if (recentlyPaid.length) {
      items.push({
        id: `admin-paid-${recentlyPaid.length}-${recentlyPaid.reduce((s, x) => s + amountOf(x.p), 0)}`,
        type: 'ok',
        title: `${recentlyPaid.length} payment${recentlyPaid.length > 1 ? 's' : ''} received`,
        body: `${formatINR(recentlyPaid.reduce((s, x) => s + amountOf(x.p), 0))} collected in the last ${RECENT_DAYS} days.`,
        sort: 2,
        action: { kind: 'ledger' }
      });
    }
    return items;
  }

  // Monthly auction result for each of the member's chits (server limits this to the last 30 days
  // and adds the member's own dividend and new due). Showing the result to everyone is normal chit practice.
  results.forEach(r => {
    if (r.my_dividend === undefined) return;   // admin rows carry no personal figures
    const head = `${r.scheme_name} · Month #${r.month_number} auction: Ticket #${r.winner_ticket_number} (${r.winner_name}) won with a ${formatINR(r.winning_discount)} discount.`;
    let tail;
    if (r.i_won) tail = ' You won this month! See your ticket for the prize status.';
    else if (r.my_next_due != null) {
      tail = r.my_dividend > 0
        ? ` Your dividend is ${formatINR(r.my_dividend)}, so your next due is ${formatINR(r.my_next_due)}.`
        : ` Your next due is ${formatINR(r.my_next_due)}.`;
    } else tail = '';
    items.push({
      id: `result-${r.id}`,
      type: r.i_won ? 'ok' : 'info',
      title: r.i_won ? `🏆 You won Month #${r.month_number}!` : `Auction result · Month #${r.month_number}`,
      body: head + tail,
      sort: 1,
      action: { kind: 'result' }
    });
  });

  // Prize payouts (winner only; the list is already limited to this member's own prizes).
  // 'details_missing' is computed by the server from the live profile, so this item
  // disappears as soon as a UPI ID or a complete bank account is saved.
  payouts.forEach(x => {
    if (x.status === 'PENDING' && x.details_missing) {
      const reminded = x.details_reminder_sent_at;
      items.push({
        id: `prize-details-${x.id}-${reminded || 'new'}`,
        type: 'danger',
        title: reminded ? 'Reminder: add your payout details' : '🏆 You won! Add your payout details',
        body: `Add your UPI or bank details to receive your prize of ${formatINR(x.amount)} (${x.scheme_name}, month #${x.month_number}).`,
        sort: -2,
        action: { kind: 'profile' }
      });
    } else if (x.status === 'PENDING') {
      items.push({
        id: `prize-pending-${x.id}`,
        type: 'info',
        title: 'Prize on its way',
        body: `Your prize of ${formatINR(x.amount)} (${x.scheme_name}, month #${x.month_number}) will be paid by the admin.`,
        sort: 1,
        action: { kind: 'prizes' }
      });
    } else if (x.status === 'PAID') {
      const paid = toDay(x.paid_at);
      const ago = paid ? Math.round((now - paid) / DAY) : null;
      if (ago !== null && ago >= 0 && ago <= RECENT_DAYS) {
        items.push({
          id: `prize-paid-${x.id}`,
          type: 'ok',
          title: 'Prize paid',
          body: `${formatINR(x.amount)} for ${x.scheme_name}, month #${x.month_number} was paid. UTR ${x.utr}.`,
          sort: 2,
          action: { kind: 'prizes' }
        });
      }
    }
  });

  // Reminder sent by the admin (stored on the payment, so it survives refresh)
  const reminded = mine.filter(p => statusOf(p) !== 'PAID' && (p.reminderSentAt || p.reminder_sent_at));
  if (reminded.length) {
    const latest = reminded.reduce((m, p) => {
      const t = p.reminderSentAt || p.reminder_sent_at;
      return t > m ? t : m;
    }, '');
    const batch = reminded.filter(p => (p.reminderSentAt || p.reminder_sent_at) === latest);
    const total = batch.reduce((sum, p) => sum + amountOf(p), 0);
    const oldest = [...batch].sort((a, b) => dueOf(a).localeCompare(dueOf(b)))[0];
    items.push({
      id: `reminder-${latest}`,
      type: 'danger',
      title: 'Payment reminder from admin',
      body: `${batch.length} pending payment${batch.length > 1 ? 's' : ''} totalling ${formatINR(total)}. Please pay at the earliest.`,
      sort: -1,
      action: { kind: 'pay', payment: oldest }
    });
  }

  overdue
    .sort((a, b) => dueOf(a).localeCompare(dueOf(b)))
    .forEach(p => items.push({
      id: `overdue-${p.id}`,
      type: 'danger',
      title: 'Payment overdue',
      body: `${formatINR(amountOf(p))} for ${schemeOf(p)}, month #${monthOf(p)} was due on ${dueOf(p)}.`,
      sort: 0,
      action: { kind: 'pay', payment: p }
    }));

  dueSoon
    .sort((a, b) => a.days - b.days)
    .forEach(({ p, days }) => {
      const when = days < 0 ? `was due on ${dueOf(p)}` : days === 0 ? 'is due today' : days === 1 ? 'is due tomorrow' : `is due in ${days} days`;
      items.push({
        id: `due-${p.id}`,
        type: 'warn',
        title: 'Payment due soon',
        body: `${formatINR(amountOf(p))} for ${schemeOf(p)}, month #${monthOf(p)} ${when}.`,
        sort: 1,
        action: { kind: 'pay', payment: p }
      });
    });

  recentlyPaid
    .sort((a, b) => b.paid - a.paid)
    .forEach(({ p, ago }) => items.push({
      id: `paid-${p.id}`,
      type: 'ok',
      title: 'Payment received',
      body: `${formatINR(amountOf(p))} for ${schemeOf(p)}, month #${monthOf(p)} ${ago === 0 ? 'was paid today' : ago === 1 ? 'was paid yesterday' : `was paid ${ago} days ago`}.`,
      sort: 2,
      action: { kind: 'receipt', payment: p }
    }));

  return items;
}