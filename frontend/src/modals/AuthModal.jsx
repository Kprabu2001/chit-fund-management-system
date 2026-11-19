import React, { useState } from 'react';
import { api } from '../services/api';
import { sanitizePhoneInput, validatePhone, validatePassword, validateLoginForm } from '../utils/validation';

const DEMO_ACCOUNTS = [
  { label: '👤 Rahul', phone: '9876543210', password: 'rahul', className: 'btn btn-silver btn-sm' },
  { label: '👩 Priya', phone: '9822011223', password: 'priya', className: 'btn btn-silver btn-sm' },
  { label: '🛡️ Admin', phone: '9999988888', password: 'admin', className: 'btn btn-danger btn-sm' }
];

const fieldErrorStyle = { color: 'var(--danger-text)', fontSize: '0.74rem', marginTop: '0.3rem', display: 'block' };

// Sign in / switch account with phone number + password
export default function AuthModal({
  onClose,
  onLoginSuccess,
  onShowToast
}) {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [touched, setTouched] = useState({ phone: false, password: false });
  const [fieldErrors, setFieldErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handlePhoneChange = (value) => {
    const cleaned = sanitizePhoneInput(value);
    setPhone(cleaned);
    setErrorMessage('');
    if (touched.phone) setFieldErrors((prev) => ({ ...prev, phone: validatePhone(cleaned) }));
  };

  const handlePasswordChange = (value) => {
    setPassword(value);
    setErrorMessage('');
    if (touched.password) setFieldErrors((prev) => ({ ...prev, password: validatePassword(value) }));
  };

  const handleBlur = (field) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    setFieldErrors((prev) => ({
      ...prev,
      [field]: field === 'phone' ? validatePhone(phone) : validatePassword(password)
    }));
  };

  const signIn = async (phoneValue, passwordValue) => {
    const errors = validateLoginForm(phoneValue, passwordValue);
    setTouched({ phone: true, password: true });
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setErrorMessage('');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');
    try {
      const res = await api.login(phoneValue, passwordValue);
      onShowToast(`Signed in as ${res.user.name} (${String(res.user.role).toUpperCase()})`, 'success');
      if (onLoginSuccess) onLoginSuccess(res.user);
      onClose();
    } catch (err) {
      if (err.fieldErrors && Object.keys(err.fieldErrors).length > 0) {
        setFieldErrors(err.fieldErrors);
      }
      setErrorMessage(err.message || 'Authentication failed. Please verify your credentials.');
      onShowToast(err.message || 'Invalid credentials.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    signIn(phone, password);
  };

  const handleQuickLogin = (account) => {
    setPhone(account.phone);
    setPassword(account.password);
    signIn(account.phone, account.password);
  };

  const showPhoneError = touched.phone && fieldErrors.phone;
  const showPasswordError = touched.password && fieldErrors.password;

  return (
    <div className="modal-backdrop active" onClick={onClose}>
      <div className="modal-container" style={{ maxWidth: '450px' }} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close-x" onClick={onClose}>✕</button>

        <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
          <div className="brand-symbol" style={{ margin: '0 auto 0.75rem' }}>📱</div>
          <h3 style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-main)' }}>
            Sign In
          </h3>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            Use your mobile number and password
          </p>
        </div>

        {/* Quick Demo Selector */}
        <div style={{
          background: 'var(--bg-input)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-sm)',
          padding: '0.85rem',
          marginBottom: '1.25rem'
        }}>
          <span style={{
            fontSize: '0.72rem',
            textTransform: 'uppercase',
            fontWeight: 700,
            color: 'var(--cyan-400)',
            display: 'block',
            marginBottom: '0.5rem',
            textAlign: 'center'
          }}>
            ⚡ 1-Click Demo Accounts
          </span>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
            {DEMO_ACCOUNTS.map((account) => (
              <button
                key={account.phone}
                type="button"
                className={account.className}
                disabled={isSubmitting}
                onClick={() => handleQuickLogin(account)}
              >
                {account.label}
              </button>
            ))}
          </div>
        </div>

        {errorMessage && (
          <div role="alert" style={{
            background: 'var(--danger-tint)',
            border: '1px solid var(--danger-tint-border)',
            color: 'var(--danger-text)',
            padding: '0.65rem',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.8rem',
            marginBottom: '1rem',
            textAlign: 'center'
          }}>
            ⚠️ {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="form-field">
            <label htmlFor="auth-phone" className="form-label-text">Mobile Number</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <span style={{
                background: 'var(--surface-muted)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '0.65rem 0.85rem',
                color: 'var(--text-secondary)',
                fontSize: '0.9rem',
                display: 'flex',
                alignItems: 'center',
                fontWeight: 600
              }}>
                🇮🇳 +91
              </span>
              <input
                id="auth-phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                className={`form-input-text${showPhoneError ? ' has-error' : ''}`}
                style={{ flex: 1, fontSize: '1rem', letterSpacing: '0.5px' }}
                placeholder="10-digit mobile number"
                value={phone}
                maxLength={10}
                onChange={(e) => handlePhoneChange(e.target.value)}
                onBlur={() => handleBlur('phone')}
                disabled={isSubmitting}
                aria-invalid={Boolean(showPhoneError)}
                autoFocus
              />
            </div>
            {showPhoneError && <span role="alert" style={fieldErrorStyle}>{fieldErrors.phone}</span>}
          </div>

          <div className="form-field">
            <label htmlFor="auth-password" className="form-label-text">Password</label>
            <div style={{ position: 'relative' }}>
              <input
                id="auth-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                className={`form-input-text${showPasswordError ? ' has-error' : ''}`}
                style={{ width: '100%', paddingRight: '4.25rem' }}
                placeholder="Enter your password"
                value={password}
                maxLength={128}
                onChange={(e) => handlePasswordChange(e.target.value)}
                onBlur={() => handleBlur('password')}
                disabled={isSubmitting}
                aria-invalid={Boolean(showPasswordError)}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                style={{
                  position: 'absolute',
                  right: '0.6rem',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--cyan-400)',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            {showPasswordError && <span role="alert" style={fieldErrorStyle}>{fieldErrors.password}</span>}
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', padding: '0.75rem', fontWeight: 700 }}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Signing in...' : '🔐 Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}