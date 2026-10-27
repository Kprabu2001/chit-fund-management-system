import React, { useState } from 'react';
import { formatINR } from '../data/initialData';

export default function BookingModal({
  scheme,
  existingTickets,
  onClose,
  onConfirmBooking
}) {
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!scheme) return null;

  const totalSlots = scheme.totalSlots || scheme.total_slots || (scheme.totalValue && scheme.monthlyInstallment ? Math.round(scheme.totalValue / scheme.monthlyInstallment) : 20);
  const schemeId = scheme.id;
  const bookedSlotNumbers = existingTickets
    .filter(t => (t.schemeId || t.scheme_id) === schemeId)
    .map(t => Number(t.ticketNumber ?? t.ticket_number));

  // If mock data booked slots exceeds existing tickets, fill some arbitrary slots while ensuring open slots exist
  const rawMockCount = Number(scheme.bookedSlots ?? scheme.booked_slots ?? 0);
  const mockBookedCount = Math.min(rawMockCount, totalSlots);   // a full pool stays full (no fake open slots)
  for (let i = 1; i <= totalSlots && bookedSlotNumbers.length < mockBookedCount; i++) {
    if (!bookedSlotNumbers.includes(i)) {
      bookedSlotNumbers.push(i);
    }
  }

  const handleConfirm = async () => {
    if (!selectedSlot || isSubmitting) return;
    setIsSubmitting(true);
    setError('');
    try {
      await onConfirmBooking(scheme.id, selectedSlot);
    } catch (err) {
      setError(err.message || 'Slot booking failed. The slot may have just been claimed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop active" onClick={onClose}>
      <div className="modal-container" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close-x" onClick={onClose}>✕</button>

        <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
          <span className="badge-pill paid" style={{ marginBottom: '0.4rem' }}>
            SUBSCRIBER ENROLLMENT
          </span>
          <h3 style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-main)' }}>
            {scheme.name}
          </h3>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            Select your preferred ticket slot number to lock in your enrollment.
          </p>
        </div>

        <div className="scheme-specs-matrix">
          <div>
            <div className="spec-cell-label">Total Chit Value</div>
            <div className="spec-cell-val cyan">{formatINR(scheme.totalValue || scheme.total_value)}</div>
          </div>
          <div>
            <div className="spec-cell-label">Monthly Installment</div>
            <div className="spec-cell-val">{formatINR(scheme.monthlyInstallment || scheme.monthly_installment)}</div>
          </div>
          <div>
            <div className="spec-cell-label">Duration</div>
            <div className="spec-cell-val">{scheme.durationMonths || scheme.duration_months || totalSlots} Months</div>
          </div>
          <div>
            <div className="spec-cell-label">Monthly Auction</div>
            <div className="spec-cell-val amber">{scheme.auctionDay || scheme.auction_day || 15}th • {scheme.auctionTime || scheme.auction_time || '04:00 PM'}</div>
          </div>
        </div>

        <div>
          <label className="form-label-text">Select Ticket Slot Number</label>
          <div className="slots-grid">
            {Array.from({ length: totalSlots }, (_, i) => i + 1).map(num => {
              const isBooked = bookedSlotNumbers.includes(num);
              const isSelected = selectedSlot === num;

              return (
                <button
                  key={num}
                  type="button"
                  disabled={isBooked}
                  className={`slot-btn ${isBooked ? 'booked' : ''} ${isSelected ? 'selected' : ''}`}
                  onClick={() => setSelectedSlot(num)}
                >
                  #{String(num).padStart(2, '0')}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: '1rem', fontSize: '0.75rem', color: 'var(--text-muted)', justifyContent: 'center' }}>
            <span>🟢 Available</span>
            <span>🔵 Selected</span>
            <span style={{ textDecoration: 'line-through' }}>⚪ Booked</span>
          </div>
        </div>

        {selectedSlot && (
          <div style={{ background: 'var(--accent-tint-soft)', border: '1px solid var(--accent-tint-border)', borderRadius: 'var(--radius-sm)', padding: '0.85rem', margin: '1rem 0', textAlign: 'center' }}>
            <span style={{ color: 'var(--text-main)', fontSize: '0.9rem' }}>
              Selected Ticket: <strong style={{ color: 'var(--cyan-400)' }}>#{String(selectedSlot).padStart(2, '0')}</strong> • Monthly Installment: {formatINR(scheme.monthlyInstallment || scheme.monthly_installment)} (due once all {totalSlots} members join)
            </span>
          </div>
        )}


        {error && (
          <div style={{
            background: 'var(--danger-tint)',
            border: '1px solid var(--danger-tint-border)',
            color: 'var(--danger-text)',
            padding: '0.65rem',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.8rem',
            marginTop: '0.85rem',
            textAlign: 'center'
          }}>
            ⚠️ {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.25rem' }}>
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={onClose} disabled={isSubmitting}>
            Cancel
          </button>
          <button
            className="btn btn-silver"
            style={{ flex: 2 }}
            disabled={!selectedSlot || isSubmitting}
            onClick={handleConfirm}
          >
            {isSubmitting ? 'Enrolling...' : '✓ Confirm Slot & Enroll'}
          </button>
        </div>
      </div>
    </div>
  );
}