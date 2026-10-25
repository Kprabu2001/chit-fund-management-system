import React, { useState } from 'react';
import { formatINR } from '../data/initialData';
import { formatTicketId } from '../utils/format';

export default function MonthlyPaidLedgerView({
  payments,
  currentUser,
  onOpenPaymentModal,
  onViewReceipt,
  onReconcilePayment
}) {
  const isAdmin = currentUser?.role === 'admin';
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const filtered = payments.filter(p => {
    const s = (p.status || '').toUpperCase();
    let matchesStatus = false;
    if (statusFilter === 'ALL') {
      matchesStatus = true;
    } else if (statusFilter === 'DUE') {
      matchesStatus = s === 'DUE' || s === 'OVERDUE';
    } else if (statusFilter === 'OVERDUE') {
      matchesStatus = s === 'OVERDUE';
    } else if (statusFilter === 'CURRENT_DUE') {
      matchesStatus = s === 'DUE';
    } else if (statusFilter === 'UPCOMING') {
      matchesStatus = s === 'UPCOMING';
    } else if (statusFilter === 'ALL_DUES') {
      matchesStatus = s === 'DUE' || s === 'OVERDUE' || s === 'UPCOMING';
    } else {
      matchesStatus = s === statusFilter.toUpperCase();
    }

    const q = search.toLowerCase();
    const matchesSearch = !search ||
      p.schemeName?.toLowerCase().includes(q) ||
      p.monthName?.toLowerCase().includes(q) ||
      p.ticketId?.toLowerCase().includes(q) ||
      p.userName?.toLowerCase().includes(q);
    return matchesStatus && matchesSearch;
  }).sort((a, b) => {
    // Keep unpaid items together: OVERDUE first, then DUE, UPCOMING, and PAID last,
    // so paid rows never appear in between overdue rows.
    const order = { OVERDUE: 0, DUE: 1, UPCOMING: 2, PAID: 3 };
    const sa = order[(a.status || '').toUpperCase()] ?? 4;
    const sb = order[(b.status || '').toUpperCase()] ?? 4;
    if (sa !== sb) return sa - sb;
    const da = String(a.dueDate || '');
    const db = String(b.dueDate || '');
    // Paid: most recent first. Unpaid: oldest due date first.
    return sa === 3 ? db.localeCompare(da) : da.localeCompare(db);
  });

  const totalPaidInView = filtered
    .filter(p => (p.status || '').toUpperCase() === 'PAID')
    .reduce((sum, p) => sum + Number(p.netPayable ?? p.net_payable ?? 0), 0);

  const totalDueInView = filtered
    .filter(p => {
      const s = (p.status || '').toUpperCase();
      return s === 'DUE' || s === 'OVERDUE';
    })
    .reduce((sum, p) => sum + Number(p.netPayable ?? p.net_payable ?? 0), 0);

  const totalUpcomingInView = filtered
    .filter(p => (p.status || '').toUpperCase() === 'UPCOMING')
    .reduce((sum, p) => sum + Number(p.netPayable ?? p.net_payable ?? 0), 0);

  return (
    <section className="page-view active-view">
      <div style={{ marginBottom: '1.75rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-main)' }}>
          Monthly Paid Installment Ledger
        </h2>
        <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
          Track every rupee paid, monitor auction dividend reductions, and clear upcoming monthly dues.
        </p>
      </div>

      {/* Mini Stats Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ background: 'var(--bg-card)', padding: '1rem 1.25rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Total Paid in Filter</div>
          <div style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--emerald-400)', fontFamily: 'var(--font-heading)' }}>
            {formatINR(totalPaidInView)}
          </div>
        </div>
        <div style={{ background: 'var(--bg-card)', padding: '1rem 1.25rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Current & Overdue Dues</div>
          <div style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--amber-400)', fontFamily: 'var(--font-heading)' }}>
            {formatINR(totalDueInView)}
          </div>
        </div>
        <div style={{ background: 'var(--bg-card)', padding: '1rem 1.25rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Upcoming Dues in Filter</div>
          <div style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--cyan-400)', fontFamily: 'var(--font-heading)' }}>
            {formatINR(totalUpcomingInView)}
          </div>
        </div>
      </div>

      {/* Ledger Table Container */}
      <div className="ledger-card-wrapper">
        <div className="ledger-toolbar">
          <div className="search-field-box">
            <span className="search-field-icon">🔍</span>
            <input
              type="text"
              className="search-field-input"
              placeholder="Search scheme, month, or ticket ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="toolbar-filter-group">
            <select
              className="select-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="ALL">All Payment Statuses</option>
              <option value="PAID">✓ Paid Only</option>
              <option value="DUE">⚠️ All Dues (Due & Overdue)</option>
              <option value="OVERDUE">Overdue Only</option>
              <option value="CURRENT_DUE">⚠️ Current Due Only</option>
              <option value="UPCOMING">📅 Upcoming Due Only</option>
              <option value="ALL_DUES">⏳ All Pending & Upcoming Dues</option>
            </select>

            <span className="badge-pill paid">
              {filtered.length} Records
            </span>
          </div>
        </div>

        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Month & Round</th>
                <th>Scheme & Ticket ID</th>
                <th>Base Due</th>
                <th>Dividend Shared</th>
                <th>Net Payable</th>
                <th>Due Date</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan="8" style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                    No payment records match your search or filter.
                  </td>
                </tr>
              ) : (
                filtered.map(p => {
                  const s = (p.status || '').toUpperCase();
                  const isPaid = s === 'PAID';
                  const isOverdue = s === 'OVERDUE';

                  return (
                    <tr key={p.id} style={isOverdue ? { background: 'var(--danger-tint)', boxShadow: 'inset 3px 0 0 var(--danger-text)' } : undefined}>
                      <td>
                        <div style={{ fontWeight: 700, color: 'var(--text-main)' }}>{p.monthName}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          Round #{p.monthNumber}
                        </div>
                      </td>
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>{p.schemeName}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--cyan-400)' }}>{formatTicketId(p.ticketId, p.schemeName)}</div>
                      </td>
                      <td>{formatINR(p.baseAmount)}</td>
                      <td style={{ color: 'var(--emerald-400)', fontWeight: 600 }}>
                        {p.dividendDiscount > 0 ? `-${formatINR(p.dividendDiscount)}` : '₹0'}
                      </td>
                      <td style={{
                        fontWeight: 700,
                        color: isPaid ? 'var(--emerald-400)' : isOverdue ? 'var(--danger-text)' : 'var(--text-main)',
                        fontFamily: 'var(--font-heading)',
                        fontSize: '1.05rem'
                      }}>
                        {formatINR(p.netPayable)}
                      </td>
                      <td>
                        <div style={{ fontSize: '0.85rem', color: isOverdue ? 'var(--danger-text)' : undefined, fontWeight: isOverdue ? 700 : undefined }}>{p.dueDate}</div>
                        {isPaid && p.paidDate && (
                          <div style={{ fontSize: '0.7rem', color: 'var(--emerald-400)' }}>
                            Paid on {p.paidDate}
                          </div>
                        )}
                      </td>
                      <td>
                        <span className={`badge-pill ${s.toLowerCase()}`}>
                          {s === 'PAID'
                            ? '✓ PAID'
                            : s === 'OVERDUE'
                            ? 'OVERDUE'
                            : s === 'UPCOMING'
                            ? '📅 UPCOMING'
                            : '⚠️ DUE'}
                        </span>
                      </td>
                      <td>
                        {isPaid ? (
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() => onViewReceipt(p)}
                          >
                            📄 Receipt
                          </button>
                        ) : isAdmin ? (
                          <button
                            className="btn btn-emerald btn-sm"
                            onClick={() => onReconcilePayment?.(p.id)}
                            title="Reconcile offline cash/NEFT payment"
                          >
                            Reconcile
                          </button>
                        ) : (
                          <button
                            className="btn btn-silver btn-sm"
                            onClick={() => onOpenPaymentModal(p)}
                          >
                            💳 Pay Now
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