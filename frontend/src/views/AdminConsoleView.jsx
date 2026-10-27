import React, { useState, useRef } from 'react';
import { formatINR } from '../data/initialData';
import { formatTicketId, buildChitList, formatChitName } from '../utils/format';
import PrizePayoutsPanel from './PrizePayoutsPanel';
import Skeleton, { SkeletonRows } from '../components/Skeleton';

const ADM_ICON_PATHS = {
  wallet: <><path d="M3 7a2 2 0 0 1 2-2h12v4" /><path d="M3 7v10a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2" /><circle cx="16.5" cy="13.5" r="1" /></>,
  alert: <><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5" /><circle cx="12" cy="16" r=".6" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  chart: <><path d="M4 19V5" /><path d="M4 19h16" /><path d="m7.5 14 3.5-4 3 2.5 4.5-5.5" /></>,
  ticket: <><path d="M4 8a2 2 0 0 0 0 4v0a2 2 0 0 1 0 4v1a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1a2 2 0 0 1 0-4v0a2 2 0 0 0 0-4V7a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1z" /><path d="M14 6v12" strokeDasharray="2 2.5" /></>,
  users: <><circle cx="9" cy="8.5" r="3.2" /><path d="M3 19c0-3.2 2.7-5.2 6-5.2s6 2 6 5.2" /><path d="M16 5.6a3.2 3.2 0 0 1 0 5.8" /><path d="M18 14.2c1.8.6 3 2.2 3 4.8" /></>,
};
function AdmIcon({ name }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ADM_ICON_PATHS[name]}
    </svg>
  );
}

export default function AdminConsoleView({
  loading = false,
  stats,
  payments = [],
  schemes = [],
  users = [],
  tickets = [],
  payouts = [],
  onRefreshData,
  onSelectScheme,
  onReconcilePayment,
  onSendReminder,
  onOpenCreateSchemeModal,
  onShowToast
}) {
  const [viewMode, setViewMode] = useState('payments'); // 'payments' | 'tickets' | 'users' | 'prizes'
  const tableRef = useRef(null);
  const remindedAgo = (iso) => {
    if (!iso) return '';
    const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (mins < 1) return 'Reminded just now';
    if (mins < 60) return `Reminded ${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `Reminded ${hrs}h ago`;
    const days = Math.round(hrs / 24);
    return `Reminded ${days}d ago`;
  };
  const showPayments = (status) => {
    setViewMode('payments');
    setFilterStatus(status);
    setFilterScheme('ALL');
    setSearch('');
    // wait for the filtered table to render, then bring it into view
    setTimeout(() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [filterScheme, setFilterScheme] = useState('ALL');
  const [search, setSearch] = useState('');
  const currentMonthKey = new Date().toLocaleDateString('en-CA').slice(0, 7);
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey);

  // Default chit schemes fallback
  const defaultChits = [
    { id: 'SCH-BRZ-1L', name: '1 Lakh Chit', totalValue: 100000, monthlyInstallment: 5000, durationMonths: 20, totalSlots: 20, bookedSlots: 17 },
    { id: 'SCH-GLD-5L', name: '5 Lakh Chit', totalValue: 500000, monthlyInstallment: 25000, durationMonths: 20, totalSlots: 20, bookedSlots: 16 },
    { id: 'SCH-SLV-02', name: '2 Lakh Chit', totalValue: 200000, monthlyInstallment: 10000, durationMonths: 20, totalSlots: 20, bookedSlots: 17 },
    { id: 'SCH-GLD-01', name: '3 Lakh Chit', totalValue: 300000, monthlyInstallment: 15000, durationMonths: 20, totalSlots: 20, bookedSlots: 16 },
    { id: 'SCH-DIA-01', name: '10 Lakh Chit', totalValue: 1000000, monthlyInstallment: 50000, durationMonths: 20, totalSlots: 20, bookedSlots: 14 }
  ];

  // Deduplicate chit schemes list so there is never duplicate 1 Lakh, 10 Lakh, etc.
  const rawChits = (schemes && schemes.length > 0) ? schemes : defaultChits;
  const chitList = buildChitList(rawChits);


  // Admin KPIs - always calculated from the full payment list (never from the table filter)
  const statusOf = (p) => (p.status || '').toUpperCase();
  const amountOf = (p) => Number(p.netPayable ?? p.net_payable ?? 0);
  const dueDateOf = (p) => String(p.dueDate || p.due_date || '').slice(0, 10);
  const monthKey = new Date().toLocaleDateString('en-CA').slice(0, 7);

  const hasPayments = payments.length > 0;
  const paidPayments = payments.filter(p => statusOf(p) === 'PAID');
  const overduePayments = payments.filter(p => statusOf(p) === 'OVERDUE');
  const duePayments = payments.filter(p => statusOf(p) === 'DUE');
  const sum = (list) => list.reduce((t, p) => t + amountOf(p), 0);

  const backendStats = stats?.admin_stats || {};
  const totalCollected = hasPayments ? sum(paidPayments) : Number(backendStats.total_monthly_paid_collected || 0);
  const overdueAmount = hasPayments ? sum(overduePayments) : 0;
  const dueThisMonthAmount = hasPayments ? sum(duePayments) : Number(backendStats.pending_dues || 0);
  const overdueMembers = new Set(overduePayments.map(p => p.userId || p.user_id || p.userName)).size;

  // Collection for the selected month: installments whose due date falls in that month
  const shiftMonth = (key, delta) => {
    const [y, m] = key.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  const lastMonthKey = shiftMonth(currentMonthKey, -1);
  const monthLabel = (key) => {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  };
  const monthPayments = payments.filter(p => dueDateOf(p).slice(0, 7) === selectedMonth);
  const monthPaidList = monthPayments.filter(p => statusOf(p) === 'PAID');
  const monthPendingList = monthPayments.filter(p => statusOf(p) !== 'PAID');
  const monthExpected = sum(monthPayments);
  const monthCollected = sum(monthPaidList);
  const monthPending = sum(monthPendingList);
  const monthPercent = monthExpected > 0 ? Math.round((monthCollected / monthExpected) * 100) : 0;

  const adminStats = {
    active_subscribers: backendStats.active_subscribers ?? users.length ?? 0,
    active_tickets_total: backendStats.active_tickets_total ?? tickets.length ?? 0
  };

  // Members with overdue dues (for follow-up)
  const overdueByMember = Object.values(overduePayments.reduce((acc, p) => {
    const key = p.userId || p.user_id || p.userName;
    if (!acc[key]) acc[key] = { id: p.userId || p.user_id, name: p.userName || p.user_name || 'Member', amount: 0, count: 0, oldest: dueDateOf(p), firstPaymentId: p.id, reminderAt: null };
    acc[key].amount += amountOf(p);
    acc[key].count += 1;
    if (p.reminderSentAt && (!acc[key].reminderAt || p.reminderSentAt > acc[key].reminderAt)) acc[key].reminderAt = p.reminderSentAt;
    if (dueDateOf(p) < acc[key].oldest) { acc[key].oldest = dueDateOf(p); acc[key].firstPaymentId = p.id; }
    return acc;
  }, {})).sort((a, b) => a.oldest.localeCompare(b.oldest));

  // Filter payments
  const filteredPayments = payments.filter(p => {
    const s = (p.status || '').toUpperCase();
    let matchesStatus = false;
    if (filterStatus === 'ALL') {
      matchesStatus = true;
    } else if (filterStatus === 'DUE') {
      matchesStatus = s === 'DUE' || s === 'OVERDUE';
    } else if (filterStatus === 'OVERDUE') {
      matchesStatus = s === 'OVERDUE';
    } else if (filterStatus === 'CURRENT_DUE') {
      matchesStatus = s === 'DUE';
    } else if (filterStatus === 'UPCOMING') {
      matchesStatus = s === 'UPCOMING';
    } else if (filterStatus === 'PAID') {
      matchesStatus = s === 'PAID';
    } else {
      matchesStatus = s === filterStatus.toUpperCase();
    }

    const matchesScheme = filterScheme === 'ALL' ||
      p.schemeId === filterScheme ||
      p.scheme_id === filterScheme;

    const q = search.toLowerCase();
    const matchesSearch = !search ||
      p.userName?.toLowerCase().includes(q) ||
      p.ticketId?.toLowerCase().includes(q) ||
      p.schemeName?.toLowerCase().includes(q);

    return matchesStatus && matchesScheme && matchesSearch;
  });

  // Filter tickets
  const filteredTickets = tickets.filter(t => {
    const q = search.toLowerCase();
    const matchesSearch = !search ||
      t.userName?.toLowerCase().includes(q) ||
      t.id?.toLowerCase().includes(q) ||
      formatTicketId(t.id, t.schemeName).toLowerCase().includes(q) ||
      t.schemeName?.toLowerCase().includes(q);
    const matchesScheme = filterScheme === 'ALL' ||
      t.schemeId === filterScheme ||
      t.scheme_id === filterScheme;
    return matchesSearch && matchesScheme;
  });

  // Filter managed users (members)
  const regularUsers = users.filter(u => u.role !== 'admin');
  const filteredUsers = regularUsers.filter(u => {
    const q = search.toLowerCase();
    return !search ||
      u.name?.toLowerCase().includes(q) ||
      u.phone?.toLowerCase().includes(q) ||
      u.email?.toLowerCase().includes(q) ||
      u.city?.toLowerCase().includes(q);
  });

  const handleExportCSV = () => {
    let csv = "Record ID,User Name,Ticket ID,Scheme,Month,Base Due,Dividend Discount,Net Receivable,Status,Due Date,Paid Date\n";
    filteredPayments.forEach(p => {
      csv += `"${p.id}","${p.userName || ''}","${p.ticketId || ''}","${p.schemeName || ''}","${p.monthName || ''}",${p.baseAmount || 0},${p.dividendDiscount || 0},${p.netPayable || 0},"${p.status || ''}","${p.dueDate || ''}","${p.paidDate || ''}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Admin_Collections_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    onShowToast?.('Collections records exported as CSV successfully!', 'success');
  };

  return (
    <section className="page-view active-view" style={{ maxWidth: '1280px', margin: '0 auto' }}>
      {/* Admin Header */}
      <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--text-main)', marginBottom: '0.2rem' }}>
            Admin Dashboard
          </h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Chit fund organizer console • Manage enrolled members, user tickets, monthly collections, and dues reconciliation.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="button" className="btn btn-outline btn-sm" onClick={handleExportCSV}>
            📥 Export CSV
          </button>
          <button type="button" className="btn btn-silver btn-sm" onClick={onOpenCreateSchemeModal}>
            + Launch New Scheme
          </button>
        </div>
      </div>

      {/* Admin KPI Cards */}
      <div className="adm-kpi-grid">
        <div className="adm-kpi adm-span-4">
          <div className="adm-kpi-head">
            <span className="adm-kpi-label">Total collected</span>
            <span className="adm-kpi-icon ok"><AdmIcon name="wallet" /></span>
          </div>
          <div className="adm-kpi-value">{loading ? <Skeleton w="8rem" h="1.8rem" /> : formatINR(totalCollected)}</div>
          <div className="adm-kpi-foot ok"><span className="adm-dot"></span>Collected &amp; reconciled</div>
        </div>

        <button
          type="button"
          className={`adm-kpi adm-kpi-link adm-span-4 ${viewMode === 'payments' && filterStatus === 'OVERDUE' ? 'is-active' : ''}`}
          onClick={() => showPayments('OVERDUE')}
          title="Show overdue payments"
        >
          <div className="adm-kpi-head">
            <span className="adm-kpi-label">Overdue</span>
            <span className="adm-kpi-icon danger"><AdmIcon name="alert" /></span>
          </div>
          <div className={`adm-kpi-value ${!loading && overdueAmount > 0 ? 'danger' : ''}`}>{loading ? <Skeleton w="8rem" h="1.8rem" /> : formatINR(overdueAmount)}</div>
          <div className={`adm-kpi-foot ${overdueAmount > 0 ? 'danger' : 'ok'}`}>
            <span className="adm-dot"></span>
            {loading ? <Skeleton w="8rem" h="0.75rem" /> : overduePayments.length > 0
              ? `${overduePayments.length} payment${overduePayments.length > 1 ? 's' : ''} from ${overdueMembers} member${overdueMembers > 1 ? 's' : ''}`
              : 'Nothing overdue'}
            {overduePayments.length > 0 && <span className="adm-kpi-cta">{viewMode === 'payments' && filterStatus === 'OVERDUE' ? 'Showing' : 'View'}</span>}
          </div>
        </button>

        <button
          type="button"
          className={`adm-kpi adm-kpi-link adm-span-4 ${viewMode === 'payments' && filterStatus === 'CURRENT_DUE' ? 'is-active' : ''}`}
          onClick={() => showPayments('CURRENT_DUE')}
          title="Show payments due this month"
        >
          <div className="adm-kpi-head">
            <span className="adm-kpi-label">Due this month</span>
            <span className="adm-kpi-icon warn"><AdmIcon name="clock" /></span>
          </div>
          <div className="adm-kpi-value">{loading ? <Skeleton w="8rem" h="1.8rem" /> : formatINR(dueThisMonthAmount)}</div>
          <div className="adm-kpi-foot warn">
            <span className="adm-dot"></span>
            {loading ? <Skeleton w="7rem" h="0.75rem" /> : `${duePayments.length} payment${duePayments.length !== 1 ? 's' : ''} awaiting`}
            {duePayments.length > 0 && <span className="adm-kpi-cta">{viewMode === 'payments' && filterStatus === 'CURRENT_DUE' ? 'Showing' : 'View'}</span>}
          </div>
        </button>

        <div className="adm-kpi adm-span-6">
          <div className="adm-kpi-head">
            <span className="adm-kpi-label">{selectedMonth === currentMonthKey ? "This month's collection" : 'Monthly collection'}</span>
            <span className="adm-kpi-icon accent"><AdmIcon name="chart" /></span>
          </div>
          <div className="adm-month-controls">
            <input
              type="month"
              className="select-filter month-input"
              value={selectedMonth}
              max={shiftMonth(currentMonthKey, 12)}
              onChange={(e) => e.target.value && setSelectedMonth(e.target.value)}
              aria-label="Select month"
            />
            <div className="adm-seg" role="group" aria-label="Quick month">
              <button type="button" className={selectedMonth === currentMonthKey ? 'active' : ''} onClick={() => setSelectedMonth(currentMonthKey)}>This month</button>
              <button type="button" className={selectedMonth === lastMonthKey ? 'active' : ''} onClick={() => setSelectedMonth(lastMonthKey)}>Last month</button>
            </div>
          </div>
          {loading ? (
            <div style={{ display: 'grid', gap: '0.75rem', marginTop: '0.5rem' }}>
              <Skeleton w="5rem" h="2rem" />
              <Skeleton w="100%" h="0.6rem" />
              <Skeleton w="60%" h="0.9rem" />
            </div>
          ) : monthPayments.length === 0 ? (
            <div className="adm-empty">No installments fall due in {monthLabel(selectedMonth)}.</div>
          ) : (
            <div className="adm-month-body">
              <div className="adm-month-main">
                <div className="adm-kpi-value">{monthPercent}%</div>
                <div className="adm-kpi-sub">{monthLabel(selectedMonth)} · {monthPaidList.length} of {monthPayments.length} paid</div>
              </div>
              <div className="adm-month-side">
                <div className="adm-progress" role="progressbar" aria-valuenow={monthPercent} aria-valuemin="0" aria-valuemax="100">
                  <div className="adm-progress-fill" style={{ width: `${monthPercent}%` }}></div>
                </div>
                <div className="adm-month-stats">
                  <div>
                    <span className="adm-stat-label"><span className="adm-dot ok"></span>Collected</span>
                    <span className="adm-stat-value">{formatINR(monthCollected)}</span>
                  </div>
                  <div>
                    <span className="adm-stat-label"><span className={`adm-dot ${monthPending > 0 ? 'warn' : 'muted'}`}></span>Pending</span>
                    <span className="adm-stat-value">{formatINR(monthPending)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="adm-kpi adm-span-3">
          <div className="adm-kpi-head">
            <span className="adm-kpi-label">Active user tickets</span>
            <span className="adm-kpi-icon purple"><AdmIcon name="ticket" /></span>
          </div>
          <div className="adm-kpi-value">{loading ? <Skeleton w="3.5rem" h="1.8rem" /> : (tickets.length || adminStats.active_tickets_total)}</div>
          <div className="adm-kpi-sub">Enrolled across all chit schemes</div>
        </div>

        <div className="adm-kpi adm-span-3">
          <div className="adm-kpi-head">
            <span className="adm-kpi-label">Managed members</span>
            <span className="adm-kpi-icon purple"><AdmIcon name="users" /></span>
          </div>
          <div className="adm-kpi-value">{loading ? <Skeleton w="3.5rem" h="1.8rem" /> : (regularUsers.length || adminStats.active_subscribers)}</div>
          <div className="adm-kpi-sub">Registered subscribers</div>
        </div>
      </div>

      {/* Members with overdue dues */}
      {overdueByMember.length > 0 && (
        <div className="ledger-card-wrapper" style={{ marginBottom: '1.25rem', padding: '1.1rem 1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-main)' }}>Members with overdue dues ({overdueByMember.length})</h3>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Oldest first · follow up by phone or send a reminder</span>
          </div>
          <div className="overdue-member-list">
            {overdueByMember.slice(0, 5).map(m => {
              const member = users.find(u => u.id === m.id);
              return (
                <div key={m.id || m.name} className="overdue-member-row">
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: 'var(--text-main)' }}>{m.name}</div>
                    <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                      {m.count} overdue · since {m.oldest}{m.reminderAt ? ` · ${remindedAgo(m.reminderAt)}` : ''}
                    </div>
                  </div>
                  <div style={{ fontWeight: 800, color: 'var(--danger-text)', fontFamily: 'var(--font-heading)' }}>{formatINR(m.amount)}</div>
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    {member?.phone && (
                      <a className="btn btn-outline btn-sm" href={`tel:${String(member.phone).replace(/[^\d+]/g, '')}`}>📞 Call</a>
                    )}
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => onSendReminder?.(m.firstPaymentId, 'member')} title="Send an in-app reminder for all of this member's pending payments">
                      {m.reminderAt ? 'Remind again' : 'Reminder'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {overdueByMember.length > 5 && (
            <button
              type="button"
              className="notif-link"
              style={{ marginTop: '0.6rem' }}
              onClick={() => showPayments('OVERDUE')}
            >
              View all {overdueByMember.length} members →
            </button>
          )}
        </div>
      )}

      {/* Main Admin Management Table Card */}
      <div ref={tableRef} className="ledger-card-wrapper" style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', marginTop: '1.25rem', padding: '1.25rem', scrollMarginTop: '1rem' }}>
        {/* 3 Management Mode Tabs */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.25rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`btn btn-sm ${viewMode === 'payments' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setViewMode('payments')}
            >
              💳 Collections & Reconcile ({filteredPayments.length})
            </button>
            <button
              type="button"
              className={`btn btn-sm ${viewMode === 'tickets' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setViewMode('tickets')}
            >
              🎫 User Tickets ({filteredTickets.length})
            </button>
            <button
              type="button"
              className={`btn btn-sm ${viewMode === 'users' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setViewMode('users')}
            >
              👥 Manage Users ({filteredUsers.length})
            </button>
            <button
              type="button"
              className={`btn btn-sm ${viewMode === 'prizes' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setViewMode('prizes')}
            >
              🏆 Winners & Payouts ({payouts.filter(x => x.status === 'PENDING').length} pending)
            </button>
          </div>

          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            {viewMode === 'payments'
              ? `Showing ${filteredPayments.length} collection records`
              : viewMode === 'tickets'
              ? `Showing ${filteredTickets.length} user tickets`
              : viewMode === 'prizes'
              ? `${payouts.length} declared winner${payouts.length === 1 ? '' : 's'}`
              : `Managing ${filteredUsers.length} subscribers`}
          </div>
        </div>

        {/* Search & Filter Toolbar */}
        {viewMode !== 'prizes' && <div className="ledger-toolbar" style={{ marginBottom: '1.25rem' }}>
          <div className="search-field-box" style={{ flex: '1 1 260px' }}>
            <span className="search-field-icon">🔍</span>
            <input
              type="text"
              className="search-field-input"
              placeholder={
                viewMode === 'users'
                  ? 'Search user name, mobile phone, email, city...'
                  : 'Search user name, ticket ID, chit scheme...'
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="toolbar-filter-group">
            {viewMode === 'payments' && (
              <select
                className="select-filter"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
              >
                <option value="ALL">All Payment Statuses</option>
                <option value="PAID">✓ Paid Only</option>
                <option value="DUE">⚠️ All Dues (Due & Overdue)</option>
                <option value="OVERDUE">Overdue Only</option>
                <option value="CURRENT_DUE">⚠️ Current Due Only</option>
                <option value="UPCOMING">📅 Upcoming Due Only</option>
              </select>
            )}

            {viewMode !== 'users' && (
              <select
                className="select-filter"
                value={filterScheme}
                onChange={(e) => setFilterScheme(e.target.value)}
              >
                <option value="ALL">All Chit Schemes</option>
                {chitList.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({formatINR(s.totalValue)})
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>}

        {viewMode === 'prizes' && (
          <PrizePayoutsPanel schemes={chitList} tickets={tickets} payouts={payouts} onRefresh={onRefreshData} onShowToast={onShowToast} />
        )}

        {/* View Mode 1: Monthly Paid Collections & Reconcile */}
        {viewMode === 'payments' && (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>User Name</th>
                  <th>User Ticket & Scheme</th>
                  <th>Monthly Paid Progress</th>
                  <th>Net Due</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <SkeletonRows rows={6} cols={6} />
                ) : filteredPayments.length === 0 ? (
                  <tr>
                    <td colSpan="6" style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                      No collection records found matching filter.
                    </td>
                  </tr>
                ) : (
                  filteredPayments.map(p => {
                    const s = (p.status || '').toUpperCase();
                    const isPaid = s === 'PAID';
                    const ticket = tickets.find(t => t.id === p.ticketId);
                    const scheme = chitList.find(sc => sc.id === (p.schemeId || p.scheme_id));
                    const duration = scheme?.durationMonths || scheme?.duration_months || 20;
                    const monthsPaid = Number(ticket?.totalMonthsPaid ?? ticket?.total_months_paid ?? 0);
                    const pct = Math.min(100, Math.round((monthsPaid / duration) * 100));

                    return (
                      <tr key={p.id}>
                        {/* 1. User Name */}
                        <td>
                          <div style={{ fontWeight: 700, color: 'var(--text-main)' }}>
                            {p.userName || 'Member'}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {ticket?.userPhone || ''}
                          </div>
                        </td>

                        {/* 2. User Ticket & Scheme */}
                        <td>
                          <div style={{ fontWeight: 700, color: 'var(--cyan-500)', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
                            {formatTicketId(p.ticketId, p.schemeName)}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            {p.schemeName}
                          </div>
                        </td>

                        {/* 3. Monthly Paid How (Progress & Round) */}
                        <td style={{ minWidth: '170px' }}>
                          <div style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '0.82rem', marginBottom: '0.2rem' }}>
                            {p.monthName || `Round #${p.monthNumber}`}
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>
                            <span>{monthsPaid} of {duration} Months Paid</span>
                            <span style={{ fontWeight: 600, color: 'var(--emerald-500)' }}>{pct}%</span>
                          </div>
                          <div style={{ width: '100%', height: '5px', background: 'var(--border-subtle)', borderRadius: '9999px', overflow: 'hidden' }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--emerald-400)', borderRadius: '9999px' }} />
                          </div>
                        </td>

                        {/* 4. Net Due */}
                        <td>
                          <div style={{ fontWeight: 800, color: isPaid ? 'var(--emerald-500)' : 'var(--text-main)', fontSize: '0.95rem' }}>
                            {isPaid ? '₹0 Due' : formatINR(p.netPayable)}
                          </div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                            {isPaid ? (p.paidDate ? `Paid on ${p.paidDate}` : 'Settled') : `Due: ${p.dueDate}`}
                          </div>
                        </td>

                        {/* 5. Status */}
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

                        {/* 6. Action */}
                        <td>
                          {isPaid ? (
                            <span style={{ fontSize: '0.8rem', color: 'var(--emerald-500)', fontWeight: 600 }}>
                              ✓ Settled
                            </span>
                          ) : (
                            <div style={{ display: 'flex', gap: '0.35rem' }}>
                              <button
                                type="button"
                                className="btn btn-emerald btn-sm"
                                onClick={() => onReconcilePayment?.(p.id)}
                                title="Reconcile offline payment as Paid"
                              >
                                Reconcile
                              </button>
                              <button
                                type="button"
                                className="btn btn-outline btn-sm"
                                onClick={() => onSendReminder?.(p.id)}
                                title={p.reminderSentAt ? remindedAgo(p.reminderSentAt) : 'Send in-app payment reminder'}
                              >
                                {p.reminderSentAt ? 'Remind again' : 'Reminder'}
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* View Mode 2: User Tickets */}
        {viewMode === 'tickets' && (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>User Name</th>
                  <th>User Ticket ID</th>
                  <th>Chit Scheme & Value</th>
                  <th>Monthly Paid Progress</th>
                  <th>Total Amount Paid</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <SkeletonRows rows={6} cols={7} />
                ) : filteredTickets.length === 0 ? (
                  <tr>
                    <td colSpan="7" style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                      No user tickets found matching filter.
                    </td>
                  </tr>
                ) : (
                  filteredTickets.map(t => {
                    const scheme = chitList.find(s => s.id === (t.schemeId || t.scheme_id));
                    const duration = scheme?.durationMonths || scheme?.duration_months || t.durationMonths || 20;
                    const monthsPaid = Number(t.totalMonthsPaid ?? t.total_months_paid ?? 0);
                    const pct = Math.min(100, Math.round((monthsPaid / duration) * 100));
                    const monthlyInst = scheme?.monthlyInstallment || (scheme?.totalValue && duration ? Math.round(scheme.totalValue / duration) : 0);
                    const estimatedTotalPaid = monthsPaid * monthlyInst;

                    return (
                      <tr key={t.id}>
                        {/* 1. User Name */}
                        <td>
                          <div style={{ fontWeight: 700, color: 'var(--text-main)' }}>
                            {t.userName || 'Member'}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {t.userPhone || ''}
                          </div>
                        </td>

                        {/* 2. User Ticket */}
                        <td>
                          <div style={{ fontWeight: 700, color: 'var(--cyan-500)', fontFamily: 'var(--font-mono)' }}>
                            {formatTicketId(t.id, t.schemeName)}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            Slot #{(() => {
                              const n = Number(t.slotNumber ?? t.slot_number ?? t.ticketNumber ?? t.ticket_number ?? 0);
                              if (n > 0) return n;
                              const m = String(t.id || '').match(/-(\d+)$/);
                              return m ? parseInt(m[1], 10) : 1;
                            })()}
                          </div>
                        </td>

                        {/* 3. Chit Scheme */}
                        <td>
                          <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                            {t.schemeName || scheme?.name}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--cyan-500)', fontWeight: 700 }}>
                            {formatINR(scheme?.totalValue || t.totalValue || 100000)} Chit
                          </div>
                        </td>

                        {/* 4. Monthly Paid How */}
                        <td style={{ minWidth: '180px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                            <span>{monthsPaid} of {duration} Months Paid</span>
                            <span style={{ color: 'var(--cyan-500)' }}>{pct}%</span>
                          </div>
                          <div style={{ width: '100%', height: '6px', background: 'var(--border-subtle)', borderRadius: '9999px', overflow: 'hidden' }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--emerald-400)', borderRadius: '9999px' }} />
                          </div>
                        </td>

                        {/* 5. Total Paid */}
                        <td>
                          <div style={{ fontWeight: 700, color: 'var(--emerald-500)', fontSize: '0.95rem' }}>
                            {formatINR(estimatedTotalPaid)}
                          </div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                            {formatINR(monthlyInst)} / month
                          </div>
                        </td>

                        {/* 6. Status */}
                        <td>
                          <span className="badge-pill paid">
                            ✓ ACTIVE
                          </span>
                        </td>

                        {/* 7. Action */}
                        <td>
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            onClick={() => {
                              setSearch(t.id);
                              setViewMode('payments');
                            }}
                            title="Filter payments for this ticket"
                          >
                            View Installments
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* View Mode 3: Manage Users Directory */}
        {viewMode === 'users' && (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Member Name</th>
                  <th>Mobile Phone & Email</th>
                  <th>City / Location</th>
                  <th>KYC Status</th>
                  <th>Enrolled Tickets</th>
                  <th>Total Monthly Paid</th>
                  <th>Standing</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <SkeletonRows rows={6} cols={8} />
                ) : filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan="8" style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                      No registered members found matching search.
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map(u => {
                    const userTicketsList = tickets.filter(t => (t.userId === u.id || t.user_id === u.id));
                    const userPaymentsList = payments.filter(p => (p.userId === u.id || p.user_id === u.id));
                    const totalPaidByUser = userPaymentsList
                      .filter(p => (p.status || '').toUpperCase() === 'PAID')
                      .reduce((sum, p) => sum + Number(p.netPayable ?? p.net_payable ?? 0), 0);
                    const hasDues = userPaymentsList.some(p => {
                      const s = (p.status || '').toUpperCase();
                      return s === 'DUE' || s === 'OVERDUE';
                    });

                    return (
                      <tr key={u.id}>
                        {/* 1. Name */}
                        <td>
                          <div style={{ fontWeight: 700, color: 'var(--text-main)' }}>
                            {u.name}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            Member ID: {u.id}
                          </div>
                        </td>

                        {/* 2. Phone & Email */}
                        <td>
                          <div style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '0.85rem' }}>
                            {u.phone || 'N/A'}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            {u.email || ''}
                          </div>
                        </td>

                        {/* 3. City */}
                        <td>
                          <div style={{ fontSize: '0.85rem', color: 'var(--text-main)' }}>
                            {u.city || <span style={{ color: 'var(--text-muted)' }}>Not provided</span>}
                          </div>
                        </td>

                        {/* 4. KYC Status */}
                        <td>
                          {String(u.kycStatus || u.kyc_status || '').toLowerCase() === 'verified' ? (
                            <span className="badge-pill paid" style={{ fontSize: '0.72rem' }}>✓ Verified</span>
                          ) : (
                            <span className="badge-pill due" style={{ fontSize: '0.72rem' }}>⏳ {u.kycStatus || u.kyc_status || 'Pending'}</span>
                          )}
                        </td>

                        {/* 5. Enrolled Tickets */}
                        <td>
                          <div style={{ fontWeight: 700, color: 'var(--cyan-500)', fontSize: '0.9rem' }}>
                            {userTicketsList.length} Ticket{userTicketsList.length !== 1 ? 's' : ''}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            {userTicketsList.map(t => formatTicketId(t.id, t.schemeName)).join(', ') || 'No active tickets'}
                          </div>
                        </td>

                        {/* 6. Total Amount Paid */}
                        <td>
                          <div style={{ fontWeight: 700, color: 'var(--emerald-500)', fontSize: '0.95rem' }}>
                            {formatINR(totalPaidByUser)}
                          </div>
                        </td>

                        {/* 7. Standing */}
                        <td>
                          <span className={`badge-pill ${hasDues ? 'due' : 'paid'}`}>
                            {hasDues ? '⚠️ HAS DUES' : '✓ ALL CLEARED'}
                          </span>
                        </td>

                        {/* 8. Action */}
                        <td>
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            onClick={() => {
                              setSearch(u.name);
                              setViewMode('tickets');
                            }}
                            title="Filter tickets for this member"
                          >
                            View Tickets
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}