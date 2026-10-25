import React, { useState, useEffect } from 'react';
import { api } from '../services/api';

export default function LoginPage({ onLoginSuccess, onShowToast }) {
  // Selected role: 'user' (Member) or 'admin'
  const [selectedRole, setSelectedRole] = useState('user');

  // Phone OTP state
  const [step, setStep] = useState('phone'); // 'phone' | 'otp'
  const [phone, setPhone] = useState('9876543210');
  const [otp, setOtp] = useState('');
  const [demoOtpHint, setDemoOtpHint] = useState('');
  const [isOffline, setIsOffline] = useState(false);
  const [countdown, setCountdown] = useState(0);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Update phone defaults when switching role tabs
  const handleSelectRole = (role) => {
    setSelectedRole(role);
    setStep('phone');
    setOtp('');
    setErrorMessage('');
    if (role === 'admin') {
      setPhone('9999988888');
    } else {
      setPhone('9876543210');
    }
  };

  // 30s Countdown timer for OTP resend
  useEffect(() => {
    let timer;
    if (countdown > 0) {
      timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [countdown]);

  // Send OTP
  const handleSendOtp = async (targetPhone = phone) => {
    if (!targetPhone || targetPhone.trim().length < 10) {
      setErrorMessage('Please enter a valid 10-digit mobile number.');
      return;
    }
    setIsSubmitting(true);
    setErrorMessage('');
    try {
      const res = await api.sendOtp(targetPhone);
      setStep('otp');
      setCountdown(30);
      setIsOffline(Boolean(res.is_offline));
      if (res.demo_otp) {
        setDemoOtpHint(res.demo_otp);
        setOtp(res.demo_otp); // auto-fill for frictionless testing
      }
      onShowToast?.(res.message || 'OTP sent successfully!', 'success');
    } catch (err) {
      setErrorMessage(err.message || 'Failed to dispatch SMS OTP. Verify phone number.');
      onShowToast?.(err.message || 'Failed to send OTP.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Verify OTP
  const handleVerifyOtp = async (e) => {
    if (e) e.preventDefault();
    if (!otp || otp.trim().length !== 6) {
      setErrorMessage('Please enter the 6-digit OTP code.');
      return;
    }
    setIsSubmitting(true);
    setErrorMessage('');
    try {
      const res = await api.verifyOtp(phone, otp.trim());
      onShowToast?.(res.message || `Welcome, ${res.user.name}!`, 'success');
      onLoginSuccess?.(res.user);
    } catch (err) {
      setErrorMessage(err.message || 'Invalid or expired OTP code.');
      onShowToast?.(err.message || 'Verification failed.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 1-Click Fast Login Trigger
  const handleQuickDemoClick = (demoPhone, role) => {
    setSelectedRole(role);
    setPhone(demoPhone);
    setOtp('');
    handleSendOtp(demoPhone);
  };

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
            Sign in with your mobile number to access your passbook
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
          <button
            type="button"
            onClick={() => handleSelectRole('user')}
            style={{
              padding: '0.55rem 0.5rem',
              borderRadius: 'var(--radius-xs)',
              border: 'none',
              background: selectedRole === 'user' ? 'var(--bg-card)' : 'transparent',
              color: selectedRole === 'user' ? 'var(--cyan-500)' : 'var(--text-secondary)',
              fontWeight: selectedRole === 'user' ? 700 : 500,
              fontSize: '0.85rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.35rem',
              boxShadow: selectedRole === 'user' ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
              transition: 'var(--transition-fast)'
            }}
          >
            <span>👤</span>
            <span>Member Login</span>
          </button>
          <button
            type="button"
            onClick={() => handleSelectRole('admin')}
            style={{
              padding: '0.55rem 0.5rem',
              borderRadius: 'var(--radius-xs)',
              border: 'none',
              background: selectedRole === 'admin' ? 'var(--bg-card)' : 'transparent',
              color: selectedRole === 'admin' ? 'var(--danger-text)' : 'var(--text-secondary)',
              fontWeight: selectedRole === 'admin' ? 700 : 500,
              fontSize: '0.85rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.35rem',
              boxShadow: selectedRole === 'admin' ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
              transition: 'var(--transition-fast)'
            }}
          >
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
            color: selectedRole === 'admin' ? 'var(--rose-400)' : 'var(--cyan-500)',
            marginBottom: '0.45rem',
            textAlign: 'center',
            letterSpacing: '0.04em'
          }}>
            ⚡ 1-Click Demo Login
          </div>

          {selectedRole === 'user' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                style={{ fontSize: '0.78rem', padding: '0.45rem 0.35rem', justifyContent: 'center' }}
                disabled={isSubmitting}
                onClick={() => handleQuickDemoClick('9876543210', 'user')}
              >
                👤 Rahul (Member)
              </button>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                style={{ fontSize: '0.78rem', padding: '0.45rem 0.35rem', justifyContent: 'center' }}
                disabled={isSubmitting}
                onClick={() => handleQuickDemoClick('9822011223', 'user')}
              >
                👩 Priya (Member)
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-outline btn-sm"
              style={{ width: '100%', fontSize: '0.78rem', padding: '0.45rem 0.35rem', justifyContent: 'center', color: 'var(--danger-text)', borderColor: 'var(--danger-tint-border)' }}
              disabled={isSubmitting}
              onClick={() => handleQuickDemoClick('9999988888', 'admin')}
            >
              🛡️ Chief Administrator
            </button>
          )}
        </div>

        {/* Error Message */}
        {errorMessage && (
          <div style={{
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

        {/* Mobile Number Step */}
        {step === 'phone' ? (
          <form onSubmit={(e) => { e.preventDefault(); handleSendOtp(); }}>
            <div className="form-field" style={{ marginBottom: '1rem' }}>
              <label className="form-label-text" style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '0.4rem', display: 'block' }}>
                {selectedRole === 'admin' ? 'Administrator Mobile Number' : 'Subscriber Mobile Number'}
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
                  type="tel"
                  className="form-input-text"
                  style={{ flex: 1, fontSize: '1rem', letterSpacing: '0.5px' }}
                  placeholder="Enter 10-digit mobile number"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  disabled={isSubmitting}
                  required
                  autoFocus
                />
              </div>
            </div>

            <button
              type="submit"
              className={selectedRole === 'admin' ? 'btn btn-danger' : 'btn btn-primary'}
              style={{ width: '100%', padding: '0.75rem', fontWeight: 700, fontSize: '0.9rem', marginTop: '0.5rem' }}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Sending OTP...' : 'Send OTP'}
            </button>
          </form>
        ) : (
          /* OTP Verification Step */
          <form onSubmit={handleVerifyOtp}>
            <div style={{
              background: 'var(--accent-tint-soft)',
              border: '1px solid var(--accent-tint-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '0.65rem 0.85rem',
              marginBottom: '1rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>OTP sent to:</span>
                <strong style={{ color: 'var(--text-main)', fontSize: '0.9rem' }}>+91 {phone}</strong>
              </div>
              <button
                type="button"
                style={{ background: 'transparent', border: 'none', color: 'var(--cyan-500)', fontSize: '0.8rem', cursor: 'pointer', textDecoration: 'underline', fontWeight: 600 }}
                onClick={() => { setStep('phone'); setErrorMessage(''); }}
              >
                Change
              </button>
            </div>

            {demoOtpHint && (
              <div
                style={{
                  background: 'var(--ok-tint)',
                  border: '1px solid var(--ok-tint-border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '0.6rem',
                  marginBottom: '1rem',
                  textAlign: 'center',
                  cursor: 'pointer'
                }}
                onClick={() => setOtp(demoOtpHint)}
                title="Click to auto-fill"
              >
                <span style={{ fontSize: '0.7rem', color: 'var(--ok-text)', display: 'block', fontWeight: 600 }}>
                  📩 Received OTP:
                </span>
                <span style={{ color: 'var(--ok-text)', fontSize: '1.3rem', letterSpacing: '6px', fontWeight: 800 }}>
                  {demoOtpHint}
                </span>
                <span style={{ fontSize: '0.68rem', color: 'var(--ok-text)', display: 'block', marginTop: '0.15rem' }}>
                  (Click to auto-fill)
                </span>
              </div>
            )}

            <div className="form-field" style={{ marginBottom: '1rem' }}>
              <label className="form-label-text" style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '0.4rem', display: 'block' }}>
                Enter 6-Digit OTP Code
              </label>
              <input
                type="text"
                maxLength={6}
                className="form-input-text"
                style={{
                  textAlign: 'center',
                  fontSize: '1.4rem',
                  letterSpacing: '8px',
                  fontWeight: 700,
                  color: 'var(--cyan-500)'
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
              <span style={{ color: 'var(--text-muted)' }}>Didn't receive OTP?</span>
              {countdown > 0 ? (
                <span style={{ color: 'var(--text-secondary)' }}>Resend in {countdown}s</span>
              ) : (
                <button
                  type="button"
                  style={{ background: 'transparent', border: 'none', color: 'var(--cyan-500)', cursor: 'pointer', fontWeight: 600 }}
                  onClick={() => handleSendOtp(phone)}
                  disabled={isSubmitting}
                >
                  Resend OTP
                </button>
              )}
            </div>

            <button
              type="submit"
              className={selectedRole === 'admin' ? 'btn btn-danger' : 'btn btn-primary'}
              style={{ width: '100%', padding: '0.75rem', fontWeight: 700, fontSize: '0.9rem' }}
              disabled={isSubmitting || otp.length !== 6}
            >
              {isSubmitting ? 'Verifying...' : `Verify & Sign In`}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}