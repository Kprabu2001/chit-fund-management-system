import React, { useState, useEffect, useRef } from 'react';
import confetti from 'canvas-confetti';
import { api } from '../services/api';
import { formatINR } from '../data/initialData';
import { formatTicketId } from '../utils/format';

export default function PaymentModal({
  payment,
  onClose,
  onPaymentVerified,
  onViewReceipt
}) {
  const [loading, setLoading] = useState(true);
  const [qrData, setQrData] = useState(null);
  const [paymentStatus, setPaymentStatus] = useState('PENDING'); // PENDING | SUCCESS | EXPIRED | FAILED
  const [errorMessage, setErrorMessage] = useState(null);
  const [secondsRemaining, setSecondsRemaining] = useState(900); // 15 mins default
  const [isCheckingManual, setIsCheckingManual] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [settledResult, setSettledResult] = useState(null);

  const pollIntervalRef = useRef(null);
  const countdownIntervalRef = useRef(null);

  if (!payment) return null;

  const netPayable = payment.netPayable ?? payment.net_payable ?? 0;
  const schemeName = payment.schemeName || payment.scheme_name || 'Chit Fund Scheme';
  const monthName = payment.monthName || payment.month_name || 'Installment';
  const ticketId = payment.ticketId || payment.ticket_id || '';

  // Initialize Dynamic Razorpay QR Code
  const loadQRCode = async () => {
    setLoading(true);
    setErrorMessage(null);
    setPaymentStatus('PENDING');

    try {
      const res = await api.createPaymentQR(payment.id);
      const qr = res.qrCode;
      setQrData(qr);

      // Compute seconds remaining from close_by
      if (qr?.close_by) {
        const nowSec = Math.floor(Date.now() / 1000);
        const diff = qr.close_by - nowSec;
        setSecondsRemaining(Math.max(10, diff));
      } else {
        setSecondsRemaining(900);
      }
    } catch (err) {
      console.error('Failed to create Razorpay QR:', err);
      setErrorMessage(err.message || 'Unable to generate dynamic UPI QR code. Please try again.');
      setPaymentStatus('FAILED');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadQRCode();

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    };
  }, [payment.id]);

  // Expiry Countdown Timer
  useEffect(() => {
    if (paymentStatus !== 'PENDING') {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
      return;
    }

    countdownIntervalRef.current = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(countdownIntervalRef.current);
          setPaymentStatus('EXPIRED');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    };
  }, [paymentStatus]);

  // Check Status Helper
  const checkStatus = async (isManual = false) => {
    if (!qrData?.id || paymentStatus === 'SUCCESS') return;

    if (isManual) setIsCheckingManual(true);
    try {
      const statusRes = await api.getQRStatus(payment.id, qrData.id);

      if (statusRes.isPaid) {
        setPaymentStatus('SUCCESS');
        setSettledResult(statusRes);
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

        try {
          confetti({
            particleCount: 120,
            spread: 80,
            origin: { y: 0.55 }
          });
        } catch (e) {}

        if (onPaymentVerified) {
          onPaymentVerified(statusRes.payment, statusRes.receipt);
        }
      } else if (statusRes.isExpired) {
        setPaymentStatus('EXPIRED');
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      }
    } catch (err) {
      if (isManual) {
        setErrorMessage('Status check failed: ' + (err.message || 'Network error'));
      }
    } finally {
      if (isManual) setIsCheckingManual(false);
    }
  };

  // Automated Polling Loop (every 3.5 seconds)
  useEffect(() => {
    if (paymentStatus === 'PENDING' && qrData?.id) {
      pollIntervalRef.current = setInterval(() => {
        checkStatus(false);
      }, 3500);
    } else {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    }

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [paymentStatus, qrData?.id]);

  // Test Mode Simulator
  const handleSimulatePayment = async () => {
    if (isSimulating || !qrData?.id) return;
    setIsSimulating(true);
    setErrorMessage(null);

    try {
      const simRes = await api.simulateTestPayment(payment.id, qrData.id);
      setPaymentStatus('SUCCESS');
      setSettledResult(simRes);
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

      try {
        confetti({
          particleCount: 120,
          spread: 80,
          origin: { y: 0.55 }
        });
      } catch (e) {}

      if (onPaymentVerified) {
        onPaymentVerified(simRes.payment, simRes.receipt);
      }
    } catch (err) {
      setErrorMessage(err.message || 'Failed to simulate test payment.');
    } finally {
      setIsSimulating(false);
    }
  };

  // Format seconds to MM:SS
  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="modal-backdrop active" onClick={onClose}>
      <div
        className="modal-container"
        style={{ maxWidth: '480px', width: '92%' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal-close-x" onClick={onClose}>✕</button>

        {/* Modal Header */}
        <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', background: 'var(--accent-tint-soft)', border: '1px solid var(--accent-tint-border)', padding: '0.3rem 0.75rem', borderRadius: '100px', fontSize: '0.75rem', color: 'var(--cyan-400)', fontWeight: 700, marginBottom: '0.5rem' }}>
            <span>⚡ Razorpay Dynamic UPI QR</span>
          </div>
          <h3 style={{ fontSize: '1.28rem', fontWeight: 800, color: 'var(--text-main)', margin: 0 }}>
            {schemeName}
          </h3>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '3px' }}>
            {monthName} Installment • Ticket <span style={{ color: 'var(--cyan-400)', fontWeight: 700 }}>{formatTicketId(ticketId, payment.schemeName || payment.scheme_name)}</span>
          </p>
        </div>

        {/* Amount Breakdown Card */}
        <div style={{
          background: 'var(--bg-input)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-sm)',
          padding: '0.85rem 1rem',
          marginBottom: '1rem'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '0.3rem' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Base Installment:</span>
            <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>
              {formatINR(payment.baseAmount ?? payment.base_amount)}
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '0.4rem' }}>
            <span style={{ color: 'var(--emerald-400)' }}>Less: Auction Dividend Shared:</span>
            <span style={{ fontWeight: 700, color: 'var(--emerald-400)' }}>
              -{formatINR(payment.dividendDiscount ?? payment.dividend_discount ?? 0)}
            </span>
          </div>

          <div style={{
            borderTop: '1px dashed var(--border-subtle)',
            paddingTop: '0.45rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span style={{ fontWeight: 700, color: 'var(--text-main)', fontSize: '0.92rem' }}>Net Amount Payable:</span>
            <span style={{
              fontSize: '1.45rem',
              fontWeight: 800,
              color: 'var(--cyan-400)',
              fontFamily: 'var(--font-heading)',
              letterSpacing: '-0.02em'
            }}>
              {formatINR(netPayable)}
            </span>
          </div>
        </div>

        {/* Error Alert if any */}
        {errorMessage && (
          <div style={{
            background: 'var(--danger-tint)',
            border: '1px solid var(--danger-tint-border)',
            borderRadius: 'var(--radius-sm)',
            padding: '0.65rem 0.85rem',
            marginBottom: '1rem',
            fontSize: '0.8rem',
            color: 'var(--danger-text)',
            textAlign: 'center'
          }}>
            ⚠️ {errorMessage}
          </div>
        )}

        {/* State 1: SUCCESS State */}
        {paymentStatus === 'SUCCESS' && (
          <div style={{ textAlign: 'center', padding: '1rem 0' }}>
            <div style={{
              width: '68px',
              height: '68px',
              borderRadius: '50%',
              background: 'var(--ok-tint)',
              border: '2px solid var(--emerald-400)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '2rem',
              color: 'var(--emerald-400)',
              margin: '0 auto 1rem'
            }}>
              ✓
            </div>

            <h4 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--emerald-400)', marginBottom: '0.35rem' }}>
              Payment Verified & Settled!
            </h4>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
              Your installment of <strong style={{ color: 'var(--text-main)' }}>{formatINR(netPayable)}</strong> has been verified via Razorpay UPI and credited to your ticket passbook.
            </p>

            <div style={{
              background: 'var(--ok-tint)',
              border: '1px solid var(--ok-tint-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '0.75rem',
              fontSize: '0.8rem',
              textAlign: 'left',
              marginBottom: '1.25rem'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Transaction Reference:</span>
                <span style={{ color: 'var(--text-main)', fontWeight: 600 }}>
                  {settledResult?.receipt?.transactionRef || settledResult?.payment?.transactionRef || 'Verified'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Official Receipt #:</span>
                <span style={{ color: 'var(--cyan-400)', fontWeight: 700 }}>
                  {settledResult?.receipt?.receiptNumber || settledResult?.payment?.receiptNumber || 'Generated'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Status:</span>
                <span style={{ color: 'var(--emerald-400)', fontWeight: 700 }}>✓ Verified (Settled)</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {onViewReceipt && (
                <button
                  className="btn btn-silver"
                  style={{ flex: 1 }}
                  onClick={() => {
                    const r = settledResult?.receipt || settledResult?.payment;
                    if (r) onViewReceipt(r);
                    onClose();
                  }}
                >
                  📄 View Official Receipt
                </button>
              )}
              <button
                className="btn btn-outline"
                style={{ flex: 1 }}
                onClick={onClose}
              >
                Done
              </button>
            </div>
          </div>
        )}

        {/* State 2: EXPIRED State */}
        {paymentStatus === 'EXPIRED' && (
          <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>⌛</div>
            <h4 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--rose-400)', marginBottom: '0.35rem' }}>
              UPI QR Code Expired
            </h4>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
              For your financial security, dynamic QR codes are time-limited to 15 minutes. Generate a fresh QR session to complete your payment.
            </p>
            <button
              className="btn btn-silver"
              style={{ width: '100%', fontWeight: 700 }}
              onClick={loadQRCode}
            >
              🔄 Generate Fresh QR Code
            </button>
          </div>
        )}

        {/* State 3: FAILED State */}
        {paymentStatus === 'FAILED' && (
          <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>⚠️</div>
            <h4 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--rose-400)', marginBottom: '0.35rem' }}>
              Unable to Load QR Code
            </h4>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
              {errorMessage || 'Check your connection or backend server status.'}
            </p>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                className="btn btn-outline"
                style={{ flex: 1 }}
                onClick={onClose}
              >
                Close
              </button>
              <button
                className="btn btn-silver"
                style={{ flex: 2, fontWeight: 700 }}
                onClick={loadQRCode}
              >
                🔄 Retry QR Generation
              </button>
            </div>
          </div>
        )}

        {/* State 4: PENDING / SCAN & PAY State */}
        {paymentStatus === 'PENDING' && (
          <>
            {/* Loading Indicator */}
            {loading ? (
              <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
                <div className="spinner" style={{ margin: '0 auto 1rem' }}></div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                  Generating secure Razorpay Dynamic UPI QR...
                </div>
              </div>
            ) : (
              <>
                {/* QR Code Container */}
                <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
                  <div style={{
                    background: '#ffffff',
                    padding: '12px',
                    borderRadius: '12px',
                    display: 'inline-block',
                    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
                    border: '3px solid var(--accent-tint-border)'
                  }}>
                    {qrData?.image_url || qrData?.imageUrl ? (
                      <img
                        src={qrData.image_url || qrData.imageUrl}
                        alt="Dynamic Razorpay UPI QR"
                        style={{
                          width: '210px',
                          height: '210px',
                          display: 'block',
                          imageRendering: 'crisp-edges'
                        }}
                      />
                    ) : (
                      <div style={{ width: '210px', height: '210px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#333' }}>
                        Loading QR...
                      </div>
                    )}
                  </div>

                  {/* Supported UPI Apps Row */}
                  <div style={{
                    display: 'flex',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    flexWrap: 'wrap',
                    marginTop: '0.65rem'
                  }}>
                    {['Google Pay', 'PhonePe', 'Paytm', 'BHIM', 'CRED'].map((appName) => (
                      <span
                        key={appName}
                        style={{
                          fontSize: '0.68rem',
                          background: 'var(--surface-muted)',
                          color: 'var(--text-secondary)',
                          padding: '0.2rem 0.5rem',
                          borderRadius: '4px',
                          border: '1px solid var(--border-subtle)'
                        }}
                      >
                        {appName}
                      </span>
                    ))}
                  </div>

                  {/* Direct Mobile UPI Intent Link Button */}
                  {(qrData?.upi_intent_url || qrData?.upiIntentUrl) && (
                    <div style={{ marginTop: '0.65rem' }}>
                      <a
                        href={qrData.upi_intent_url || qrData.upiIntentUrl}
                        className="btn btn-outline btn-sm"
                        style={{
                          fontSize: '0.76rem',
                          padding: '0.35rem 0.75rem',
                          color: 'var(--cyan-400)',
                          borderColor: 'var(--accent-tint-border)'
                        }}
                      >
                        📱 Open in Phone UPI App
                      </a>
                    </div>
                  )}
                </div>

                {/* Live Polling Status & Timer Bar */}
                <div style={{
                  background: 'var(--accent-tint-soft)',
                  border: '1px solid var(--accent-tint-soft)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '0.65rem 0.85rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '1rem'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: 'var(--cyan-400)',
                        boxShadow: '0 0 8px var(--cyan-400)',
                        animation: 'pulse 1.8s infinite'
                      }}
                    />
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                      Waiting for UPI payment confirmation...
                    </span>
                  </div>

                  <div style={{
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    color: secondsRemaining < 120 ? 'var(--rose-400)' : 'var(--cyan-400)',
                    fontFamily: 'monospace'
                  }}>
                    ⏱️ {formatTime(secondsRemaining)}
                  </div>
                </div>

                {/* Action Buttons */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <button
                    className="btn btn-silver"
                    style={{ width: '100%', fontWeight: 700 }}
                    onClick={() => checkStatus(true)}
                    disabled={isCheckingManual || isSimulating}
                  >
                    {isCheckingManual ? 'Checking Razorpay Server...' : '🔄 Check Payment Status Now'}
                  </button>

                  {/* Test Mode Simulator Button */}
                  <button
                    type="button"
                    className="btn btn-outline"
                    style={{
                      width: '100%',
                      fontSize: '0.78rem',
                      borderColor: 'var(--warn-tint-border)',
                      color: 'var(--amber-400)'
                    }}
                    onClick={handleSimulatePayment}
                    disabled={isSimulating || isCheckingManual}
                  >
                    {isSimulating ? 'Processing Test Settlement...' : '⚡ Simulate Test UPI Payment (Razorpay Test Mode)'}
                  </button>

                  <button
                    className="btn btn-outline"
                    style={{ width: '100%', fontSize: '0.8rem', opacity: 0.8 }}
                    onClick={onClose}
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}