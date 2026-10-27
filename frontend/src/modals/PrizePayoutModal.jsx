import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../services/api';
import { formatINR } from '../data/initialData';

const REF_RE = /^[A-Za-z0-9/_-]{6,40}$/;

function CopyBtn({ text, label, onShowToast }) {
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); onShowToast?.(`${label} copied`, 'success'); }
    catch { onShowToast?.('Copy is not available in this browser.', 'error'); }
  };
  return <button type="button" className="btn btn-sm btn-outline" onClick={copy} disabled={!text} aria-label={`Copy ${label}`}>Copy</button>;
}

function DetailRow({ label, value, onShowToast }) {
  return (
    <div className="payout-detail-row">
      <span>{label}</span>
      <strong>{value || '—'}</strong>
      <CopyBtn text={value} label={label} onShowToast={onShowToast} />
    </div>
  );
}

// Admin-only. Winner's payout details come from their profile (read-only here).
export default function PrizePayoutModal({ payoutId, onClose, onDone, onShowToast }) {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [method, setMethod] = useState('UPI');
  const [utr, setUtr] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState('');

  const load = async () => {
    try {
      const d = await api.getPayoutDetail(payoutId);
      setData(d);
      if (d.winner.suggested_method) setMethod(d.winner.suggested_method);
    } catch (e) { setLoadError(e.message); }
  };
  useEffect(() => { load(); }, [payoutId]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const uri = data?.upi_uri || '';
  useEffect(() => {
    let alive = true;
    if (uri && method === 'UPI') QRCode.toDataURL(uri, { margin: 1, width: 200 }).then(u => alive && setQr(u)).catch(() => alive && setQr(''));
    else setQr('');
    return () => { alive = false; };
  }, [uri, method]);

  const payout = data?.payout;
  const winner = data?.winner;
  const isPaid = payout?.status === 'PAID';
  const methodOk = method === 'UPI' ? winner?.has_upi : winner?.has_bank;

  const markPaid = async () => {
    setError('');
    if (!methodOk) return setError(`${winner.name} has no valid ${method === 'UPI' ? 'UPI ID' : 'bank account'} saved.`);
    if (!REF_RE.test(utr.trim())) return setError('Enter the UTR / transaction reference (6-40 letters or digits).');
    if (!window.confirm(`Mark ${formatINR(payout.amount)} as PAID to ${winner.name} via ${method === 'UPI' ? 'UPI' : 'bank transfer'}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const res = await api.markPayoutPaid(payoutId, { method, utr: utr.trim(), notes: notes.trim() });
      onShowToast?.(res.message, 'success');
      await onDone?.();
      await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const remind = async () => {
    setBusy(true); setError('');
    try {
      const res = await api.remindPayoutMember(payoutId);
      onShowToast?.(res.message, 'success');
      await onDone?.();
      await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal-container profile-modal" role="dialog" aria-modal="true" aria-label="Pay prize to winner">
        <button type="button" className="modal-close-x" onClick={onClose} aria-label="Close" disabled={busy}>✕</button>
        <h2 style={{ fontSize: '1.3rem', fontWeight: 800, marginBottom: '1rem' }}>Pay Prize</h2>

        {loadError ? <div className="profile-form-error" role="alert">{loadError}</div>
          : !data ? <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div> : (
          <>
            <div className="payout-summary">
              <div><span>Winner</span><strong>{winner.name} · Ticket #{winner.ticket_number}</strong></div>
              <div><span>Chit · Month</span><strong>{payout.scheme_name} · #{payout.month_number}</strong></div>
              <div><span>Prize amount</span><strong style={{ fontSize: '1.15rem' }}>{formatINR(payout.amount)}</strong></div>
              <div><span>Status</span><span className={`badge-pill ${isPaid ? 'paid' : 'due'}`}>{isPaid ? '✓ PAID' : '⏳ PENDING'}</span></div>
              {winner.phone && <div><span>Phone</span><strong>{winner.phone}</strong></div>}
            </div>

            {isPaid ? (
              <div className="payout-paid">
                Paid via <strong>{payout.method === 'UPI' ? 'UPI' : 'Bank transfer'}</strong> to <strong>{payout.destination}</strong><br />
                UTR / reference: <strong>{payout.utr}</strong><br />
                {payout.paid_at && new Date(payout.paid_at).toLocaleString('en-IN')}{payout.paid_by_name && <> · by {payout.paid_by_name}</>}
              </div>
            ) : (
              <>
                {data.warning && (
                  <div className="payout-warning" role="alert">
                    ⚠️ {data.warning}
                    <div style={{ marginTop: '0.6rem' }}>
                      <button type="button" className="btn btn-sm btn-outline" onClick={remind} disabled={busy}>
                        🔔 Remind member{payout.details_reminder_count ? ` (sent ${payout.details_reminder_count}×)` : ''}
                      </button>
                    </div>
                  </div>
                )}

                {winner.has_any_details && (
                  <>
                    <div className="payout-method-tabs" role="tablist" aria-label="Payout method">
                      {[['UPI', winner.has_upi], ['BANK', winner.has_bank]].map(([m, ok]) => (
                        <button key={m} type="button" role="tab" aria-selected={method === m}
                          className={`btn btn-sm ${method === m ? 'btn-primary' : 'btn-outline'}`}
                          onClick={() => setMethod(m)} disabled={busy || !ok}
                          title={ok ? '' : 'Not saved by the member'}>
                          {m === 'UPI' ? 'UPI' : 'Bank transfer'}
                        </button>
                      ))}
                    </div>

                    {method === 'UPI' && winner.has_upi && (
                      <>
                        <DetailRow label="UPI ID" value={winner.upi_id} onShowToast={onShowToast} />
                        <DetailRow label="Amount" value={Number(payout.amount).toFixed(2)} onShowToast={onShowToast} />
                        {uri && (
                          <div className="payout-upi-box">
                            {qr && <img src={qr} alt={`UPI QR for ${formatINR(payout.amount)}`} width="170" height="170" />}
                            <div>
                              <div className="field-hint" style={{ marginBottom: '0.5rem' }}>
                                Scan with any UPI app, or tap on a phone. The amount is pre-filled.
                              </div>
                              <a className="btn btn-sm btn-emerald" href={uri}>Open UPI app</a>{' '}
                              <CopyBtn text={uri} label="UPI link" onShowToast={onShowToast} />
                            </div>
                          </div>
                        )}
                      </>
                    )}
                    {method === 'BANK' && winner.has_bank && (
                      <>
                        <DetailRow label="Account holder" value={winner.bank_account_holder} onShowToast={onShowToast} />
                        <DetailRow label="Account number" value={winner.bank_account_number} onShowToast={onShowToast} />
                        <DetailRow label="IFSC" value={winner.bank_ifsc} onShowToast={onShowToast} />
                        <DetailRow label="Amount" value={Number(payout.amount).toFixed(2)} onShowToast={onShowToast} />
                      </>
                    )}

                    <div className="profile-section-title">After you have paid</div>
                    <div className="form-field">
                      <label className="form-label-text" htmlFor="pp-utr">UTR / transaction reference</label>
                      <input id="pp-utr" className="form-input-text" value={utr} onChange={(e) => { setUtr(e.target.value); setError(''); }}
                        placeholder="e.g. 412345678901" autoComplete="off" disabled={busy} />
                    </div>
                    <div className="form-field">
                      <label className="form-label-text" htmlFor="pp-notes">Notes (optional)</label>
                      <input id="pp-notes" className="form-input-text" value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} disabled={busy} />
                    </div>
                  </>
                )}

                {error && <div className="profile-form-error" role="alert">{error}</div>}
                <div className="modal-actions">
                  <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>Close</button>
                  <button type="button" className="btn btn-primary" onClick={markPaid} disabled={busy || !winner.has_any_details}>
                    {busy ? 'Saving…' : '✓ Mark as paid'}
                  </button>
                </div>
              </>
            )}

            {data.ledger?.length > 0 && (
              <details className="payout-ledger">
                <summary>Payout history ({data.ledger.length})</summary>
                <ul>
                  {data.ledger.map(l => (
                    <li key={l.id}>
                      <strong>{l.entry_type === 'PAID' ? 'Paid' : 'Reminder sent'}</strong>
                      {l.destination && <> · {l.destination}</>}{l.transaction_ref && <> · {l.transaction_ref}</>}
                      {' · '}{new Date(l.created_at).toLocaleString('en-IN')}{l.performed_by_name && <> · {l.performed_by_name}</>}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>
    </div>
  );
}