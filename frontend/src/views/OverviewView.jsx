import React from 'react';
import { formatINR } from '../data/initialData';
import { formatTicketId } from '../utils/format';
import Skeleton, { SkeletonRows } from '../components/Skeleton';

export default function OverviewView({
  loading = false,
  stats,
  payments = [],
  tickets = [],
  currentUser,
  onNavigate,
  onFilterTier,
  onOpenPaymentModal,
  onViewReceipt,
  onReconcilePayment
}) {
  const isAdmin = currentUser?.role === 'admin';
  const userStats = {
    total_monthly_paid: stats?.user_stats?.total_monthly_paid ?? stats?.user_stats?.totalMonthlyPaid ?? 0,
    upcoming_dues: stats?.user_stats?.upcoming_dues ?? stats?.user_stats?.upcomingDues ?? 0,
    dividend_savings: stats?.user_stats?.dividend_savings ?? stats?.user_stats?.dividendSavings ?? 0,
    active_tickets_count: stats?.user_stats?.active_tickets_count ?? stats?.user_stats?.activeTicketsCount ?? 0
  };

  const userTickets = (tickets || []).filter(t => !currentUser?.id || t.userId === currentUser.id || t.user_id === currentUser.id);
  const activeTicketsCount = userTickets.length > 0 ? userTickets.length : (userStats.active_tickets_count || 0);

  const statusOf = (p) => (p.status || '').toUpperCase();
  const amountOf = (p) => Number(p.netPayable ?? p.net_payable ?? 0);
  const dueOf = (p) => String(p.dueDate || p.due_date || '');

  const userPayments = (payments || []).filter(p => !currentUser?.id || p.userId === currentUser.id || p.user_id === currentUser.id);
  const hasPayments = userPayments.length > 0;
  const sumOf = (list) => list.reduce((sum, p) => sum + amountOf(p), 0);

  const paidList = userPayments.filter(p => statusOf(p) === 'PAID');
  const payableNow = userPayments.filter(p => statusOf(p) === 'DUE' || statusOf(p) === 'OVERDUE');
  const upcomingList = userPayments.filter(p => statusOf(p) === 'UPCOMING');
  const overdueList = userPayments.filter(p => statusOf(p) === 'OVERDUE');

  const dynamicTotalPaid = hasPayments ? sumOf(paidList) : userStats.total_monthly_paid;
  // "Payable now" = overdue + this month's dues (future months are shown separately)
  const dynamicPayableNow = hasPayments ? sumOf(payableNow) : userStats.upcoming_dues;
  const upcomingAmount = hasPayments ? sumOf(upcomingList) : 0;
  const dynamicDividendSavings = hasPayments
    ? paidList.reduce((sum, p) => sum + Number(p.dividendDiscount ?? p.dividend_discount ?? 0), 0)
    : userStats.dividend_savings;

  // Paid in the current calendar month (by the date it was paid)
  const monthKey = new Date().toLocaleDateString('en-CA').slice(0, 7);
  const paidThisMonth = sumOf(paidList.filter(p => String(p.paidDate || p.paid_date || '').slice(0, 7) === monthKey));

  const nextDue = [...payableNow].sort((a, b) => dueOf(a).localeCompare(dueOf(b)))[0] || null;

  // Most relevant first: overdue, due, upcoming, then the latest paid ones
  const order = { OVERDUE: 0, DUE: 1, UPCOMING: 2, PAID: 3 };
  const recentPayments = [...userPayments].sort((a, b) => {
    const sa = order[statusOf(a)] ?? 4;
    const sb = order[statusOf(b)] ?? 4;
    if (sa !== sb) return sa - sb;
    return sa === 3 ? dueOf(b).localeCompare(dueOf(a)) : dueOf(a).localeCompare(dueOf(b));
  }).slice(0, 5);

  return (
    <section className="page-view active-view" style={{ maxWidth: '1280px', margin: '0 auto' }}>
      {/* 4 Core Financial Metrics */}
      <div className="kpi-row">
        <div className="kpi-card">
          <div className="kpi-card-top">
            <span className="kpi-label">Total Paid</span>
            <span className="kpi-icon-pill emerald">✓</span>
          </div>
          <div className="kpi-amount">{loading ? <Skeleton w="8rem" h="1.65rem" /> : formatINR(dynamicTotalPaid)}</div>
          <div className="kpi-footer-note" style={{ color: 'var(--emerald-500)' }}>
            {loading ? <Skeleton w="7rem" h="0.75rem" /> : <span>{hasPayments ? `This month: ${formatINR(paidThisMonth)}` : '✓ Verified Settled Collections'}</span>}
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-card-top">
            <span className="kpi-label">Payable Now</span>
            <span className="kpi-icon-pill amber">📅</span>
          </div>
          <div className="kpi-amount" style={{ color: overdueList.length ? 'var(--danger-text)' : 'var(--warn-text)' }}>
            {loading ? <Skeleton w="8rem" h="1.65rem" /> : formatINR(dynamicPayableNow)}
          </div>
          <div className="kpi-footer-note" style={{ color: overdueList.length ? 'var(--danger-text)' : 'var(--warn-text)' }}>
            {loading ? <Skeleton w="9rem" h="0.75rem" /> : <span>
              {nextDue
                ? `${overdueList.length ? 'Overdue since' : '⚠️ Next due'} ${dueOf(nextDue)}`
                : upcomingAmount > 0 ? `✓ All clear · ${formatINR(upcomingAmount)} upcoming` : '✓ No dues right now'}
            </span>}
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-card-top">
            <span className="kpi-label">Total Dividend Savings</span>
            <span className="kpi-icon-pill cyan">⚡</span>
          </div>
          <div className="kpi-amount" style={{ color: 'var(--cyan-400)' }}>
            {loading ? <Skeleton w="6rem" h="1.65rem" /> : formatINR(dynamicDividendSavings)}
          </div>
          <div className="kpi-footer-note" style={{ color: 'var(--cyan-400)' }}>
            <span>Reduces upcoming payments</span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-card-top">
            <span className="kpi-label">Active Ticket Holdings</span>
            <span className="kpi-icon-pill purple">🎫</span>
          </div>
          <div className="kpi-amount">{loading ? <Skeleton w="6rem" h="1.65rem" /> : `${activeTicketsCount} Ticket${activeTicketsCount !== 1 ? 's' : ''}`}</div>
          <div className="kpi-footer-note" style={{ color: 'var(--purple-400)' }}>
            <span>Across your chit schemes</span>
          </div>
        </div>
      </div>

      {/* Recent Installments Quick Ledger */}
      <div className="ledger-card-wrapper" style={{ marginTop: "1.75rem" }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-main)' }}>Recent Monthly Installments</h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Recent payment status and dividend savings across your tickets</p>
          </div>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => onNavigate('ledger')}>
            View Full Ledger →
          </button>
        </div>

        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Month & Round</th>
                <th>Scheme / Ticket</th>
                <th>Base Installment</th>
                <th>Dividend Deduction</th>
                <th>Net Amount</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows rows={5} cols={7} />
              ) : recentPayments.length === 0 ? (
                <tr>
                  <td colSpan="7" style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-muted)' }}>
                    No payment records found.
                  </td>
                </tr>
              ) : (
                recentPayments.map(p => {
                  const s = (p.status || '').toUpperCase();
                  const isPaid = s === 'PAID';
                  return (
                    <tr key={p.id}>
                      <td>
                        <div style={{ fontWeight: 700, color: 'var(--text-main)' }}>{p.monthName || p.month_name}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Round #{p.monthNumber || p.month_number}</div>
                      </td>
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>{p.schemeName || p.scheme_name}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--cyan-400)' }}>{formatTicketId(p.ticketId || p.ticket_id, p.schemeName || p.scheme_name)}</div>
                      </td>
                      <td>{formatINR(p.baseAmount ?? p.base_amount)}</td>
                      <td style={{ color: 'var(--emerald-500)', fontWeight: 600 }}>
                        -{(p.dividendDiscount || p.dividend_discount) ? formatINR(p.dividendDiscount ?? p.dividend_discount) : '₹0'}
                      </td>
                      <td style={{ fontWeight: 700, color: isPaid ? 'var(--emerald-500)' : 'var(--text-main)', fontFamily: 'var(--font-heading)' }}>
                        {formatINR(p.netPayable ?? p.net_payable)}
                      </td>
                      <td>
                        <span className={`badge-pill ${s.toLowerCase()}`}>
                          {s === 'PAID' ? '✓ PAID' : s === 'OVERDUE' ? 'OVERDUE' : s === 'UPCOMING' ? '📅 UPCOMING' : '⚠️ DUE'}
                        </span>
                      </td>
                      <td>
                        {isPaid ? (
                          <button type="button" className="btn btn-outline btn-sm" onClick={() => onViewReceipt(p)}>
                            Receipt
                          </button>
                        ) : isAdmin ? (
                          <button
                            type="button"
                            className="btn btn-emerald btn-sm"
                            onClick={() => onReconcilePayment?.(p.id || p.payment_id)}
                            title="Reconcile offline cash/NEFT payment"
                          >
                            Reconcile
                          </button>
                        ) : (
                          <button type="button" className="btn btn-silver btn-sm" onClick={() => onOpenPaymentModal(p)}>
                            Pay Now
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}