import React, { useState } from 'react';
import { formatINR } from '../data/initialData';
import { formatTicketId, buildChitList, formatChitName } from '../utils/format';

export default function PoolsView({
  tiers = [],
  schemes = [],
  activeSchemeId = null,
  currentUser,
  tickets = [],
  payments = [],
  onSelectScheme,
  onOpenBookingModal,
  onOpenPaymentModal,
  onViewReceipt,
  onReconcilePayment,
  onSendReminder,
  onDeleteScheme,
  onOpenSchemeDetails
}) {
  const isAdmin = currentUser?.role === 'admin';
  const [adminMemberFilter, setAdminMemberFilter] = useState('ALL'); // 'ALL' | 'PAID' | 'DUE'
  const [adminSearch, setAdminSearch] = useState('');

  // Chit schemes fallback
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


  // Determine which scheme is currently selected
  const selectedScheme = chitList.find(s => s.id === activeSchemeId) || chitList[0];
  const schemeId = selectedScheme?.id;

  // Other chits of the same amount (1 Lakh Chit, 1 Lakh Chit (1) ...) are shown inside this page
  const sameAmountChits = selectedScheme
    ? chitList.filter(x => Math.round(Number(x.totalValue || x.total_value || 0)) === Math.round(Number(selectedScheme.totalValue || selectedScheme.total_value || 0)))
    : [];
  const chitSwitcher = sameAmountChits.length > 1 ? (
    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
      <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
        {sameAmountChits.length} chits of this amount:
      </span>
      {sameAmountChits.map(c => {
        const active = c.id === schemeId;
        return (
          <button
            key={c.id}
            type="button"
            className={`btn btn-sm ${active ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => onSelectScheme?.(c.id)}
          >
            {formatChitName(c)} • {c.bookedSlots ?? c.booked_slots ?? 0}/{c.totalSlots || c.total_slots || 20}
          </button>
        );
      })}
    </div>
  ) : null;

  // Scheme duration & base installment
  const duration = selectedScheme?.durationMonths || selectedScheme?.duration_months || 20;
  const totalSlots = selectedScheme?.totalSlots || selectedScheme?.total_slots || 20;
  const monthlyInst = Number(selectedScheme?.monthlyInstallment || selectedScheme?.monthly_installment || 5000);

  // Tickets enrolled in this specific scheme
  const allTicketsInScheme = tickets.filter(t => {
    const tSchemeId = t.schemeId || t.scheme_id;
    return tSchemeId === schemeId;
  });

  const currentMonth = Number(selectedScheme?.currentMonth ?? selectedScheme?.current_month ?? 1);
  // If auction ticket already started and members have paid for more than months:
  // Show only joined 15/15 or 20/20 and available slot 0
  const isAlreadyStarted = currentMonth > 1;
  const bookedSlotsCount = isAlreadyStarted
    ? totalSlots
    : Math.min(totalSlots, Math.max(allTicketsInScheme.length, Number(selectedScheme?.bookedSlots || selectedScheme?.booked_slots || 0)));
  const vacantSlotsCount = isAlreadyStarted ? 0 : Math.max(0, totalSlots - bookedSlotsCount);

  // Payments for this scheme across all members
  const allPaymentsInScheme = payments.filter(p => {
    const pSchemeId = p.schemeId || p.scheme_id;
    return pSchemeId === schemeId;
  });

  const totalPaidInScheme = allPaymentsInScheme
    .filter(p => (p.status || '').toUpperCase() === 'PAID')
    .reduce((sum, p) => sum + Number(p.netPayable ?? p.net_payable ?? 0), 0);

  const totalDueInScheme = allPaymentsInScheme
    .filter(p => {
      const s = (p.status || '').toUpperCase();
      return s === 'DUE' || s === 'OVERDUE';
    })
    .reduce((sum, p) => sum + Number(p.netPayable ?? p.net_payable ?? 0), 0);

  const schemePaidCount = allPaymentsInScheme.filter(p => (p.status || '').toUpperCase() === 'PAID').length;
  const schemeDueCount = allPaymentsInScheme.filter(p => {
    const s = (p.status || '').toUpperCase();
    return s === 'DUE' || s === 'OVERDUE';
  }).length;

  // Member-specific checks (for regular subscriber)
  const userTicketsInScheme = tickets.filter(t => {
    const tSchemeId = t.schemeId || t.scheme_id;
    const tUserId = t.userId || t.user_id;
    const cUserId = currentUser?.id;
    const matchesUser = !cUserId || tUserId === cUserId;
    const matchesId = tSchemeId === schemeId;
    const matchesVal = Math.round(Number(t.totalValue || t.total_value || 0)) === Math.round(Number(selectedScheme?.totalValue || selectedScheme?.total_value || 0));
    return matchesUser && (matchesId || (matchesVal && matchesVal > 0));
  });

  const isJoined = userTicketsInScheme.length > 0;
  const activeTicket = userTicketsInScheme[0];

  const userPaymentsForScheme = payments.filter(p => {
    const pSchemeId = p.schemeId || p.scheme_id;
    const pTicketId = p.ticketId || p.ticket_id;
    const matchesScheme = pSchemeId === schemeId;
    const matchesTicket = activeTicket ? pTicketId === activeTicket.id : false;
    return matchesScheme || matchesTicket;
  });

  const monthsPaid = Number(activeTicket?.totalMonthsPaid ?? activeTicket?.total_months_paid ?? 0);
  const pct = Math.min(100, Math.round((monthsPaid / duration) * 100));

  const settledPayments = userPaymentsForScheme.filter(p => (p.status || '').toUpperCase() === 'PAID');
  const actualTotalPaid = settledPayments.reduce((sum, p) => sum + Number(p.netPayable ?? p.net_payable ?? 0), 0);
  const totalPaid = actualTotalPaid > 0 ? actualTotalPaid : (monthsPaid * monthlyInst);
  const totalDividendsSaved = settledPayments.reduce((sum, p) => sum + Number(p.dividendDiscount ?? p.dividend_discount ?? 0), 0);

  // Member schedule generator (1 to N)
  const monthlySchedule = [];
  for (let m = 1; m <= duration; m++) {
    const existingP = userPaymentsForScheme.find(p => Number(p.monthNumber ?? p.month_number) === m);
    if (existingP) {
      monthlySchedule.push(existingP);
    } else {
      monthlySchedule.push({
        id: `PROJ-${schemeId}-M${m}`,
        isProjected: true,
        monthNumber: m,
        monthName: `Round #${m}`,
        baseAmount: monthlyInst,
        dividendDiscount: 0,
        netPayable: monthlyInst,
        dueDate: `Month ${m} Schedule`,
        status: 'UPCOMING'
      });
    }
  }

  // Admin members list for this scheme
  const adminMembersList = allTicketsInScheme.map(t => {
    const tPayments = allPaymentsInScheme.filter(p => (p.ticketId || p.ticket_id) === t.id);
    const tPaid = tPayments.filter(p => (p.status || '').toUpperCase() === 'PAID');
    const tDue = tPayments.filter(p => {
      const s = (p.status || '').toUpperCase();
      return s === 'DUE' || s === 'OVERDUE';
    });
    const currentDuePayment = tDue[0] || null;
    const tMonthsPaid = Number(t.totalMonthsPaid ?? t.total_months_paid ?? tPaid.length ?? 0);
    const tTotalPaidAmt = tPaid.reduce((sum, p) => sum + Number(p.netPayable ?? p.net_payable ?? 0), 0) || (tMonthsPaid * monthlyInst);

    const slotNumber = (() => {
      const n = Number(t.slotNumber ?? t.slot_number ?? t.ticketNumber ?? t.ticket_number ?? 0);
      if (n > 0) return n;
      const m = String(t.id || '').match(/-(\d+)$/);
      return m ? parseInt(m[1], 10) : 1;
    })();

    return {
      ticket: t,
      userName: t.userName || 'Member',
      userPhone: t.userPhone || '',
      slotNumber,
      monthsPaid: tMonthsPaid,
      totalPaidAmt: tTotalPaidAmt,
      currentDuePayment,
      status: currentDuePayment ? (currentDuePayment.status || 'DUE').toUpperCase() : 'PAID'
    };
  });

  const filteredAdminMembers = adminMembersList.filter(item => {
    let matchesStatus = true;
    if (adminMemberFilter === 'PAID') matchesStatus = item.status === 'PAID';
    if (adminMemberFilter === 'DUE') matchesStatus = item.status === 'DUE' || item.status === 'OVERDUE';

    const q = adminSearch.toLowerCase();
    const matchesSearch = !adminSearch ||
      item.userName.toLowerCase().includes(q) ||
      item.userPhone.toLowerCase().includes(q) ||
      item.ticket.id.toLowerCase().includes(q) ||
      formatTicketId(item.ticket.id, item.ticket.schemeName).toLowerCase().includes(q);

    return matchesStatus && matchesSearch;
  });

  const handleExportAdminSchemeCSV = () => {
    let csv = "Member Name,Phone,Ticket ID,Slot,Months Paid,Total Paid (INR),Current Status,Due Amount (INR)\n";
    filteredAdminMembers.forEach(item => {
      csv += `"${item.userName}","${item.userPhone}","${item.ticket.id}",${item.slotNumber},${item.monthsPaid},${item.totalPaidAmt},"${item.status}",${item.currentDuePayment?.netPayable || 0}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedScheme.name.replace(/\s+/g, '_')}_Members_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  return (
    <section className="page-view active-view" style={{ maxWidth: '1240px', margin: '0 auto' }}>
      {chitSwitcher}
      {/* 2. ADMIN ROLE VIEW: MANAGE CHIT SCHEME MEMBERS & COLLECTIONS */}
      {isAdmin ? (
        <div>
          {/* Admin Scheme Management Header */}
          <div style={{
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-subtle)',
            padding: '1.5rem',
            marginBottom: '1.5rem',
            boxShadow: 'var(--shadow-card)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.35rem' }}>
                  <span style={{ fontSize: '1.4rem' }}>🛡️</span>
                  <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-main)', margin: 0 }}>
                    {formatChitName(selectedScheme)} Management
                  </h2>
                  <span className="badge-pill silver" style={{ fontSize: '0.75rem', fontWeight: 700 }}>
                    Organizer Console
                  </span>
                </div>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
                  {selectedScheme.name} • Manage all joined members, monthly paid installments, and dues reconciliation.
                </p>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={handleExportAdminSchemeCSV}
                >
                  📥 Export Member List
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  style={{ color: 'var(--rose-400)', borderColor: 'var(--rose-400)' }}
                  onClick={() => {
                    if (window.confirm(`Remove "${selectedScheme.name}"? This cannot be undone. Schemes with joined members cannot be removed.`)) {
                      onDeleteScheme?.(selectedScheme);
                    }
                  }}
                >
                  🗑️ Remove Scheme
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => onOpenSchemeDetails?.(selectedScheme)}
                >
                  📜 Scheme Rules
                </button>
              </div>
            </div>

            {/* 4 Essential Admin Metric Tiles for this Scheme */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
              <div style={{ background: 'var(--surface-subtle)', padding: '0.85rem 1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: '0.2rem' }}>
                  Members Joined
                </div>
                <div style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--cyan-500)' }}>
                  {bookedSlotsCount} / {totalSlots} Members
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                  {vacantSlotsCount} slots vacant remaining{isAlreadyStarted ? ` • Round #${currentMonth} in Progress` : ''}
                </div>
              </div>

              <div style={{ background: 'var(--surface-subtle)', padding: '0.85rem 1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: '0.2rem' }}>
                  Total Collected
                </div>
                <div style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--emerald-500)' }}>
                  {formatINR(totalPaidInScheme)}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--emerald-600, var(--ok-text))', marginTop: '0.2rem', fontWeight: 600 }}>
                  {schemePaidCount} payments reconciled
                </div>
              </div>

              <div style={{ background: 'var(--surface-subtle)', padding: '0.85rem 1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: '0.2rem' }}>
                  Pending / Overdue Dues
                </div>
                <div style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--rose-400)' }}>
                  {formatINR(totalDueInScheme)}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--rose-400)', marginTop: '0.2rem', fontWeight: 600 }}>
                  {schemeDueCount} member dues to follow-up
                </div>
              </div>

              <div style={{ background: 'var(--surface-subtle)', padding: '0.85rem 1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: '0.2rem' }}>
                  Scheme Value & Term
                </div>
                <div style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-main)' }}>
                  {formatINR(selectedScheme.totalValue || selectedScheme.total_value)}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                  {formatINR(monthlyInst)} / mo • {duration} Months
                </div>
              </div>
            </div>
          </div>

          {/* Enrolled Members in this Chit Table */}
          <div className="ledger-card-wrapper" style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', padding: '1.25rem' }}>
            <div style={{ marginBottom: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
              <div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-main)', margin: '0 0 0.2rem 0' }}>
                  Enrolled Members in {formatChitName(selectedScheme)}
                </h3>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0 }}>
                  Review each member's monthly paid progress, current round due, and reconcile offline collections.
                </p>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <div className="search-field-box" style={{ width: '220px' }}>
                  <span className="search-field-icon">🔍</span>
                  <input
                    type="text"
                    className="search-field-input"
                    placeholder="Search member, phone..."
                    value={adminSearch}
                    onChange={(e) => setAdminSearch(e.target.value)}
                  />
                </div>

                <select
                  className="select-filter"
                  value={adminMemberFilter}
                  onChange={(e) => setAdminMemberFilter(e.target.value)}
                  style={{ fontSize: '0.82rem', padding: '0.45rem 0.65rem' }}
                >
                  <option value="ALL">All Members</option>
                  <option value="PAID">✓ Paid Only</option>
                  <option value="DUE">⚠️ Due / Overdue Only</option>
                </select>
              </div>
            </div>

            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Member Name</th>
                    <th>Ticket ID & Slot</th>
                    <th>Monthly Paid Progress</th>
                    <th>Total Paid So Far</th>
                    <th>Current Round Due</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAdminMembers.length === 0 ? (
                    <tr>
                      <td colSpan="7" style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                        No enrolled members found matching filter in this scheme.
                      </td>
                    </tr>
                  ) : (
                    filteredAdminMembers.map(item => {
                      const memberPct = Math.min(100, Math.round((item.monthsPaid / duration) * 100));
                      const isPaid = item.status === 'PAID';
                      const isOverdue = item.status === 'OVERDUE';

                      return (
                        <tr key={item.ticket.id}>
                          {/* 1. Member Name */}
                          <td>
                            <div style={{ fontWeight: 700, color: 'var(--text-main)' }}>
                              {item.userName}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              {item.userPhone || 'Member'}
                            </div>
                          </td>

                          {/* 2. Ticket ID & Slot */}
                          <td>
                            <div style={{ fontWeight: 700, color: 'var(--cyan-500)', fontFamily: 'var(--font-mono)' }}>
                              {formatTicketId(item.ticket.id, item.ticket.schemeName)}
                            </div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                              Slot #{item.slotNumber}
                            </div>
                          </td>

                          {/* 3. Monthly Paid Progress */}
                          <td style={{ minWidth: '170px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                              <span>{item.monthsPaid} of {duration} Months Paid</span>
                              <span style={{ color: 'var(--cyan-500)' }}>{memberPct}%</span>
                            </div>
                            <div style={{ width: '100%', height: '6px', background: 'var(--border-subtle)', borderRadius: '9999px', overflow: 'hidden' }}>
                              <div style={{ width: `${memberPct}%`, height: '100%', background: 'var(--emerald-400)', borderRadius: '9999px' }} />
                            </div>
                          </td>

                          {/* 4. Total Paid So Far */}
                          <td>
                            <div style={{ fontWeight: 700, color: 'var(--emerald-500)', fontSize: '0.95rem' }}>
                              {formatINR(item.totalPaidAmt)}
                            </div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                              {formatINR(monthlyInst)} / month
                            </div>
                          </td>

                          {/* 5. Current Round Due */}
                          <td>
                            <div style={{ fontWeight: 800, color: isPaid ? 'var(--emerald-500)' : 'var(--rose-400)', fontSize: '0.95rem' }}>
                              {item.currentDuePayment ? formatINR(item.currentDuePayment.netPayable) : '₹0 Due'}
                            </div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                              {item.currentDuePayment ? (item.currentDuePayment.monthName || `Round #${item.currentDuePayment.monthNumber}`) : 'Settled'}
                            </div>
                          </td>

                          {/* 6. Status */}
                          <td>
                            <span className={`badge-pill ${isPaid ? 'paid' : isOverdue ? 'overdue' : 'due'}`}>
                              {isPaid ? '✓ PAID' : isOverdue ? 'OVERDUE' : '⚠️ DUE'}
                            </span>
                          </td>

                          {/* 7. Action */}
                          <td>
                            {item.currentDuePayment ? (
                              <div style={{ display: 'flex', gap: '0.35rem' }}>
                                <button
                                  type="button"
                                  className="btn btn-emerald btn-sm"
                                  onClick={() => onReconcilePayment?.(item.currentDuePayment.id)}
                                  title="Reconcile offline cash or bank transfer payment"
                                  style={{ fontSize: '0.78rem', padding: '0.35rem 0.65rem' }}
                                >
                                  Reconcile
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-outline btn-sm"
                                  onClick={() => onSendReminder?.(item.currentDuePayment.id)}
                                  title="Send payment reminder"
                                  style={{ fontSize: '0.78rem', padding: '0.35rem 0.65rem' }}
                                >
                                  Reminder
                                </button>
                              </div>
                            ) : (
                              <span style={{ fontSize: '0.8rem', color: 'var(--emerald-500)', fontWeight: 600 }}>
                                ✓ All Settled
                              </span>
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
        </div>
      ) : (
        /* 3. REGULAR MEMBER ROLE VIEW */
        <div>
          {/* Member Scheme Header */}
          <div style={{
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-subtle)',
            padding: '1.5rem',
            marginBottom: '1.5rem',
            boxShadow: 'var(--shadow-card)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.35rem' }}>
                  <span style={{ fontSize: '1.4rem' }}>🏷️</span>
                  <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-main)', margin: 0 }}>
                    {formatChitName(selectedScheme)}
                  </h2>
                  {isJoined ? (
                    <span className="badge-pill paid" style={{ fontSize: '0.75rem' }}>
                      ✓ You are Enrolled
                    </span>
                  ) : (
                    <span className="badge-pill due" style={{ fontSize: '0.75rem' }}>
                      Not Joined Yet
                    </span>
                  )}
                </div>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
                  {selectedScheme.name} • {selectedScheme.description || 'Government registered chit fund pool under the Chit Funds Act, 1982.'}
                </p>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {!isJoined ? (
                  isAlreadyStarted ? (
                    <span className="badge-pill silver" style={{ padding: '0.45rem 0.85rem', fontSize: '0.78rem', fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>
                      🔒 Started • 0 Slots Open
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-silver"
                      style={{ fontWeight: 700, padding: '0.6rem 1.25rem', fontSize: '0.9rem' }}
                      onClick={() => onOpenBookingModal?.(selectedScheme)}
                    >
                      🎟️ Join This Scheme Now
                    </button>
                  )
                ) : (
                  !isAlreadyStarted && (
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={() => onOpenBookingModal?.(selectedScheme)}
                      title="Book an additional ticket slot in this scheme"
                    >
                      + Book Another Slot
                    </button>
                  )
                )}
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => onOpenSchemeDetails?.(selectedScheme)}
                >
                  📜 Scheme Rules
                </button>
              </div>
            </div>

            {/* 4 Essential Scheme Metric Tiles */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
              <div style={{ background: 'var(--surface-subtle)', padding: '0.85rem 1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: '0.2rem' }}>
                  Total Chit Pool Value
                </div>
                <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--cyan-500)' }}>
                  {formatINR(selectedScheme.totalValue || selectedScheme.total_value)}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                  Full prize capital
                </div>
              </div>

              <div style={{ background: 'var(--surface-subtle)', padding: '0.85rem 1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: '0.2rem' }}>
                  Monthly Installment
                </div>
                <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--emerald-500)' }}>
                  {formatINR(monthlyInst)}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                  Per month base due
                </div>
              </div>

              <div style={{ background: 'var(--surface-subtle)', padding: '0.85rem 1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: '0.2rem' }}>
                  Duration
                </div>
                <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--text-main)' }}>
                  {duration} Months
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                  Fixed term rounds
                </div>
              </div>

              <div style={{ background: 'var(--surface-subtle)', padding: '0.85rem 1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: '0.2rem' }}>
                  Available Slots
                </div>
                <div style={{ fontSize: '1.3rem', fontWeight: 800, color: vacantSlotsCount === 0 ? 'var(--text-muted)' : 'var(--amber-500)' }}>
                  {vacantSlotsCount} Open
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                  {isAlreadyStarted ? `All ${totalSlots}/${totalSlots} slots joined • Started` : `${bookedSlotsCount} of ${totalSlots} slots booked`}
                </div>
              </div>
            </div>
          </div>

          {/* Conditional: If Joined -> Show Monthly Passbook; If Not Joined -> Ask to Join */}
          {isJoined ? (
            <div>
              {/* Active Ticket Enrollment Summary Card */}
              <div style={{
                background: 'var(--bg-card)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)',
                padding: '1.25rem',
                marginBottom: '1.5rem',
                boxShadow: 'var(--shadow-card)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
                  <div>
                    <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', fontWeight: 700, color: 'var(--cyan-500)', display: 'block', marginBottom: '0.2rem' }}>
                      My Active Ticket Passbook
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}>
                        {formatTicketId(activeTicket.id, activeTicket.schemeName)}
                      </span>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        (Slot #{(() => {
                          const n = Number(activeTicket.slotNumber ?? activeTicket.slot_number ?? activeTicket.ticketNumber ?? activeTicket.ticket_number ?? 0);
                          if (n > 0) return n;
                          const m = String(activeTicket.id || '').match(/-(\d+)$/);
                          return m ? parseInt(m[1], 10) : 1;
                        })()})
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Total Amount Paid So Far</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--emerald-500)' }}>
                        {formatINR(totalPaid)}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Total Dividend Savings</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--cyan-500)' }}>
                        {totalDividendsSaved > 0 ? formatINR(totalDividendsSaved) : '₹0'}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Months Completed</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-main)' }}>
                        {monthsPaid} / {duration} Months
                      </div>
                    </div>
                  </div>
                </div>

                {/* Progress Bar */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                    <span>Passbook Completion</span>
                    <span style={{ color: 'var(--emerald-500)' }}>{pct}% Complete ({monthsPaid} of {duration} Months Paid)</span>
                  </div>
                  <div style={{ width: '100%', height: '8px', background: 'var(--border-subtle)', borderRadius: '9999px', overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: 'var(--emerald-500)', borderRadius: '9999px', transition: 'width 0.4s ease' }} />
                  </div>
                </div>
              </div>

              {/* Monthly Paid Table (Required Fields) */}
              <div className="ledger-card-wrapper" style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', padding: '1.25rem' }}>
                <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div>
                    <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-main)', margin: '0 0 0.2rem 0' }}>
                      Monthly Paid Installment Schedule
                    </h3>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>
                      Detailed breakdown of how each monthly installment is paid, dividend discounts, and upcoming dues for {formatChitName(selectedScheme)}.
                    </p>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Showing all {duration} monthly rounds
                  </div>
                </div>

                <div className="data-table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Month / Round</th>
                        <th>Base Installment</th>
                        <th>Dividend Discount</th>
                        <th>Net Amount Paid / Due</th>
                        <th>Due / Paid Date</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthlySchedule.map((p, idx) => {
                        const s = (p.status || '').toUpperCase();
                        const isPaid = s === 'PAID';
                        const isDue = s === 'DUE' || s === 'OVERDUE';
                        const isOverdue = s === 'OVERDUE';

                        return (
                          <tr key={p.id || idx}>
                            {/* 1. Month / Round */}
                            <td>
                              <div style={{ fontWeight: 700, color: 'var(--text-main)' }}>
                                {p.monthName || `Round #${p.monthNumber}`}
                              </div>
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                Month {p.monthNumber} of {duration}
                              </div>
                            </td>

                            {/* 2. Base Installment */}
                            <td>
                              <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                                {formatINR(p.baseAmount || monthlyInst)}
                              </div>
                            </td>

                            {/* 3. Dividend Discount */}
                            <td>
                              {p.dividendDiscount > 0 ? (
                                <span style={{ color: 'var(--emerald-500)', fontWeight: 700 }}>
                                  -{formatINR(p.dividendDiscount)}
                                </span>
                              ) : (
                                <span style={{ color: 'var(--text-muted)' }}>₹0</span>
                              )}
                            </td>

                            {/* 4. Net Amount */}
                            <td>
                              <div style={{
                                fontWeight: 800,
                                color: isPaid ? 'var(--emerald-500)' : isDue ? 'var(--rose-400)' : 'var(--text-main)',
                                fontSize: '0.95rem'
                              }}>
                                {formatINR(p.netPayable || monthlyInst)}
                              </div>
                            </td>

                            {/* 5. Date */}
                            <td>
                              <div style={{ fontSize: '0.78rem', color: isPaid ? 'var(--emerald-500)' : isDue ? 'var(--rose-400)' : 'var(--text-muted)', fontWeight: 600 }}>
                                {isPaid
                                  ? (p.paidDate ? `Paid on ${p.paidDate}` : 'Settled')
                                  : (p.dueDate || `Round #${p.monthNumber} Schedule`)}
                              </div>
                            </td>

                            {/* 6. Status */}
                            <td>
                              <span className={`badge-pill ${isPaid ? 'paid' : isOverdue ? 'overdue' : isDue ? 'due' : 'silver'}`}>
                                {isPaid
                                  ? '✓ PAID'
                                  : isOverdue
                                  ? 'OVERDUE'
                                  : isDue
                                  ? '⚠️ DUE'
                                  : '📅 UPCOMING'}
                              </span>
                            </td>

                            {/* 7. Action */}
                            <td>
                              {isPaid ? (
                                <button
                                  type="button"
                                  className="btn btn-outline btn-sm"
                                  onClick={() => onViewReceipt?.(p)}
                                  title="View receipt"
                                  style={{ fontSize: '0.75rem', padding: '0.25rem 0.55rem' }}
                                >
                                  🧾 Receipt
                                </button>
                              ) : isDue ? (
                                <button
                                  type="button"
                                  className="btn btn-emerald btn-sm"
                                  onClick={() => onOpenPaymentModal?.(p)}
                                  title="Pay monthly installment online"
                                  style={{ fontWeight: 700, fontSize: '0.78rem', padding: '0.35rem 0.75rem' }}
                                >
                                  💳 Pay Now
                                </button>
                              ) : (
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                  Scheduled
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            /* Member Not Joined -> Prompt to Join */
            <div>
              <div style={{
                background: 'var(--bg-card)',
                borderRadius: 'var(--radius-md)',
                border: '2px dashed var(--border-light)',
                padding: '2.5rem 1.5rem',
                textAlign: 'center',
                marginBottom: '1.5rem',
                boxShadow: 'var(--shadow-card)'
              }}>
                <div style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: 'var(--radius-full)',
                  background: 'var(--ok-tint-soft)',
                  border: '2px solid var(--ok-tint-border)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '2rem',
                  marginBottom: '1rem'
                }}>
                  🎟️
                </div>

                <div style={{
                  display: 'inline-block',
                  padding: '0.2rem 0.75rem',
                  background: isAlreadyStarted ? 'var(--surface-muted)' : 'var(--danger-tint)',
                  color: isAlreadyStarted ? 'var(--text-secondary)' : 'var(--danger-text)',
                  borderRadius: '9999px',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  marginBottom: '0.5rem'
                }}>
                  {isAlreadyStarted ? `🔒 Scheme Started • Round #${currentMonth} in Progress` : 'Not Joined Yet'}
                </div>

                <h3 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-main)', marginBottom: '0.5rem' }}>
                  {isAlreadyStarted ? `${formatChitName(selectedScheme)} is Already in Progress` : `You Haven't Joined the ${formatChitName(selectedScheme)} Yet`}
                </h3>

                <p style={{ maxWidth: '580px', margin: '0 auto 1.5rem auto', fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  {isAlreadyStarted
                    ? `This chit fund pool has already commenced and members have paid for ongoing monthly rounds. All ${totalSlots}/${totalSlots} ticket slots are fully joined and closed to new admissions (0 available slots).`
                    : `Enroll in this chit scheme to start your monthly savings of ${formatINR(monthlyInst)}. Enjoy guaranteed monthly dividend discounts, transparent passbook tracking, and prize auction borrowing benefits.`}
                </p>

                {isAlreadyStarted ? (
                  <div>
                    <button
                      type="button"
                      className="btn btn-outline"
                      disabled
                      style={{
                        padding: '0.85rem 2.25rem',
                        fontSize: '1rem',
                        fontWeight: 700,
                        opacity: 0.65,
                        cursor: 'not-allowed'
                      }}
                    >
                      🔒 All {totalSlots}/{totalSlots} Slots Joined (0 Available)
                    </button>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.65rem' }}>
                      This pool is actively running Round #{currentMonth}. Please browse enrolling schemes to book a ticket.
                    </div>
                  </div>
                ) : (
                  <div>
                    <button
                      type="button"
                      className="btn btn-silver"
                      style={{
                        padding: '0.85rem 2.25rem',
                        fontSize: '1.05rem',
                        fontWeight: 800,
                        boxShadow: '0 4px 12px var(--accent-tint-border)',
                        cursor: 'pointer'
                      }}
                      onClick={() => onOpenBookingModal?.(selectedScheme)}
                    >
                      🎟️ Join This Scheme Now (Book Ticket Slot)
                    </button>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.65rem' }}>
                      ⚡ Reserve your ticket slot immediately • 1st installment due upon enrollment
                    </div>
                  </div>
                )}
              </div>

              {/* How Monthly Payments Work Guide */}
              <div style={{
                background: 'var(--bg-card)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)',
                padding: '1.75rem',
                marginBottom: '1.5rem'
              }}>
                <h4 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-main)', marginBottom: '0.35rem' }}>
                  How Monthly Payments & Savings Work for {formatChitName(selectedScheme)}
                </h4>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
                  Full transparency on how your money grows and how monthly installments are calculated:
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
                  <div style={{ background: 'var(--surface-subtle)', padding: '1.25rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>1️⃣</div>
                    <h5 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '0.35rem' }}>
                      Select Slot & Join
                    </h5>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.45 }}>
                      Click "Join This Scheme" to pick your unique ticket slot number (1 to {duration}) and lock in your membership.
                    </p>
                  </div>

                  <div style={{ background: 'var(--surface-subtle)', padding: '1.25rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>2️⃣</div>
                    <h5 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '0.35rem' }}>
                      Pay {formatINR(monthlyInst)} 1st Installment
                    </h5>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.45 }}>
                      Pay Month 1 online via UPI QR or card. Your digital receipt is issued immediately and your passbook is activated.
                    </p>
                  </div>

                  <div style={{ background: 'var(--surface-subtle)', padding: '1.25rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>3️⃣</div>
                    <h5 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '0.35rem' }}>
                      Earn Monthly Dividend Discounts
                    </h5>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.45 }}>
                      From Month 2 onwards, auction discounts are shared with you, reducing your monthly due below {formatINR(monthlyInst)}.
                    </p>
                  </div>

                  <div style={{ background: 'var(--surface-subtle)', padding: '1.25rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>4️⃣</div>
                    <h5 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '0.35rem' }}>
                      Receive Full {formatINR(selectedScheme.totalValue || selectedScheme.total_value)} Capital
                    </h5>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.45 }}>
                      Save disciplined till maturity or bid in monthly auctions when you need emergency lump sum funds.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}