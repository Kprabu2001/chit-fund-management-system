import React, { useMemo, useState } from 'react';
import { api } from '../services/api';
import { formatINR } from '../data/initialData';
import DeclareWinnerModal from '../modals/DeclareWinnerModal';
import PrizePayoutModal from '../modals/PrizePayoutModal';

// Admin tab: declare the offline-auction winner, pay the prize, fix a wrong pick while still Pending.
export default function PrizePayoutsPanel({ schemes = [], tickets = [], payouts = [], onRefresh, onShowToast }) {
  const [filterScheme, setFilterScheme] = useState('ALL');
  const [declareFor, setDeclareFor] = useState(null);   // scheme id or '' for the first scheme
  const [payId, setPayId] = useState(null);
  const [revert, setRevert] = useState(null);           // payout being corrected
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [revertErr, setRevertErr] = useState('');

  const rows = useMemo(
    () => payouts.filter(p => filterScheme === 'ALL' || p.scheme === filterScheme),
    [payouts, filterScheme]
  );
  const pendingTotal = payouts.filter(p => p.status === 'PENDING').reduce((s, p) => s + Number(p.amount), 0);
  const pendingCount = payouts.filter(p => p.status === 'PENDING').length;

  // Only the newest winner of a scheme can be corrected, and only while its payout is Pending
  const latestMonth = useMemo(() => {
    const m = {};
    payouts.forEach(p => { m[p.scheme] = Math.max(m[p.scheme] || 0, p.month_number); });
    return m;
  }, [payouts]);

  const doRevert = async () => {
    setBusy(true); setRevertErr('');
    try {
      const res = await api.revertWinner(revert.scheme, reason.trim());
      onShowToast?.(res.message, 'success');
      setRevert(null); setReason('');
      await onRefresh?.();
    } catch (e) { setRevertErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div>
      <div className="payout-toolbar">
        <div>
          <strong style={{ fontSize: '1.05rem' }}>Winners & Prize Payouts</strong>
          <div className="field-hint">
            {pendingCount > 0 ? `${pendingCount} prize${pendingCount > 1 ? 's' : ''} awaiting payment · ${formatINR(pendingTotal)}` : 'No prizes awaiting payment.'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <select className="select-filter" value={filterScheme} onChange={(e) => setFilterScheme(e.target.value)} aria-label="Filter by chit scheme">
            <option value="ALL">All Chit Schemes</option>
            {schemes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button type="button" className="btn btn-primary" onClick={() => setDeclareFor(filterScheme === 'ALL' ? '' : filterScheme)}>
            🏆 Declare winner
          </button>
        </div>
      </div>

      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr><th>Month</th><th>Winner</th><th>Chit</th><th>Prize</th><th>Status</th><th>Action</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan="6" style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                No winners declared yet. After the offline auction, click “Declare winner”.
              </td></tr>
            ) : rows.map(p => {
              const paid = p.status === 'PAID';
              const canCorrect = !paid && latestMonth[p.scheme] === p.month_number;
              return (
                <tr key={p.id}>
                  <td>#{p.month_number}</td>
                  <td>
                    <strong>{p.winner_name}</strong>
                    <div className="field-hint">Ticket #{p.ticket_number}</div>
                    {p.details_missing && <div className="payout-chip warn">No UPI / bank details</div>}
                  </td>
                  <td>{p.scheme_name}</td>
                  <td><strong>{formatINR(p.amount)}</strong></td>
                  <td>
                    <span className={`badge-pill ${paid ? 'paid' : 'due'}`}>{paid ? '✓ PAID' : '⏳ PENDING'}</span>
                    {paid && <div className="field-hint">UTR {p.utr}</div>}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                      <button type="button" className={`btn btn-sm ${paid ? 'btn-outline' : 'btn-emerald'}`} onClick={() => setPayId(p.id)}>
                        {paid ? 'View' : 'Pay prize'}
                      </button>
                      {canCorrect && (
                        <button type="button" className="btn btn-sm btn-outline" onClick={() => { setRevert(p); setRevertErr(''); setReason(''); }}>
                          Correct winner
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {declareFor !== null && (
        <DeclareWinnerModal
          schemes={schemes} tickets={tickets} initialSchemeId={declareFor || undefined}
          onClose={() => setDeclareFor(null)} onShowToast={onShowToast}
          onDone={async () => { await onRefresh?.(); }}
        />
      )}
      {payId && (
        <PrizePayoutModal payoutId={payId} onClose={() => setPayId(null)} onShowToast={onShowToast} onDone={onRefresh} />
      )}
      {revert && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setRevert(null); }}>
          <div className="modal-container" role="dialog" aria-modal="true" aria-label="Correct winner">
            <button type="button" className="modal-close-x" onClick={() => setRevert(null)} aria-label="Close" disabled={busy}>✕</button>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 800, marginBottom: '0.5rem' }}>Correct the winner?</h2>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              This removes <strong>{revert.winner_name}</strong> as the Month {revert.month_number} winner of {revert.scheme_name}
              {' '}and takes the dividend back off next month's unpaid dues. Then declare the correct winner. Possible only while the prize is still Pending.
            </p>
            <div className="form-field">
              <label className="form-label-text" htmlFor="rv-reason">Reason (kept in the audit trail)</label>
              <input id="rv-reason" className="form-input-text" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} disabled={busy} />
            </div>
            {revertErr && <div className="profile-form-error" role="alert">{revertErr}</div>}
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setRevert(null)} disabled={busy}>Keep winner</button>
              <button type="button" className="btn btn-danger" onClick={doRevert} disabled={busy}>{busy ? 'Removing…' : 'Remove winner'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}