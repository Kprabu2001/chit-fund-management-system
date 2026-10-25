import React, { useState } from 'react';
import { classifyTier } from '../data/initialData';

export default function SchemeModal({
  tiers,
  onClose,
  onCreateScheme
}) {
  const [formData, setFormData] = useState({
    name: '1 Lakh Chit',
    tierId: 'bronze',
    totalValue: 100000,
    durationMonths: 20,
    monthlyInstallment: 5000,
    totalSlots: 20,
    commissionPercent: 5.0,
    auctionDay: 18,
    auctionTime: '06:30 PM',
    maxBidDiscount: 30,
    minBidDiscount: 5,
    description: '20-Month disciplined chit scheme of 1 Lakh with high dividend savings.',
    rules: 'Monthly auction on 18th at 6:30 PM. Net payout released within 24 hours.'
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Default chit value picked when a range is selected
  // Fixed chit schemes, as in real chit funds: value = monthly installment x months
  const PRESETS = [
    { id: '50k', label: '₹50,000 • ₹2,500/month • 20 months', value: 50000, monthly: 2500, months: 20 },
    { id: '1l', label: '1 Lakh • ₹5,000/month • 20 months', value: 100000, monthly: 5000, months: 20 },
    { id: '2l', label: '2 Lakh • ₹10,000/month • 20 months', value: 200000, monthly: 10000, months: 20 },
    { id: '3l', label: '3 Lakh • ₹15,000/month • 20 months', value: 300000, monthly: 15000, months: 20 },
    { id: '5l', label: '5 Lakh • ₹25,000/month • 20 months', value: 500000, monthly: 25000, months: 20 },
    { id: '10l', label: '10 Lakh • ₹50,000/month • 20 months', value: 1000000, monthly: 50000, months: 20 },
  ];
  const [presetId, setPresetId] = useState('1l');
  const isCustom = presetId === 'custom';

  const handlePreset = (e) => {
    const id = e.target.value;
    setPresetId(id);
    const p = PRESETS.find(x => x.id === id);
    if (!p) return; // Custom: keep current values, make them editable
    setFormData(prev => {
      const next = {
        ...prev,
        totalValue: p.value,
        durationMonths: p.months,
        monthlyInstallment: p.monthly,
        totalSlots: p.months,
        tierId: classifyTier(p.value) || prev.tierId,
      };
      return recalc(next, { keepName: nameTouched });
    });
  };
  const [nameTouched, setNameTouched] = useState(false);

  const lakhLabel = (val) => {
    const v = Math.round((val / 100000) * 100) / 100;
    return `${v} ${v > 1 ? 'Lakhs' : 'Lakh'}`;
  };

  // Recalculate everything that depends on the chit value / duration / tier
  const recalc = (next, { keepName }) => {
    const { totalValue: tot, durationMonths: dur } = next;
    if (dur > 0 && tot > 0) {
      if (presetId === 'custom') next.monthlyInstallment = Math.round(tot / dur);
      next.totalSlots = dur;
      next.description = `${dur}-Month disciplined chit scheme of ${lakhLabel(tot)} with high dividend savings.`;
      next.rules = `Monthly auction on ${next.auctionDay}th at ${next.auctionTime}. Net payout released within 24 hours.`;
      if (!keepName) next.name = `${lakhLabel(tot).replace('Lakhs', 'Lakh')} Chit`;
    }
    return next;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    const numFields = ['totalValue', 'durationMonths', 'monthlyInstallment', 'totalSlots', 'commissionPercent', 'auctionDay', 'maxBidDiscount', 'minBidDiscount'];
    if (name === 'name') setNameTouched(true);
    setFormData(prev => {
      let next = { ...prev, [name]: numFields.includes(name) ? Number(value) : value };

      if (name === 'totalValue' || name === 'durationMonths') {
        // Typed a value: keep the range in sync and refresh dependent fields
        const t = classifyTier(next.totalValue);
        if (t) next.tierId = t;
        next = recalc(next, { keepName: nameTouched });
      } else if (name === 'auctionDay' || name === 'auctionTime') {
        next = recalc(next, { keepName: true });
      }
      return next;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError('');
    try {
      await onCreateScheme(formData);
    } catch (err) {
      setError(err.message || 'Failed to create scheme. Verify values.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop active" onClick={onClose}>
      <div className="modal-container" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close-x" onClick={onClose}>✕</button>

        <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
          <span className="badge-pill paid" style={{ marginBottom: '0.4rem' }}>ADMIN SCHEME CREATOR</span>
          <h3 style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-main)' }}>Launch New Ticket Scheme</h3>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            Configure and publish a new chit pool for member subscription.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-field">
            <label className="form-label-text">Scheme Name</label>
            <input
              type="text"
              name="name"
              className="form-input-text"
              value={formData.name}
              onChange={handleChange}
              required
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-field">
              <label className="form-label-text">Chit Scheme</label>
              <select
                className="select-filter"
                style={{ width: '100%', padding: '0.65rem' }}
                value={presetId}
                onChange={handlePreset}
              >
                {PRESETS.map(p => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
                <option value="custom">Custom (enter your own values)</option>
              </select>
            </div>

            <div className="form-field">
              <label className="form-label-text">Total Chit Pool Value (₹)</label>
              <input
                type="number"
                name="totalValue"
                readOnly={!isCustom}
                className="form-input-text"
                value={formData.totalValue}
                onChange={handleChange}
                required
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
            <div className="form-field">
              <label className="form-label-text">Duration (Mo)</label>
              <input
                type="number"
                name="durationMonths"
                readOnly={!isCustom}
                className="form-input-text"
                value={formData.durationMonths}
                onChange={handleChange}
                required
              />
            </div>

            <div className="form-field">
              <label className="form-label-text">Installment (₹)</label>
              <input
                type="number"
                name="monthlyInstallment"
                readOnly={!isCustom}
                className="form-input-text"
                value={formData.monthlyInstallment}
                onChange={handleChange}
                required
              />
            </div>

            <div className="form-field">
              <label className="form-label-text">Slots Count</label>
              <input
                type="number"
                name="totalSlots"
                readOnly={!isCustom}
                className="form-input-text"
                value={formData.totalSlots}
                onChange={handleChange}
                required
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-field">
              <label className="form-label-text">Auction Day of Month</label>
              <input
                type="number"
                name="auctionDay"
                min="1"
                max="31"
                className="form-input-text"
                value={formData.auctionDay}
                onChange={handleChange}
                required
              />
            </div>

            <div className="form-field">
              <label className="form-label-text">Max Bid Discount Cap (%)</label>
              <input
                type="number"
                name="maxBidDiscount"
                className="form-input-text"
                value={formData.maxBidDiscount}
                onChange={handleChange}
                required
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-field">
              <label className="form-label-text">Organizer Commission (%)</label>
              <input
                type="number"
                step="0.1"
                name="commissionPercent"
                min="0"
                max="10"
                className="form-input-text"
                value={formData.commissionPercent}
                onChange={handleChange}
                required
              />
            </div>

            <div className="form-field">
              <label className="form-label-text">Auction Time</label>
              <input
                type="text"
                name="auctionTime"
                className="form-input-text"
                value={formData.auctionTime}
                onChange={handleChange}
                required
              />
            </div>
          </div>

          <div className="form-field">
            <label className="form-label-text">Description</label>
            <input
              type="text"
              name="description"
              className="form-input-text"
              value={formData.description}
              onChange={handleChange}
            />
          </div>

          {error && (
            <div style={{
              background: 'var(--danger-tint)',
              border: '1px solid var(--danger-tint-border)',
              color: 'var(--danger-text)',
              padding: '0.65rem',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.8rem',
              marginBottom: '1rem',
              textAlign: 'center'
            }}>
              ⚠️ {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.25rem' }}>
            <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={onClose} disabled={isSubmitting}>
              Cancel
            </button>
            <button type="submit" className="btn btn-silver" style={{ flex: 2 }} disabled={isSubmitting}>
              {isSubmitting ? 'Publishing...' : '🚀 Publish Scheme'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}