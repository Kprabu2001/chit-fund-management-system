import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../services/api';
import { formatINR } from '../data/initialData';
import { formatTicketId } from '../utils/format';

// Two steps: 1) pick ticket + discount, "Review" runs a dry-run on the server;
// 2) the admin sees the exact result and any unpaid-member warnings, then confirms.
export default function DeclareWinnerModal({ schemes = [], tickets = [], initialSchemeId, onClose, onDone, onShowToast }) {
  const activeSchemes = useMemo(() => schemes.filter(s => (s.status || 'active') !== 'completed'), [schemes]);
  const [schemeId, setSchemeId] = useState(initialSchemeId || activeSchemes[0]?.id || '');
  const [ticketId, setTicketId] = useState('');
  const [discount, setDiscount] = useState('');
  const [review, setReview] = useState(null); // { summary, warnings }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const scheme = activeSchemes.find(s => s.id === schemeId);
  const minAmt = Number(scheme?.minBidAmount || 0);
  const maxAmt = Number(scheme?.maxBidAmount || 0);
  const eligibleTickets = useMemo(
    () => tickets
      .filter(t => (t.schemeId || t.scheme_id) === schemeId && !(t.hasWonAuction || t.has_won_auction))
      .sort((a, b) => a.ticketNumber - b.ticketNumber),
    [tickets, schemeId]
  );

  useEffect(() => { setTicketId(''); setReview(null); setError(''); }, [schemeId]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const edit = (fn) => (e) => { fn(e); setReview(null); setError(''); };

  const runReview = async () => {
    setError('');
    const d = Number(discount);
    if (!ticketId) return setError('Select the winning member / ticket.');
    if (!(d > 0)) return setError('Enter the winning discount from the auction.');
    if (d < minAmt || d > maxAmt) return setError(`Discount must be between ${formatINR(minAmt)} and ${formatINR(maxAmt)} for this scheme.`);
    setBusy(true);
    try {
      setReview(await api.declareWinner({ schemeId, ticketId, discount: d.toFixed(2), dryRun: true }));
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const confirm = async () => {
    setBusy(true); setError('');
    try {
      const res = await api.declareWinner({ schemeId, ticketId, discount: Number(discount).toFixed(2) });
      onShowToast?.(res.message, 'success');
      await onDone?.(res);
      onClose();
    } catch (e) { setError(e.message); setReview(null); } finally { setBusy(false); }
  };

  const sm = review?.summary;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal-container profile-modal" role="dialog" aria-modal="true" aria-label="Declare auction winner">
        <button type="button" className="modal-close-x" onClick={onClose} aria-label="Close" disabled={busy}>✕</button>
        <h2 style={{ fontSize: '1.3rem', fontWeight: 800, marginBottom: '0.25rem' }}>Declare Auction Winner</h2>
        <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
          Enter the result of the offline auction. Dividends, next month's dues and the audit record are created automatically.
        </p>

        {!sm ? (
          <>
            <div className="form-field">
              <label className="form-label-text" htmlFor="dw-scheme">Chit scheme</label>
              <select id="dw-scheme" className="form-input-text" value={schemeId} onChange={edit(e => setSchemeId(e.target.value))} disabled={busy}>
                {activeSchemes.map(s => <option key={s.id} value={s.id}>{s.name} · {formatINR(s.totalValue)}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label className="form-label-text" htmlFor="dw-ticket">Winning member</label>
              <select id="dw-ticket" className="form-input-text" value={ticketId} onChange={edit(e => setTicketId(e.target.value))} disabled={busy}>
                <option value="">Select member…</option>
                {eligibleTickets.map(t => (
                  <option key={t.id} value={t.id}>#{t.ticketNumber} · {t.userName || t.userId} · {formatTicketId(t.id, t.schemeName)}</option>
                ))}
              </select>
              <div className="field-hint">Members who already won are not listed.</div>
            </div>
            <div className="form-field">
              <label className="form-label-text" htmlFor="dw-discount">Winning discount (₹)</label>
              <input id="dw-discount" className="form-input-text" inputMode="decimal" value={discount}
                onChange={edit(e => setDiscount(e.target.value.replace(/[^0-9.]/g, '')))}
                placeholder={`${minAmt} – ${maxAmt}`} disabled={busy} />
              <div className="field-hint">Allowed for this scheme: {formatINR(minAmt)} – {formatINR(maxAmt)}.</div>
            </div>
            {error && <div className="profile-form-error" role="alert">{error}</div>}
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={runReview} disabled={busy}>{busy ? 'Checking…' : 'Review result'}</button>
            </div>
          </>
        ) : (
          <>
            <div className="payout-summary" aria-live="polite">
              <div><span>Chit · Month</span><strong>{sm.scheme_name} · #{sm.month_number}</strong></div>
              <div><span>Winner</span><strong>{sm.winner_name} · Ticket #{sm.winner_ticket_number}</strong></div>
              <div><span>Winning discount</span><strong>{formatINR(sm.winning_discount)}</strong></div>
              <div><span>Prize to pay winner</span><strong style={{ fontSize: '1.1rem' }}>{formatINR(sm.winner_payout)}</strong></div>
              <div><span>Commission</span><strong>{formatINR(sm.organizer_commission)}</strong></div>
              <div><span>Dividend per member ({sm.eligible_count} members)</span><strong>{formatINR(sm.dividend_per_member)}</strong></div>
            </div>
            {review.warnings?.length > 0 && (
              <div className="payout-warning" role="alert">
                {review.warnings.map(w => <div key={w}>⚠️ {w}</div>)}
                {sm.unpaid_members?.length > 0 && (
                  <details style={{ marginTop: '0.5rem' }}>
                    <summary>Who has not paid</summary>
                    <ul style={{ margin: '0.4rem 0 0 1.1rem' }}>
                      {sm.unpaid_members.map(m => <li key={m.ticket_id}>#{m.ticket_number} {m.name}</li>)}
                    </ul>
                  </details>
                )}
                <div className="field-hint" style={{ marginTop: '0.5rem' }}>You can still declare; unpaid members stay in their pending dues.</div>
              </div>
            )}
            {error && <div className="profile-form-error" role="alert">{error}</div>}
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setReview(null)} disabled={busy}>Back</button>
              <button type="button" className="btn btn-primary" onClick={confirm} disabled={busy}>{busy ? 'Declaring…' : '🏆 Confirm & declare'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}