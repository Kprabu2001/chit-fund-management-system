import React, { useState, useEffect } from 'react';
import { api } from '../services/api';

export default function AuthModal({
  currentUser,
  onClose,
  onLoginSuccess,
  onShowToast
}) {
  const [authMode, setAuthMode] = useState('otp'); // 'otp' or 'password'
  
  // OTP Flow State
  const [step, setStep] = useState('phone'); // 'phone' | 'otp'
  const [phone, setPhone] = useState(currentUser?.phone || '+91 98765 43210');
  const [otp, setOtp] = useState('');
  const [demoOtpHint, setDemoOtpHint] = useState('');
  const [isOffline, setIsOffline] = useState(false);
  const [countdown, setCountdown] = useState(0);
  
  // Password Fallback State
  const [email, setEmail] = useState(currentUser?.email || 'user@auctionticket.com');
  const [password, setPassword] = useState('user123');
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Countdown timer for OTP resend cooldown
  useEffect(() => {
    let timer;
    if (countdown > 0) {
      timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [countdown]);

  // Handle Step 1: Send OTP
  const handleSendOtp = async (targetPhone = phone) => {
    setIsSubmitting(true);
    setErrorMessage('');
    try {
      const res = await api.sendOtp(targetPhone);
      setStep('otp');
      setCountdown(30);
      setIsOffline(Boolean(res.is_offline));
      if (res.demo_otp) {
        setDemoOtpHint(res.demo_otp);
        setOtp(res.demo_otp); // Auto-fill for convenience
      }
      onShowToast(res.message || 'OTP sent successfully via SMS!', 'success');
    } catch (err) {
      setErrorMessage(err.message || 'Failed to send OTP via SMS. Verify phone number.');
      onShowToast(err.message || 'Failed to dispatch SMS.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Step 2: Verify OTP
  const handleVerifyOtp = async (e) => {
    if (e) e.preventDefault();
    if (!otp || otp.trim().length !== 6) {
      setErrorMessage('Please enter the 6-digit OTP received via SMS.');
      return;
    }
    setIsSubmitting(true);
    setErrorMessage('');
    try {
      const res = await api.verifyOtp(phone, otp.trim());
      onShowToast(res.message || `Signed in as ${res.user.name}!`, 'success');
      if (onLoginSuccess) {
        onLoginSuccess(res.user);
      }
      onClose();
    } catch (err) {
      setErrorMessage(err.message || 'Invalid or expired OTP code.');
      onShowToast(err.message || 'Verification failed.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Quick 1-Click Phone Demo Trigger
  const triggerQuickPhoneLogin = (demoPhone) => {
    setPhone(demoPhone);
    setOtp('');
    handleSendOtp(demoPhone);
  };

  // Legacy Password Submission
  const handlePasswordLogin = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMessage('');
    try {
      const res = await api.login(email, password);
      onShowToast(`Signed in successfully as ${res.user.name} (${res.user.role.toUpperCase()})`, 'success');
      if (onLoginSuccess) {
        onLoginSuccess(res.user);
      }
      onClose();
    } catch (err) {
      setErrorMessage(err.message || 'Authentication failed. Please verify credentials.');
      onShowToast(err.message || 'Invalid credentials.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop active" onClick={onClose}>
      <div className="modal-container" style={{ maxWidth: '450px' }} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close-x" onClick={onClose}>✕</button>

        <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
          <div className="brand-symbol" style={{ margin: '0 auto 0.75rem' }}>📱</div>
          <h3 style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-main)' }}>
            {authMode === 'otp' ? 'Phone SMS OTP Verification' : 'Password Sign In'}
          </h3>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            {authMode === 'otp'
              ? 'Passwordless, instant SMS authentication for subscribers & organizers'
              : 'Direct credential sign in with DRF Token'}
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
            ⚡ 1-Click Pre-Seeded Accounts (SMS OTP Simulation)
          </span>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
            <button
              type="button"
              className="btn btn-silver btn-sm"
              disabled={isSubmitting}
              onClick={() => triggerQuickPhoneLogin('+91 98765 43210')}
            >
              👤 Rahul (98765 43210)
            </button>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={isSubmitting}
              onClick={() => triggerQuickPhoneLogin('+91 99999 88888')}
            >
              🛡️ Admin (99999 88888)
            </button>
          </div>
        </div>

        {errorMessage && (
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
            ⚠️ {errorMessage}
          </div>
        )}

        {authMode === 'otp' ? (
          <div>
            {step === 'phone' ? (
              <form onSubmit={(e) => { e.preventDefault(); handleSendOtp(); }}>
                <div className="form-field">
                  <label className="form-label-text">Mobile Phone Number</label>
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
                      type="tel"
                      className="form-input-text"
                      style={{ flex: 1, fontSize: '1rem', letterSpacing: '0.5px' }}
                      placeholder="98765 43210"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      disabled={isSubmitting}
                      required
                      autoFocus
                    />
                  </div>
                  <small style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.35rem', display: 'block' }}>
                    Standard 10-digit Indian mobile number. An OTP will be dispatched via SMS.
                  </small>
                </div>

                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ width: '100%', padding: '0.75rem', fontWeight: 700, marginTop: '0.5rem' }}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Sending SMS...' : '📲 Send Verification OTP via SMS'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleVerifyOtp}>
                <div style={{
                  background: 'var(--accent-tint-soft)',
                  border: '1px solid var(--accent-tint-border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '0.75rem',
                  marginBottom: '1rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block' }}>OTP sent via SMS to:</span>
                    <strong style={{ color: 'var(--text-main)', fontSize: '0.95rem' }}>{phone}</strong>
                  </div>
                  <button
                    type="button"
                    style={{ background: 'transparent', border: 'none', color: 'var(--cyan-400)', fontSize: '0.8rem', cursor: 'pointer', textDecoration: 'underline' }}
                    onClick={() => { setStep('phone'); setErrorMessage(''); }}
                  >
                    Change Number
                  </button>
                </div>

                {isOffline && (
                  <div style={{
                    background: 'var(--warn-tint)',
                    border: '1px solid var(--warn-tint-border)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '0.45rem 0.65rem',
                    marginBottom: '0.85rem',
                    fontSize: '0.74rem',
                    color: 'var(--warn-text)',
                    textAlign: 'center'
                  }}>
                    ⚡ Backend server offline. Verified in Local Simulation Mode.
                  </div>
                )}

                {demoOtpHint && (
                  <div style={{
                    background: 'var(--ok-tint)',
                    border: '1px solid var(--ok-tint-border)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '0.65rem',
                    marginBottom: '1rem',
                    textAlign: 'center',
                    cursor: 'pointer'
                  }} onClick={() => setOtp(demoOtpHint)}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--emerald-400)', display: 'block', fontWeight: 600 }}>
                      📩 Simulated SMS Received
                    </span>
                    <span style={{ color: 'var(--text-main)', fontSize: '1.1rem', letterSpacing: '4px', fontWeight: 800 }}>
                      {demoOtpHint}
                    </span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginTop: '0.2rem' }}>
                      (Click to auto-fill)
                    </span>
                  </div>
                )}

                <div className="form-field">
                  <label className="form-label-text">Enter 6-Digit SMS Verification Code</label>
                  <input
                    type="text"
                    maxLength={6}
                    className="form-input-text"
                    style={{
                      textAlign: 'center',
                      fontSize: '1.35rem',
                      letterSpacing: '8px',
                      fontWeight: 700,
                      color: 'var(--cyan-400)'
                    }}
                    placeholder="••••••"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                    disabled={isSubmitting}
                    required
                    autoFocus
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', fontSize: '0.78rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Didn't receive code?</span>
                  {countdown > 0 ? (
                    <span style={{ color: 'var(--text-secondary)' }}>Resend in {countdown}s</span>
                  ) : (
                    <button
                      type="button"
                      style={{ background: 'transparent', border: 'none', color: 'var(--cyan-400)', cursor: 'pointer', fontWeight: 600 }}
                      onClick={() => handleSendOtp(phone)}
                      disabled={isSubmitting}
                    >
                      Resend SMS OTP
                    </button>
                  )}
                </div>

                <button
                  type="submit"
                  className="btn btn-silver"
                  style={{ width: '100%', padding: '0.75rem', fontWeight: 700 }}
                  disabled={isSubmitting || otp.length !== 6}
                >
                  {isSubmitting ? 'Verifying OTP...' : '✓ Verify OTP & Sign In'}
                </button>
              </form>
            )}

            <div style={{ textAlign: 'center', marginTop: '1.25rem', borderTop: '1px solid var(--border-subtle)', paddingTop: '0.85rem' }}>
              <button
                type="button"
                style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', fontSize: '0.78rem', cursor: 'pointer' }}
                onClick={() => { setAuthMode('password'); setErrorMessage(''); }}
              >
                Prefer Password Login? <span style={{ color: 'var(--cyan-400)', textDecoration: 'underline' }}>Sign in with Email</span>
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handlePasswordLogin}>
            <div className="form-field">
              <label className="form-label-text">Email Address</label>
              <input
                type="email"
                className="form-input-text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isSubmitting}
                required
              />
            </div>
            <div className="form-field">
              <label className="form-label-text">Password</label>
              <input
                type="password"
                className="form-input-text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isSubmitting}
                required
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', padding: '0.75rem', fontWeight: 700 }}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Authenticating...' : '🔐 Sign In with Password'}
            </button>

            <div style={{ textAlign: 'center', marginTop: '1.25rem', borderTop: '1px solid var(--border-subtle)', paddingTop: '0.85rem' }}>
              <button
                type="button"
                style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', fontSize: '0.78rem', cursor: 'pointer' }}
                onClick={() => { setAuthMode('otp'); setErrorMessage(''); setStep('phone'); }}
              >
                ← Back to <span style={{ color: 'var(--cyan-400)', textDecoration: 'underline' }}>Phone Number Login with SMS OTP</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}