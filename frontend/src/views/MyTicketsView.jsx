import React from 'react';
import { formatINR } from '../data/initialData';
import { chitLabel, formatTicketId, tierLabel } from '../utils/format';

export default function MyTicketsView({
  tickets = [],
  schemes = [],
  payouts = [],
  onOpenProfile,
  currentUser,
  onNavigate,
  onViewPassbook
}) {
  const userTickets = (tickets || []).filter(t => !currentUser?.id || t.userId === currentUser.id || t.user_id === currentUser.id);

  return (
    <section className="page-view active-view">
      <div style={{ marginBottom: '1.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-main)' }}>
            My Active Ticket Portfolio ({userTickets.length})
          </h2>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
            Passbook records, installment progress, and prize release tracking across all your chit schemes.
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '1.5rem' }}>
        {userTickets.length === 0 ? (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '3rem', background: 'var(--bg-card)', borderRadius: 'var(--radius-md)' }}>
            <p style={{ color: 'var(--text-muted)' }}>You do not have any enrolled tickets yet.</p>
          </div>
        ) : (
          userTickets.map(t => {
            const scheme = schemes.find(s => s.id === (t.schemeId || t.scheme_id));
            const duration = scheme?.durationMonths || scheme?.duration_months || t.durationMonths || t.duration_months || 20;
            const monthsPaid = Number(t.totalMonthsPaid ?? t.total_months_paid ?? 0);
            const progress = Math.min(100, Math.round((monthsPaid / duration) * 100));
            const monthlyInst = scheme?.monthlyInstallment || scheme?.monthly_installment || (scheme?.totalValue && duration ? Math.round(scheme.totalValue / duration) : 0);
            const netPrizeVal = t.wonPayout ?? t.won_payout ?? (scheme ? (scheme.totalValue - (scheme.minBidAmount || Math.round(scheme.totalValue * 0.05))) : 0);

            return (
              <div key={t.id} className="scheme-card">
                <div>
                  <div className="scheme-card-header">
                    <span className={`tier-tag ${t.tierId || scheme?.tierId || 'silver'}`}>
                      {chitLabel(t.schemeName || scheme?.name, tierLabel(t.tierId || scheme?.tierId || 'silver')).toUpperCase()}
                    </span>
                    <span className={`badge-pill ${t.hasWonAuction ? 'paid' : 'due'}`}>
                      {t.hasWonAuction ? '🏆 PRIZED (ACTIVE)' : '⚡ ACTIVE PARTICIPANT'}
                    </span>
                  </div>

                  <h3 className="scheme-title">{t.schemeName || scheme?.name}</h3>
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: 'var(--cyan-400)', fontWeight: 700 }}>
                      Ticket #{(() => {
                        const n = Number(t.slotNumber ?? t.slot_number ?? t.ticketNumber ?? t.ticket_number ?? 0);
                        if (n > 0) return n;
                        const m = String(t.id || '').match(/-(\d+)$/);
                        return m ? parseInt(m[1], 10) : 1;
                      })()} ({formatTicketId(t.id, t.schemeName || scheme?.name)})
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Enrolled: {t.issuedDate || t.issued_date}
                    </span>
                  </div>

                  {t.hasWonAuction && (
                    <div style={{ background: 'var(--ok-tint)', border: '1px solid var(--ok-tint-border)', borderRadius: 'var(--radius-sm)', padding: '0.85rem', marginBottom: '1rem' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--emerald-400)', fontWeight: 700 }}>
                        WON IN MONTH #{t.wonMonth || t.won_month}
                      </div>
                      <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-main)', fontFamily: 'var(--font-heading)' }}>
                        Net Prize Payout: {formatINR(netPrizeVal)}
                      </div>
                      {(() => {
                        const po = payouts.find(x => x.ticket_id === t.id);
                        if (!po) return null;
                        const paid = po.status === 'PAID';
                        return (
                          <div className="prize-status" style={{ marginTop: '0.6rem' }}>
                            <span className={`badge-pill ${paid ? 'paid' : 'due'}`}>{paid ? '✓ PRIZE PAID' : '⏳ PRIZE PENDING'}</span>
                            {paid && <div className="field-hint">UTR / reference: <strong>{po.utr}</strong>{po.paid_at && <> · {new Date(po.paid_at).toLocaleDateString('en-IN')}</>}</div>}
                            {!paid && po.details_missing && (
                              <div className="payout-warning" style={{ marginTop: '0.5rem' }}>
                                Add your UPI or bank details to receive your prize.{' '}
                                <button type="button" className="btn btn-sm btn-primary" onClick={onOpenProfile}>Add details</button>
                              </div>
                            )}
                            {!paid && !po.details_missing && <div className="field-hint">Your payout details are saved. The admin will pay you soon.</div>}
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  <div className="scheme-specs-matrix">
                    <div>
                      <div className="spec-cell-label">Months Paid</div>
                      <div className="spec-cell-val">{monthsPaid} / {duration} Months</div>
                    </div>
                    <div>
                      <div className="spec-cell-label">Monthly Installment</div>
                      <div className="spec-cell-val cyan">{formatINR(monthlyInst)}</div>
                    </div>
                  </div>


                  <div className="slot-occupancy-wrap">
                    <div className="slot-occupancy-labels">
                      <span>Passbook Completion</span>
                      <span>{progress}%</span>
                    </div>
                    <div className="slot-bar-track">
                      <div className="slot-bar-fill" style={{ width: `${progress}%`, background: 'var(--emerald-400)' }}></div>
                    </div>
                  </div>
                </div>

                <div className="scheme-footer-actions">
                  <button
                    className="btn btn-outline"
                    style={{ flex: 1 }}
                    onClick={() => onViewPassbook(t)}
                  >
                    📖 View Passbook
                  </button>
                  <button
                    className="btn btn-silver"
                    style={{ flex: 1 }}
                    onClick={() => onNavigate('ledger')}
                  >
                    💳 Pay Next Due
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}