import React, { useState } from 'react';
import { api } from '../services/api';
import { sanitizePhoneInput, validatePhone, validatePassword, validateLoginForm } from '../utils/validation';

const DEMO_ACCOUNTS = {
  user: [
    { label: '👤 Rahul (Member)', phone: '9876543210', password: 'rahul' },
    { label: '👩 Priya (Member)', phone: '9822011223', password: 'priya' }
  ],
  admin: [
    { label: '🛡️ Chief Administrator', phone: '9999988888', password: 'admin' }
  ]
};

const fieldErrorStyle = { color: 'var(--danger-text)', fontSize: '0.74rem', marginTop: '0.3rem', display: 'block' };

export default function LoginPage({ onLoginSuccess, onShowToast }) {
  // Selected role: 'user' (Member) or 'admin'
  const [selectedRole, setSelectedRole] = useState('user');

  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [touched, setTouched] = useState({ phone: false, password: false });
  const [fieldErrors, setFieldErrors] = useState({});

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const resetForm = () => {
    setPhone('');
    setPassword('');
    setShowPassword(false);
    setTouched({ phone: false, password: false });
    setFieldErrors({});
    setErrorMessage('');
  };

  const handleSelectRole = (role) => {
    setSelectedRole(role);
    resetForm();
  };

  // Live validation once a field has been touched
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

  const signIn = async (phoneValue, passwordValue, role) => {
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
      const res = await api.login(phoneValue, passwordValue, role);
      onShowToast?.(res.message || `Welcome, ${res.user.name}!`, 'success');
      onLoginSuccess?.(res.user);
    } catch (err) {
      if (err.fieldErrors && Object.keys(err.fieldErrors).length > 0) {
        setFieldErrors(err.fieldErrors);
      }
      setErrorMessage(err.message || 'Login failed. Please try again.');
      onShowToast?.(err.message || 'Login failed.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    signIn(phone, password, selectedRole);
  };

  // 1-Click Fast Login
  const handleQuickDemoClick = (account) => {
    setPhone(account.phone);
    setPassword(account.password);
    signIn(account.phone, account.password, selectedRole);
  };

  const tabStyle = (role, activeColor) => ({
    padding: '0.55rem 0.5rem',
    borderRadius: 'var(--radius-xs)',
    border: 'none',
    background: selectedRole === role ? 'var(--bg-card)' : 'transparent',
    color: selectedRole === role ? activeColor : 'var(--text-secondary)',
    fontWeight: selectedRole === role ? 700 : 500,
    fontSize: '0.85rem',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.35rem',
    boxShadow: selectedRole === role ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
    transition: 'var(--transition-fast)'
  });

  const isAdminTab = selectedRole === 'admin';
  const showPhoneError = touched.phone && fieldErrors.phone;
  const showPasswordError = touched.password && fieldErrors.password;

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '2rem 1rem',
      backgroundColor: 'var(--bg-app)'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '440px',
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-subtle)',
        boxShadow: 'var(--shadow-card)',
        padding: '2.25rem 2rem',
        margin: '0 auto'
      }}>
        {/* Brand Header */}
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--cyan-400)',
            color: '#ffffff',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.5rem',
            marginBottom: '0.75rem'
          }}>
            🎟️
          </div>
          <h1 style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--text-main)', marginBottom: '0.25rem', letterSpacing: '-0.02em' }}>
            KD Chit
          </h1>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Sign in with your mobile number and password
          </p>
        </div>

        {/* Role Selector Tabs */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '0.35rem',
          background: 'var(--surface-muted)',
          padding: '0.3rem',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border-subtle)',
          marginBottom: '1.25rem'
        }}>
          <button type="button" onClick={() => handleSelectRole('user')} style={tabStyle('user', 'var(--cyan-500)')}>
            <span>👤</span>
            <span>Member Login</span>
          </button>
          <button type="button" onClick={() => handleSelectRole('admin')} style={tabStyle('admin', 'var(--danger-text)')}>
            <span>🛡️</span>
            <span>Admin Login</span>
          </button>
        </div>

        {/* Quick Demo 1-Click Buttons */}
        <div style={{
          background: 'var(--surface-subtle)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-sm)',
          padding: '0.75rem',
          marginBottom: '1.25rem'
        }}>
          <div style={{
            fontSize: '0.7rem',
            textTransform: 'uppercase',
            fontWeight: 700,
            color: isAdminTab ? 'var(--rose-400)' : 'var(--cyan-500)',
            marginBottom: '0.45rem',
            textAlign: 'center',
            letterSpacing: '0.04em'
          }}>
            ⚡ 1-Click Demo Login
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: isAdminTab ? '1fr' : '1fr 1fr', gap: '0.4rem' }}>
            {DEMO_ACCOUNTS[selectedRole].map((account) => (
              <button
                key={account.phone}
                type="button"
                className="btn btn-outline btn-sm"
                style={{
                  width: '100%',
                  fontSize: '0.78rem',
                  padding: '0.45rem 0.35rem',
                  justifyContent: 'center',
                  ...(isAdminTab ? { color: 'var(--danger-text)', borderColor: 'var(--danger-tint-border)' } : {})
                }}
                disabled={isSubmitting}
                onClick={() => handleQuickDemoClick(account)}
              >
                {account.label}
              </button>
            ))}
          </div>
        </div>

        {/* Server / credentials error */}
        {errorMessage && (
          <div role="alert" style={{
            background: 'var(--danger-tint)',
            border: '1px solid var(--danger-tint-border)',
            color: 'var(--danger-text)',
            padding: '0.6rem 0.75rem',
            borderRadius: 'var(--radius-xs)',
            fontSize: '0.8rem',
            marginBottom: '1rem',
            textAlign: 'center'
          }}>
            ⚠️ {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          {/* Phone number */}
          <div className="form-field" style={{ marginBottom: '1rem' }}>
            <label htmlFor="login-phone" className="form-label-text" style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '0.4rem', display: 'block' }}>
              {isAdminTab ? 'Administrator Mobile Number' : 'Mobile Number'}
            </label>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <span style={{
                background: 'var(--surface-subtle)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '0.65rem 0.75rem',
                color: 'var(--text-secondary)',
                fontSize: '0.9rem',
                display: 'flex',
                alignItems: 'center',
                fontWeight: 600
              }}>
                🇮🇳 +91
              </span>
              <input
                id="login-phone"
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

          {/* Password */}
          <div className="form-field" style={{ marginBottom: '1rem' }}>
            <label htmlFor="login-password" className="form-label-text" style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '0.4rem', display: 'block' }}>
              Password
            </label>
            <div style={{ position: 'relative' }}>
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                className={`form-input-text${showPasswordError ? ' has-error' : ''}`}
                style={{ width: '100%', fontSize: '1rem', paddingRight: '4.25rem' }}
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
                  color: 'var(--cyan-500)',
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
            className={isAdminTab ? 'btn btn-danger' : 'btn btn-primary'}
            style={{ width: '100%', padding: '0.75rem', fontWeight: 700, fontSize: '0.9rem', marginTop: '0.5rem' }}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Signing in...' : (isAdminTab ? 'Sign In as Admin' : 'Sign In')}
          </button>
        </form>
      </div>
    </div>
  );
}