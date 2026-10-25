import React from 'react';
import { formatINR } from '../data/initialData';
import { formatTicketId } from '../utils/format';

export default function ReceiptModal({
  payment,
  onClose
}) {
  if (!payment) return null;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="modal-backdrop active" onClick={onClose}>
      <div className="modal-container" style={{ maxWidth: '580px' }} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close-x" onClick={onClose}>✕</button>

        <div className="receipt-paper">
          <div className="receipt-header">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.4rem' }}>🎟️</span>
                <span style={{ fontWeight: 800, fontSize: '1.2rem', color: '#0f172a' }}>
                  AUCTION<span style={{ color: '#0284c7' }}>TICKET</span> PRO
                </span>
              </div>
              <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>
                GSTIN: 27AABCA1234F1Z8 • Reg: Chit Fund Act, 1982
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#0284c7' }}>
                OFFICIAL RECEIPT
              </div>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155' }}>
                {payment.receiptNumber || 'REC-2026-04-104'}
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem', marginBottom: '1.25rem', fontSize: '0.82rem' }}>
            <div>
              <span style={{ color: '#64748b', display: 'block', fontSize: '0.72rem', textTransform: 'uppercase' }}>Subscriber Name</span>
              <strong style={{ color: '#0f172a' }}>{payment.userName || 'Rahul Sharma'}</strong>
            </div>
            <div>
              <span style={{ color: '#64748b', display: 'block', fontSize: '0.72rem', textTransform: 'uppercase' }}>Payment Date</span>
              <strong style={{ color: '#0f172a' }}>{payment.paidDate || new Date().toISOString().split('T')[0]}</strong>
            </div>
            <div>
              <span style={{ color: '#64748b', display: 'block', fontSize: '0.72rem', textTransform: 'uppercase' }}>Scheme / Chit Pool</span>
              <strong style={{ color: '#0f172a' }}>{payment.schemeName}</strong>
            </div>
            <div>
              <span style={{ color: '#64748b', display: 'block', fontSize: '0.72rem', textTransform: 'uppercase' }}>Ticket ID / Round</span>
              <strong style={{ color: '#0f172a' }}>{formatTicketId(payment.ticketId, payment.schemeName || payment.scheme_name)} • Month #{payment.monthNumber}</strong>
            </div>
          </div>

          <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '0.75rem', marginBottom: '1rem' }}>
            <div className="receipt-row">
              <span>Gross Base Installment:</span>
              <span>{formatINR(payment.baseAmount)}</span>
            </div>
            <div className="receipt-row">
              <span style={{ color: '#16a34a' }}>Less: Auction Dividend Shared:</span>
              <span style={{ color: '#16a34a', fontWeight: 600 }}>-{formatINR(payment.dividendDiscount || 0)}</span>
            </div>
            <div className="receipt-row">
              <span>Payment Mode:</span>
              <span>{payment.paymentMethod || 'UPI (Settled)'}</span>
            </div>
            <div className="receipt-row">
              <span>Transaction Reference:</span>
              <span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{payment.transactionRef || 'UPI-AXIS-923847291'}</span>
            </div>
            <div className="receipt-total">
              <span>Net Realized Amount:</span>
              <span>{formatINR(payment.netPayable)}</span>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.25rem', paddingTop: '0.75rem', borderTop: '1px dashed #cbd5e1' }}>
            <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
              ✓ Digitally signed & verified by Axis Bank Clearing Gateway
            </div>
            <div style={{ border: '2px solid #16a34a', color: '#16a34a', fontWeight: 800, fontSize: '0.72rem', padding: '2px 8px', borderRadius: '4px', textTransform: 'uppercase' }}>
              PAID & SETTLED
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.25rem' }}>
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={onClose}>
            Close
          </button>
          <button className="btn btn-silver" style={{ flex: 1 }} onClick={handlePrint}>
            🖨️ Print / Save PDF
          </button>
        </div>
      </div>
    </div>
  );
}
