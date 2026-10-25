import React from 'react';
import { buildChitList, formatChitName } from '../utils/format';

export default function Sidebar({
  currentView,
  onNavigate,
  currentUser,
  schemes = [],
  tickets = [],
  payments = [],
  activeSchemeId = null,
  onSelectChit,
  dueAmount = 0,
  overdueAmount = 0,
  upcomingAmount = 0,
  totalPaymentsCount = 0,
  isMobileOpen
}) {
  // Chit schemes list: prioritize dynamic schemes or fallback to default chits
  const defaultChits = [
    { id: 'SCH-BRZ-1L', name: '1 Lakh Chit', totalValue: 100000, monthlyInstallment: 5000, durationMonths: 20 },
    { id: 'SCH-GLD-5L', name: '5 Lakh Chit', totalValue: 500000, monthlyInstallment: 25000, durationMonths: 20 },
    { id: 'SCH-SLV-02', name: '2 Lakh Chit', totalValue: 200000, monthlyInstallment: 10000, durationMonths: 20 },
    { id: 'SCH-GLD-01', name: '3 Lakh Chit', totalValue: 300000, monthlyInstallment: 15000, durationMonths: 20 },
    { id: 'SCH-DIA-01', name: '10 Lakh Chit', totalValue: 1000000, monthlyInstallment: 50000, durationMonths: 20 }
  ];

  // Deduplicate chit schemes list so there is never duplicate 1 Lakh, 10 Lakh, etc.
  const rawChits = (schemes && schemes.length > 0) ? schemes : defaultChits;
  const ticketSchemeIds = new Set((tickets || []).map(t => t.schemeId || t.scheme_id));
  const rank = (x) => (ticketSchemeIds.has(x.id || x._id) ? 0 : 1) * 2 + (String(x.status || '').toLowerCase() === 'active' ? 0 : 1);
  const chitList = buildChitList(rawChits, rank);


  const isAdmin = currentUser?.role === 'admin';

  return (
    <aside className={`app-sidebar ${isMobileOpen ? 'mobile-open' : ''}`}>
      <div className="sidebar-header" onClick={() => onNavigate(isAdmin ? 'admin' : 'overview')}>
        <div className="brand-symbol">🎟️</div>
        <div className="brand-text-wrap">
          <div className="brand-title-main">KD <span>Chit</span></div>
          <div className="brand-tagline">{isAdmin ? 'Admin Portal' : 'Member Portal'}</div>
        </div>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-section-label">Main Menu</div>

        {/* Admin Navigation: ONLY Admin Dashboard */}
        {isAdmin ? (
          <button
            type="button"
            className={`nav-item-btn ${currentView === 'admin' ? 'active' : ''}`}
            onClick={() => onNavigate('admin')}
            style={{
              fontWeight: 700
            }}
          >
            <span className="nav-item-left">
              <span>🛡️</span>
              <span>Admin Dashboard</span>
            </span>
          </button>
        ) : (
          /* Member Navigation: Member Views */
          <>
            <button
              type="button"
              className={`nav-item-btn ${currentView === 'overview' ? 'active' : ''}`}
              onClick={() => onNavigate('overview')}
            >
              <span className="nav-item-left">
                <span>📊</span>
                <span>Dashboard Overview</span>
              </span>
            </button>

            <button
              type="button"
              className={`nav-item-btn nav-item-stacked ${currentView === 'ledger' ? 'active' : ''}`}
              onClick={() => onNavigate('ledger')}
            >
              <span className="nav-item-left">
                <span>💳</span>
                <span>Monthly Paid Ledger</span>
              </span>
              {overdueAmount > 0 ? (
                <span className="nav-subline subline-overdue">
                  ₹{overdueAmount.toLocaleString('en-IN')} overdue
                </span>
              ) : dueAmount > 0 ? (
                <span className="nav-subline subline-due">
                  ₹{dueAmount.toLocaleString('en-IN')} due
                </span>
              ) : upcomingAmount > 0 ? (
                <span className="nav-subline subline-upcoming">
                  ₹{upcomingAmount.toLocaleString('en-IN')} upcoming
                </span>
              ) : totalPaymentsCount > 0 ? (
                <span className="nav-subline subline-clear">All cleared</span>
              ) : null}
            </button>

            <button
              type="button"
              className={`nav-item-btn nav-item-stacked ${currentView === 'tickets' ? 'active' : ''}`}
              onClick={() => onNavigate('tickets')}
            >
              <span className="nav-item-left">
                <span>🎫</span>
                <span>My Ticket Passbook</span>
              </span>
              {(() => {
                const count = (tickets || []).filter(t => !currentUser?.id || t.userId === currentUser.id || t.user_id === currentUser.id).length;
                return count > 0 ? (
                  <span className="nav-subline subline-tickets">
                    {count} {count === 1 ? 'Ticket' : 'Tickets'}
                  </span>
                ) : null;
              })()}
            </button>
          </>
        )}

        {/* Chit List Section: Direct clickable list of chits (1 Lakh, 2 Lakh, 5 Lakh, etc.) */}
        <div className="nav-section-label" style={{ marginTop: '1rem' }}>
          <span>Chit Schemes</span>
        </div>

        {(() => {
          // One sidebar entry per chit amount; chits of the same amount are shown inside it.
          const seenAmt = new Set();
          return chitList.filter(x => {
            const v = Math.round(Number(x.totalValue || x.total_value || 0));
            if (seenAmt.has(v)) return false;
            seenAmt.add(v); return true;
          });
        })().map(first => {
          const amt = Math.round(Number(first.totalValue || first.total_value || 0));
          const group = chitList.filter(x => Math.round(Number(x.totalValue || x.total_value || 0)) === amt);
          const s = group.find(x => (x.id || x._id) === activeSchemeId) || first;
          const chitTitle = formatChitName(group[0]);
          const isSelected = currentView === 'pools' && group.some(x => (x.id || x._id) === activeSchemeId);
          const sId = s.id || s._id;
          const schemeTickets = tickets.filter(t => (t.schemeId === sId || t.scheme_id === sId));
          const totalSlots = s.totalSlots || s.total_slots || 20;
          const currentMonth = Number(s.currentMonth ?? s.current_month ?? 1);
          // If already started and members paid for months: show only joined 15/15, 20/20
          const isAlreadyStarted = currentMonth > 1;
          const joined = isAlreadyStarted ? totalSlots : Math.min(totalSlots, Math.max(schemeTickets.length, Number(s.bookedSlots || s.booked_slots || 0)));
          const schemePayments = payments.filter(p => (p.schemeId === sId || p.scheme_id === sId));
          const paidCount = schemePayments.filter(p => (p.status || '').toUpperCase() === 'PAID').length;

          // Member-specific active ticket check for this scheme
          const userSchemeTickets = (tickets || []).filter(t => {
            const tSchemeId = t.schemeId || t.scheme_id;
            const tUserId = t.userId || t.user_id;
            return (!currentUser?.id || tUserId === currentUser.id) && tSchemeId === sId;
          });
          const userTicket = userSchemeTickets[0] || null;
          const ticketCount = userSchemeTickets.length;
          const slotOf = (t) => {
            const n = Number(t.slotNumber ?? t.slot_number ?? t.ticketNumber ?? t.ticket_number ?? 0);
            if (n > 0) return n;
            const m = String(t.id || '').match(/-(\d+)$/);
            return m ? parseInt(m[1], 10) : 1;
          };
          const slotList = userSchemeTickets.map(slotOf).sort((x, y) => x - y).map(n => `#${n}`).join(', ');

          return (
            <button
              key={amt}
              type="button"
              className={`nav-item-btn ${isSelected ? 'active' : ''}`}
              onClick={() => onSelectChit ? onSelectChit(s) : onNavigate('pools')}
              title={`${s.name} - ${userTicket ? `${ticketCount} active ticket${ticketCount > 1 ? 's' : ''}: ${slotList}` : `${joined}/${totalSlots} members joined`}`}
            >
              <span className="nav-item-left">
                <span>🏷️</span>
                <span>{chitTitle}</span>
              </span>
              {isAdmin ? (
                <span className="nav-badge chit-badge" style={{ fontSize: '0.67rem', fontWeight: 700, background: 'var(--surface-muted)', color: 'var(--cyan-500)', border: '1px solid var(--border-light)' }}>
                  {group.length > 1 ? `${group.length} Chits` : `${joined}/${totalSlots} Joined`}
                </span>
              ) : userTicket ? (
                <span className="nav-badge chit-badge" style={{ fontSize: '0.67rem', fontWeight: 700, background: 'var(--ok-tint)', color: 'var(--ok-text)', border: '1px solid var(--ok-tint-border)' }}>
                  ✓ {ticketCount > 1 ? `${ticketCount} Tickets` : `Active ${slotList}`}
                </span>
              ) : (
                <span className="nav-badge badge-silver chit-badge" style={{ fontSize: '0.68rem', fontWeight: 600 }}>
                  ₹{((s.totalValue || 0) / 100000 >= 1 ? `${(s.totalValue / 100000).toFixed(s.totalValue % 100000 === 0 ? 0 : 1)}L` : `${Math.round((s.totalValue || 0) / 1000)}k`)}
                </span>
              )}
            </button>
          );
        })}
      </nav>

    </aside>
  );
}