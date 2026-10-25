import React, { useEffect, useState } from 'react';
import { api } from '../services/api';

const EMPTY = {
  name: '', email: '', city: '',
  upi_id: '', bank_account_holder: '', bank_account_number: '', bank_ifsc: '',
  nominee_name: '', nominee_relation: ''
};

const RELATIONS = ['Spouse', 'Son', 'Daughter', 'Father', 'Mother', 'Brother', 'Sister', 'Other'];

function validate(f, isAdmin) {
  const e = {};
  if (f.name.trim().length < 2) e.name = 'Enter your full name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) e.email = 'Enter a valid email address.';
  if (isAdmin) return e;
  if (f.upi_id.trim() && !/^[A-Za-z0-9._-]{2,256}@[A-Za-z]{2,64}$/.test(f.upi_id.trim())) e.upi_id = 'Enter a valid UPI ID, e.g. name@bank.';
  const acc = f.bank_account_number.replace(/\s+/g, '');
  const ifsc = f.bank_ifsc.trim().toUpperCase();
  if (acc && !/^\d{9,18}$/.test(acc)) e.bank_account_number = 'Account number must be 9 to 18 digits.';
  if (ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) e.bank_ifsc = 'Enter a valid IFSC code, e.g. HDFC0001234.';
  if (acc || ifsc) {
    if (!acc) e.bank_account_number = 'Enter the account number.';
    if (!ifsc) e.bank_ifsc = 'Enter the IFSC code.';
    if (!f.bank_account_holder.trim()) e.bank_account_holder = 'Enter the account holder name.';
  }
  if (f.nominee_name.trim() && !f.nominee_relation) e.nominee_relation = 'Select the relation.';
  return e;
}

// Defined outside the modal so inputs keep focus while typing.
function Field({ form, errors, set, label, name, hint, children, ...props }) {
  return (
    <div className="form-field">
      <label className="form-label-text" htmlFor={`pf-${name}`}>{label}</label>
      {children || (
        <input id={`pf-${name}`} className={`form-input-text ${errors[name] ? 'has-error' : ''}`} value={form[name]} onChange={set(name)} {...props} />
      )}
      {errors[name] ? <div className="field-error">{errors[name]}</div> : hint ? <div className="field-hint">{hint}</div> : null}
    </div>
  );
}

export default function ProfileModal({ currentUser, onClose, onSaved, onShowToast }) {
  const isAdmin = currentUser?.role === 'admin';
  const [form, setForm] = useState({ ...EMPTY, name: currentUser?.name || '', email: currentUser?.email || '', city: currentUser?.city || '' });
  const [phone, setPhone] = useState(currentUser?.phone || '');
  const [kyc, setKyc] = useState(currentUser?.kycStatus || '');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');

  useEffect(() => {
    let alive = true;
    api.getProfile()
      .then(p => {
        if (!alive) return;
        setForm(Object.fromEntries(Object.keys(EMPTY).map(k => [k, p[k] || ''])));
        setPhone(p.phone || '');
        setKyc(p.kyc_status || p.kycStatus || '');
      })
      .catch(err => alive && setFormError(err.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const set = (key) => (e) => {
    setForm(f => ({ ...f, [key]: e.target.value }));
    if (errors[key]) setErrors(er => ({ ...er, [key]: undefined }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const found = validate(form, isAdmin);
    setErrors(found);
    setFormError('');
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      const payload = isAdmin
        ? { name: form.name.trim(), email: form.email.trim(), city: form.city.trim() }
        : {
            ...form,
            name: form.name.trim(), email: form.email.trim(), city: form.city.trim(),
            upi_id: form.upi_id.trim(), bank_account_number: form.bank_account_number.replace(/\s+/g, ''),
            bank_ifsc: form.bank_ifsc.trim().toUpperCase()
          };
      const saved = await api.updateProfile(payload);
      onShowToast?.('Profile updated.', 'success');
      onSaved?.(saved);
      onClose();
    } catch (err) {
      setErrors(err.fieldErrors || {});
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const ctx = { form, errors, set };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-container profile-modal" role="dialog" aria-modal="true" aria-label="My profile">
        <button type="button" className="modal-close-x" onClick={onClose} aria-label="Close">✕</button>
        <h2 style={{ fontSize: '1.3rem', fontWeight: 800, marginBottom: '0.25rem' }}>My Profile</h2>
        <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
          {isAdmin ? 'Keep your account details up to date.' : 'Your details, payout account and nominee.'}
        </p>

        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <div className="profile-section-title">Personal details</div>
            <Field {...ctx} label="Full name" name="name" autoComplete="name" />
            <div className="profile-grid">
              <Field {...ctx} label="Email" name="email" type="email" autoComplete="email" />
              <Field {...ctx} label="City" name="city" autoComplete="address-level2" />
            </div>
            <div className="profile-grid">
              <div className="form-field">
                <label className="form-label-text">Mobile number</label>
                <input className="form-input-text" value={phone} disabled readOnly />
                <div className="field-hint">Used to sign in, so it can't be changed here.</div>
              </div>
              <div className="form-field">
                <label className="form-label-text">KYC status</label>
                <div style={{ paddingTop: '0.4rem' }}>
                  {String(kyc).toLowerCase() === 'verified'
                    ? <span className="badge-pill paid">✓ Verified</span>
                    : <span className="badge-pill due">⏳ {kyc || 'Pending'}</span>}
                </div>
              </div>
            </div>

            {!isAdmin && (
              <>
                <div className="profile-section-title">Payout account <span>(to receive prize or dividend payments)</span></div>
                <Field {...ctx} label="UPI ID" name="upi_id" placeholder="name@bank" hint="Optional if you add a bank account below." autoComplete="off" />
                <Field {...ctx} label="Account holder name" name="bank_account_holder" autoComplete="off" />
                <div className="profile-grid">
                  <Field {...ctx} label="Bank account number" name="bank_account_number" inputMode="numeric" autoComplete="off" />
                  <Field {...ctx} label="IFSC code" name="bank_ifsc" placeholder="HDFC0001234" autoComplete="off" style={{ textTransform: 'uppercase' }} />
                </div>

                <div className="profile-section-title">Nominee</div>
                <div className="profile-grid">
                  <Field {...ctx} label="Nominee name" name="nominee_name" autoComplete="off" />
                  <Field {...ctx} label="Relation" name="nominee_relation">
                    <select id="pf-nominee_relation" className={`form-input-text ${errors.nominee_relation ? 'has-error' : ''}`} value={form.nominee_relation} onChange={set('nominee_relation')}>
                      <option value="">Select…</option>
                      {RELATIONS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </Field>
                </div>
              </>
            )}

            {formError && <div className="profile-form-error" role="alert">{formError}</div>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '1.25rem' }}>
              <button type="button" className="btn btn-outline" onClick={onClose} disabled={saving}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}