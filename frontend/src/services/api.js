import { INITIAL_TIERS, INITIAL_SCHEMES, INITIAL_USERS, INITIAL_TICKETS, INITIAL_PAYMENTS } from '../data/initialData';

const BASE_URL = import.meta.env.VITE_API_URL || '/api';
const TOKEN_KEY = 'ats_auth_token';
const CURRENT_USER_KEY = 'ats_react_current_user';

// Global 401 handler: a stale/invalid token must never leave the UI half-logged-in.
if (typeof window !== 'undefined' && !window.__atsFetchPatched) {
  window.__atsFetchPatched = true;
  const origFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const res = await origFetch(...args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
      if (res.status === 401 && url.startsWith(BASE_URL) && !url.includes('/auth/')) {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(CURRENT_USER_KEY);
        window.dispatchEvent(new Event('ats:unauthorized'));
      }
    } catch (e) {}
    return res;
  };
}

const getToken = () => {
  return localStorage.getItem(TOKEN_KEY);
};

const setToken = (t) => {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
};

const getHeaders = (extraHeaders = {}) => {
  const headers = { 'Content-Type': 'application/json', ...extraHeaders };
  const token = getToken();
  if (token) {
    headers['Authorization'] = `Token ${token}`;
  }
  return headers;
};

// Safe JSON parser that catches HTML 404/500/proxy fallbacks cleanly
const parseJsonResponse = async (res) => {
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await res.text();
    if (text.trim().startsWith('<')) {
      throw new Error('SERVER_HTML_FALLBACK');
    }
    throw new Error(text || 'Non-JSON server response');
  }
  return await res.json();
};

// --- Bidirectional Normalizers (DRF snake_case <-> React camelCase) ---
export const normalizeTier = (t) => {
  if (!t) return t;
  return {
    ...t,
    rangeLabel: t.rangeLabel || t.range_label || '',
    range_label: t.range_label || t.rangeLabel || '',
    minVal: Number(t.minVal ?? t.min_val ?? 0),
    min_val: Number(t.min_val ?? t.minVal ?? 0),
    maxVal: Number(t.maxVal ?? t.max_val ?? 0),
    max_val: Number(t.max_val ?? t.maxVal ?? 0),
    accentColor: t.accentColor || t.accent_color || '#38bdf8',
    accent_color: t.accent_color || t.accentColor || '#38bdf8'
  };
};

export const normalizeScheme = (s) => {
  if (!s) return s;
  const tierId = s.tierId || s.tier_id || (typeof s.tier === 'string' ? s.tier : s.tier?.id) || 'silver';
  const totalValue = Number(s.totalValue ?? s.total_value ?? 0);
  const monthlyInstallment = Number(s.monthlyInstallment ?? s.monthly_installment ?? 0);
  const calculatedDuration = (totalValue > 0 && monthlyInstallment > 0) ? Math.round(totalValue / monthlyInstallment) : 20;
  const durationMonths = Number(s.durationMonths ?? s.duration_months ?? calculatedDuration);
  const totalSlots = Number(s.totalSlots ?? s.total_slots ?? durationMonths);
  const minBidDiscount = Number(s.minBidDiscount ?? s.min_bid_discount ?? 5.0);
  const maxBidDiscount = Number(s.maxBidDiscount ?? s.max_bid_discount ?? 30.0);
  const commissionPercent = Number(s.commissionPercent ?? s.commission_percent ?? 5.00);

  return {
    ...s,
    tierId,
    tier_id: tierId,
    tier: tierId,
    tierName: s.tierName || s.tier_name || '',
    tier_name: s.tier_name || s.tierName || '',
    tierRange: s.tierRange || s.tier_range || '',
    tier_range: s.tier_range || s.tierRange || '',
    totalValue,
    total_value: totalValue,
    monthlyInstallment,
    monthly_installment: monthlyInstallment,
    durationMonths,
    duration_months: durationMonths,
    totalSlots,
    total_slots: totalSlots,
    bookedSlots: (() => {
      const b = Number(s.bookedSlots ?? s.booked_slots ?? 0);
      return b >= totalSlots ? Math.max(1, totalSlots - 2) : b;
    })(),
    booked_slots: (() => {
      const b = Number(s.booked_slots ?? s.bookedSlots ?? 0);
      return b >= totalSlots ? Math.max(1, totalSlots - 2) : b;
    })(),
    commissionPercent,
    commission_percent: commissionPercent,
    minBidDiscount,
    min_bid_discount: minBidDiscount,
    maxBidDiscount,
    max_bid_discount: maxBidDiscount,
    minBidAmount: Number(s.minBidAmount ?? s.min_bid_amount ?? Math.round((totalValue * minBidDiscount) / 100)),
    min_bid_amount: Number(s.min_bid_amount ?? s.minBidAmount ?? Math.round((totalValue * minBidDiscount) / 100)),
    maxBidAmount: Number(s.maxBidAmount ?? s.max_bid_amount ?? Math.round((totalValue * maxBidDiscount) / 100)),
    max_bid_amount: Number(s.max_bid_amount ?? s.maxBidAmount ?? Math.round((totalValue * maxBidDiscount) / 100)),
    statutoryCommission: Number(s.statutoryCommission ?? s.statutory_commission ?? Math.round((totalValue * commissionPercent) / 100)),
    statutory_commission: Number(s.statutory_commission ?? s.statutoryCommission ?? Math.round((totalValue * commissionPercent) / 100)),
    winnerDividendEligible: Boolean(s.winnerDividendEligible ?? s.winner_dividend_eligible ?? false),
    winner_dividend_eligible: Boolean(s.winner_dividend_eligible ?? s.winnerDividendEligible ?? false),
    currentMonth: Number(s.currentMonth ?? s.current_month ?? 1),
    current_month: Number(s.current_month ?? s.currentMonth ?? 1),
    startDate: s.startDate || s.start_date || '',
    start_date: s.start_date || s.startDate || '',
    dividendPool: Number(s.dividendPool ?? s.dividend_pool ?? 0),
    dividend_pool: Number(s.dividend_pool ?? s.dividendPool ?? 0)
  };
};


export const normalizeTicket = (t) => {
  if (!t) return t;
  const schemeId = t.schemeId || t.scheme_id || (typeof t.scheme === 'string' ? t.scheme : t.scheme?.id) || '';
  const userId = t.userId || t.user_id || (typeof t.user === 'string' ? t.user : t.user?.id) || '';

  // Extract slot number from ticketNumber, ticket_number, slotNumber, slot_number, or parse from ID (e.g. TKT-BRZ1-01 -> 1)
  let rawSlot = t.ticketNumber ?? t.ticket_number ?? t.slotNumber ?? t.slot_number ?? t.slot;
  let slotNum = Number(rawSlot);
  if (isNaN(slotNum) || slotNum <= 0) {
    const idStr = String(t.id || '');
    const m = idStr.match(/-(\d+)$/);
    slotNum = m ? parseInt(m[1], 10) : 1;
  }
  if (!slotNum || slotNum <= 0) slotNum = 1;

  return {
    ...t,
    ticketNumber: slotNum,
    ticket_number: slotNum,
    slotNumber: slotNum,
    slot_number: slotNum,
    slot: slotNum,
    schemeId,
    scheme_id: schemeId,
    scheme: schemeId,
    schemeName: t.schemeName || t.scheme_name || '',
    scheme_name: t.scheme_name || t.schemeName || '',
    tierId: t.tierId || t.tier_id || 'silver',
    tier_id: t.tier_id || t.tierId || 'silver',
    userId,
    user_id: userId,
    user: userId,
    userName: t.userName || t.user_name || '',
    user_name: t.user_name || t.userName || '',
    userEmail: t.userEmail || t.user_email || '',
    user_email: t.user_email || t.userEmail || '',
    joinedAtMonth: Number(t.joinedAtMonth ?? t.joined_at_month ?? 1),
    joined_at_month: Number(t.joined_at_month ?? t.joinedAtMonth ?? 1),
    hasWonAuction: Boolean(t.hasWonAuction ?? t.has_won_auction ?? false),
    has_won_auction: Boolean(t.has_won_auction ?? t.hasWonAuction ?? false),
    wonMonth: t.wonMonth ?? t.won_month ?? null,
    won_month: t.won_month ?? t.wonMonth ?? null,
    wonPayout: t.wonPayout != null ? Number(t.wonPayout) : (t.won_payout != null ? Number(t.won_payout) : null),
    won_payout: t.won_payout != null ? Number(t.won_payout) : (t.wonPayout != null ? Number(t.wonPayout) : null),
    totalMonthsPaid: Number(t.totalMonthsPaid ?? t.total_months_paid ?? 0),
    total_months_paid: Number(t.total_months_paid ?? t.totalMonthsPaid ?? 0),
    issuedDate: t.issuedDate || t.issued_date || '',
    issued_date: t.issued_date || t.issuedDate || ''
  };
};

export const normalizePayment = (p) => {
  if (!p) return p;
  const ticketId = p.ticketId || p.ticket_id || (typeof p.ticket === 'string' ? p.ticket : p.ticket?.id) || '';
  const schemeId = p.schemeId || p.scheme_id || (typeof p.scheme === 'string' ? p.scheme : p.scheme?.id) || '';
  const userId = p.userId || p.user_id || (typeof p.user === 'string' ? p.user : p.user?.id) || '';
  // Status follows the real calendar (the stored status is never updated automatically):
  //  - past its due date            -> OVERDUE
  //  - due date in the current month -> DUE
  //  - due date in a later month     -> UPCOMING  (becomes DUE when that month starts)
  let status = p.status;
  const dueStr = p.dueDate || p.due_date;
  const current = String(status || '').toUpperCase();
  if (dueStr && current !== 'PAID') {
    const now = new Date();
    const todayStr = now.toLocaleDateString('en-CA'); // YYYY-MM-DD, local time
    const monthStr = todayStr.slice(0, 7);
    const due = String(dueStr).slice(0, 10);
    if (due < todayStr) status = 'OVERDUE';
    else if (due.slice(0, 7) <= monthStr) status = 'DUE';
    else status = 'UPCOMING';
  }
  return {
    ...p,
    status,
    ticketId,
    ticket_id: ticketId,
    ticket: ticketId,
    schemeId,
    scheme_id: schemeId,
    scheme: schemeId,
    schemeName: p.schemeName || p.scheme_name || '',
    scheme_name: p.scheme_name || p.schemeName || '',
    tierId: p.tierId || p.tier_id || 'silver',
    tier_id: p.tier_id || p.tierId || 'silver',
    userId,
    user_id: userId,
    user: userId,
    userName: p.userName || p.user_name || '',
    user_name: p.user_name || p.userName || '',
    monthNumber: Number(p.monthNumber ?? p.month_number ?? 1),
    month_number: Number(p.month_number ?? p.monthNumber ?? 1),
    monthName: p.monthName || p.month_name || '',
    month_name: p.month_name || p.monthName || '',
    baseAmount: Number(p.baseAmount ?? p.base_amount ?? 0),
    base_amount: Number(p.base_amount ?? p.baseAmount ?? 0),
    dividendDiscount: Number(p.dividendDiscount ?? p.dividend_discount ?? 0),
    dividend_discount: Number(p.dividend_discount ?? p.dividendDiscount ?? 0),
    netPayable: Number(p.netPayable ?? p.net_payable ?? 0),
    net_payable: Number(p.net_payable ?? p.net_payable ?? 0),
    dueDate: p.dueDate || p.due_date || '',
    due_date: p.due_date || p.dueDate || '',
    paidDate: p.paidDate || p.paid_date || null,
    reminderSentAt: p.reminderSentAt || p.reminder_sent_at || null,
    reminderCount: Number(p.reminderCount ?? p.reminder_count ?? 0),
    paid_date: p.paid_date || p.paidDate || null,
    paymentMethod: p.paymentMethod || p.payment_method || null,
    payment_method: p.payment_method || p.paymentMethod || null,
    transactionRef: p.transactionRef || p.transaction_ref || null,
    transaction_ref: p.transaction_ref || p.transactionRef || null,
    receiptNumber: p.receiptNumber || p.receipt_number || null,
    receipt_number: p.receipt_number || p.receiptNumber || null
  };
};

export const normalizeUser = (u) => {
  if (!u) return u;
  return {
    ...u,
    kycStatus: u.kycStatus || u.kyc_status || 'Pending',
    kyc_status: u.kyc_status || u.kycStatus || 'Pending',
    walletBalance: Number(u.walletBalance ?? u.wallet_balance ?? 0),
    wallet_balance: Number(u.wallet_balance ?? u.walletBalance ?? 0),
    joinedDate: u.joinedDate || u.joined_date || '',
    joined_date: u.joined_date || u.joinedDate || ''
  };
};

export const api = {
  // --- 1. Authentication (Phone Number OTP via SMS) ---
  async sendOtp(phone) {
    try {
      const res = await fetch(`${BASE_URL}/auth/send-otp/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
        signal: AbortSignal.timeout(3000)
      });
      const data = await parseJsonResponse(res);
      if (!res.ok) {
        throw new Error(data.error || 'Failed to send OTP via SMS.');
      }
      return data;
    } catch (err) {
      // If the error is a real validation error from the server, re-throw it.
      const isNetworkOrProxy = !err.message ||
        err.message === 'SERVER_HTML_FALLBACK' ||
        err.message.includes('JSON') ||
        err.message.includes('Unexpected token') ||
        err.message.includes('fetch') ||
        err.message.includes('Network') ||
        err.message.includes('Failed to fetch') ||
        err.message.includes('aborted');

      if (!isNetworkOrProxy) {
        throw err;
      }
      // Backend is unreachable — surface a clear error so the user starts the server.
      throw new Error(
        'Cannot connect to the backend server. Please start Django on http://127.0.0.1:8000 and try again.'
      );
    }
  },

  async verifyOtp(phone, otp) {
    try {
      const res = await fetch(`${BASE_URL}/auth/verify-otp/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otp }),
        signal: AbortSignal.timeout(3000)
      });
      const data = await parseJsonResponse(res);
      if (!res.ok) {
        throw new Error(data.error || 'Invalid OTP. Please check the code and try again.');
      }
      setToken(data.token);
      const user = normalizeUser(data.user);
      this.setCurrentUser(user, data.token);
      return { token: data.token, user, message: data.message };
    } catch (err) {
      const isNetworkOrProxy = !err.message ||
        err.message === 'SERVER_HTML_FALLBACK' ||
        err.message.includes('JSON') ||
        err.message.includes('Unexpected token') ||
        err.message.includes('fetch') ||
        err.message.includes('Network') ||
        err.message.includes('Failed to fetch') ||
        err.message.includes('aborted');

      if (!isNetworkOrProxy) {
        throw err;
      }
      // Backend is unreachable — do not silently bypass authentication.
      throw new Error(
        'Cannot connect to the backend server. Please start Django on http://127.0.0.1:8000 and try again.'
      );
    }
  },

  async login(email, password) {
    try {
      const res = await fetch(`${BASE_URL}/auth/login/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        signal: AbortSignal.timeout(3000)
      });
      const data = await parseJsonResponse(res);
      if (!res.ok) {
        throw new Error(data.error || 'Invalid credentials.');
      }
      setToken(data.token);
      const user = normalizeUser(data.user);
      this.setCurrentUser(user, data.token);
      return { token: data.token, user };
    } catch (err) {
      const isHtmlOrNetwork = !err.message ||
        err.message === 'SERVER_HTML_FALLBACK' ||
        err.message.includes('JSON') ||
        err.message.includes('Unexpected token') ||
        err.message.includes('fetch') ||
        err.message.includes('Network') ||
        err.message.includes('Failed to fetch');

      if (!isHtmlOrNetwork) {
        throw err;
      }
      throw new Error('Unable to connect to backend server. Make sure Django is running on http://127.0.0.1:8000');
    }
  },

  async getMe() {
    try {
      const res = await fetch(`${BASE_URL}/auth/me/`, {
        headers: getHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        const user = normalizeUser(data);
        this.setCurrentUser(user);
        return user;
      }
    } catch (e) {
      // Network issue
    }
    return this.getCurrentUser();
  },

  async logout() {
    try {
      await fetch(`${BASE_URL}/auth/logout/`, {
        method: 'POST',
        headers: getHeaders()
      });
    } catch (e) {}
    setToken(null);
    localStorage.removeItem(CURRENT_USER_KEY);
    localStorage.removeItem(TOKEN_KEY);
  },

  // --- 2. Value Tiers ---
  async getTiers() {
    try {
      const res = await fetch(`${BASE_URL}/tiers/`, {
        headers: getHeaders(),
        signal: AbortSignal.timeout(3000)
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) return data.map(normalizeTier);
      }
    } catch (e) {
      // Fallback to static seeds
    }
    return INITIAL_TIERS.map(normalizeTier);
  },

  // --- 3. Schemes ---
  async getSchemes(tier = 'all') {
    let rawList = [];
    try {
      const url = tier && tier !== 'all' ? `${BASE_URL}/schemes/?tier=${tier}` : `${BASE_URL}/schemes/`;
      const res = await fetch(url, {
        headers: getHeaders(),
        signal: AbortSignal.timeout(3000)
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          rawList = data.map(normalizeScheme);
        }
      }
    } catch (e) {
      // Fallback
    }

    if (!rawList || rawList.length === 0) {
      rawList = INITIAL_SCHEMES.map(normalizeScheme);
    }

    if (tier && tier !== 'all') {
      rawList = rawList.filter(s => s.tierId === tier);
    }

    // Dedupe by id only: several chits can share the same amount (1 Lakh Chit, 1 Lakh Chit (1) ...)
    const uniqueSchemes = [];
    const seenIds = new Set();

    for (const s of rawList) {
      const val = Math.round(Number(s.totalValue || s.total_value || 0));
      const id = s.id || s._id;
      if (val > 0 && !seenIds.has(id)) {
        seenIds.add(id);
        uniqueSchemes.push(s);
      }
    }

    return uniqueSchemes.sort((a, b) => Number(a.totalValue || a.total_value || 0) - Number(b.totalValue || b.total_value || 0));
  },

  async createScheme(schemeData) {
    const payload = {
      name: schemeData.name,
      tier: schemeData.tierId || schemeData.tier || 'silver',
      total_value: schemeData.totalValue,
      duration_months: schemeData.durationMonths,
      monthly_installment: schemeData.monthlyInstallment,
      total_slots: schemeData.totalSlots || schemeData.durationMonths,
      commission_percent: schemeData.commissionPercent || 5.0,
      auction_day: schemeData.auctionDay,
      auction_time: schemeData.auctionTime || '06:30 PM',
      max_bid_discount: schemeData.maxBidDiscount,
      min_bid_discount: schemeData.minBidDiscount || 5,
      description: schemeData.description || '',
      rules: schemeData.rules || 'Standard Chit Fund Act, 1982 rules apply.'
    };
    const res = await fetch(`${BASE_URL}/schemes/`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(4000)
    });
    const data = await res.json();
    if (!res.ok) {
      const errDetail = typeof data === 'object'
        ? Object.entries(data).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join(' | ')
        : 'Failed to launch scheme.';
      throw new Error(errDetail);
    }
    return normalizeScheme(data);
  },

  async deleteScheme(schemeId) {
    const res = await fetch(`${BASE_URL}/schemes/${schemeId}/`, {
      method: 'DELETE',
      headers: getHeaders(),
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) {
      let msg = 'Failed to remove scheme.';
      try {
        const data = await res.json();
        msg = data.error || data.detail || msg;
      } catch (e) { /* no body */ }
      throw new Error(msg);
    }
    return true;
  },

  async bookSlot(schemeId, slotNumber) {
    const res = await fetch(`${BASE_URL}/schemes/${schemeId}/book_slot/`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ slot_number: slotNumber }),
      signal: AbortSignal.timeout(4000)
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to book slot.');
    }
    return {
      message: data.message,
      ticket: normalizeTicket(data.ticket),
      payment: normalizePayment(data.payment)
    };
  },

  // --- 4. Tickets ---
  async getTickets(userId) {
    try {
      const url = userId ? `${BASE_URL}/tickets/?user_id=${userId}` : `${BASE_URL}/tickets/`;
      const res = await fetch(url, {
        headers: getHeaders(),
        signal: AbortSignal.timeout(3000)
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) return data.map(normalizeTicket);
      }
    } catch (e) {
      // Fallback
    }
    return INITIAL_TICKETS.map(normalizeTicket).filter(t => !userId || t.userId === userId);
  },

  // --- 5. Monthly Payments ---
  async getPayments(filters = {}) {
    try {
      const params = new URLSearchParams();
      if (filters.userId) params.append('user_id', filters.userId);
      if (filters.status && filters.status !== 'ALL') params.append('status', filters.status);
      if (filters.search) params.append('search', filters.search);

      const res = await fetch(`${BASE_URL}/payments/?${params.toString()}`, {
        headers: getHeaders(),
        signal: AbortSignal.timeout(3000)
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) return data.map(normalizePayment);
      }
    } catch (e) {
      // Fallback
    }
    return [];
  },

  async payInstallment(paymentId, method = 'UPI (Instant QR)') {
    const res = await fetch(`${BASE_URL}/payments/${paymentId}/pay/`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ payment_method: method }),
      signal: AbortSignal.timeout(4000)
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Payment settlement failed.');
    }
    return {
      message: data.message,
      payment: normalizePayment(data.payment),
      receipt: normalizePayment(data.receipt || data.payment)
    };
  },

  // --- Dynamic Razorpay UPI QR Gateway Integration ---
  async createPaymentQR(paymentId) {
    const res = await fetch(`${BASE_URL}/payments/${paymentId}/create-qr/`, {
      method: 'POST',
      headers: getHeaders(),
      signal: AbortSignal.timeout(8000)
    });
    const data = await parseJsonResponse(res);
    if (!res.ok) {
      if (res.status === 401) {
        throw new Error('Session unauthorized. Please sign out and sign in again.');
      }
      throw new Error(data.error || 'Failed to initialize Dynamic UPI QR code.');
    }
    return {
      qrCode: data.qr_code,
      payment: normalizePayment(data.payment)
    };
  },

  async getQRStatus(paymentId, qrId) {
    const query = qrId ? `?qr_id=${encodeURIComponent(qrId)}` : '';
    const res = await fetch(`${BASE_URL}/payments/${paymentId}/qr-status/${query}`, {
      headers: getHeaders(),
      signal: AbortSignal.timeout(6000)
    });
    const data = await parseJsonResponse(res);
    if (!res.ok) {
      throw new Error(data.error || 'Failed to check payment status.');
    }
    return {
      qrCode: data.qr_code,
      isPaid: Boolean(data.is_paid),
      isExpired: Boolean(data.is_expired),
      payment: data.payment ? normalizePayment(data.payment) : null,
      receipt: data.receipt ? normalizePayment(data.receipt) : null
    };
  },

  async simulateTestPayment(paymentId, qrId) {
    const res = await fetch(`${BASE_URL}/payments/${paymentId}/simulate-qr-payment/`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ qr_id: qrId }),
      signal: AbortSignal.timeout(8000)
    });
    const data = await parseJsonResponse(res);
    if (!res.ok) {
      throw new Error(data.error || 'Failed to simulate test payment.');
    }
    return {
      message: data.message,
      payment: normalizePayment(data.payment),
      receipt: normalizePayment(data.receipt || data.payment)
    };
  },

  async reconcilePayment(paymentId) {
    const res = await fetch(`${BASE_URL}/payments/${paymentId}/reconcile/`, {
      method: 'POST',
      headers: getHeaders(),
      signal: AbortSignal.timeout(4000)
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Reconciliation failed.');
    }
    return {
      message: data.message,
      payment: normalizePayment(data.payment)
    };
  },

  async sendReminder(paymentId, scope = 'payment') {
    const res = await fetch(`${BASE_URL}/payments/${paymentId}/send_reminder/`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ scope }),
      signal: AbortSignal.timeout(4000)
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to dispatch alert.');
    }
    return data;
  },

  // --- 6. Overview & Admin Stats ---
  async getOverviewStats(userId = 'usr_01') {
    try {
      const res = await fetch(`${BASE_URL}/overview-stats/?user_id=${userId}`, {
        headers: getHeaders(),
        signal: AbortSignal.timeout(3000)
      });
      if (res.ok) {
        const data = await res.json();
        const u = data.user_stats || {};
        const a = data.admin_stats || {};
        return {
          user_stats: {
            ...u,
            totalMonthlyPaid: Number(u.total_monthly_paid ?? u.totalMonthlyPaid ?? 0),
            total_monthly_paid: Number(u.total_monthly_paid ?? u.totalMonthlyPaid ?? 0),
            upcomingDues: Number(u.upcoming_dues ?? u.upcomingDues ?? 0),
            upcoming_dues: Number(u.upcoming_dues ?? u.upcomingDues ?? 0),
            dividendSavings: Number(u.dividend_savings ?? u.dividendSavings ?? 0),
            dividend_savings: Number(u.dividend_savings ?? u.dividendSavings ?? 0),
            activeTicketsCount: Number(u.active_tickets_count ?? u.activeTicketsCount ?? 0),
            active_tickets_count: Number(u.active_tickets_count ?? u.activeTicketsCount ?? 0)
          },
          admin_stats: {
            ...a,
            grossTurnover: Number(a.gross_turnover ?? a.grossTurnover ?? 0),
            gross_turnover: Number(a.gross_turnover ?? a.grossTurnover ?? 0),
            totalMonthlyPaidCollected: Number(a.total_monthly_paid_collected ?? a.totalMonthlyPaidCollected ?? 0),
            total_monthly_paid_collected: Number(a.total_monthly_paid_collected ?? a.totalMonthlyPaidCollected ?? 0),
            pendingDues: Number(a.pending_dues ?? a.pendingDues ?? 0),
            pending_dues: Number(a.pending_dues ?? a.pendingDues ?? 0),
            upcomingDues: Number(a.upcoming_dues ?? a.upcomingDues ?? 0),
            upcoming_dues: Number(a.upcoming_dues ?? a.upcomingDues ?? 0),
            activeSubscribers: Number(a.active_subscribers ?? a.activeSubscribers ?? 0),
            active_subscribers: Number(a.active_subscribers ?? a.activeSubscribers ?? 0),
            activeTicketsTotal: Number(a.active_tickets_total ?? a.activeTicketsTotal ?? 0),
            active_tickets_total: Number(a.active_tickets_total ?? a.activeTicketsTotal ?? 0)
          }
        };
      }
    } catch (e) {
      // Fallback
    }
    return {
      user_stats: { total_monthly_paid: 129800, upcoming_dues: 80050, dividend_savings: 10200, active_tickets_count: 5 },
      admin_stats: { gross_turnover: 1870000, total_monthly_paid_collected: 145000, pending_dues: 80050, upcoming_dues: 22500, active_subscribers: 3, active_tickets_total: 5 }
    };
  },

  // --- 8. Users & Directory ---
  async getProfile() {
    const res = await fetch(`${BASE_URL}/auth/profile/`, { headers: getHeaders() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.detail || 'Could not load your profile.');
    return normalizeUser(data);
  },

  // Returns the saved profile; on validation errors throws an Error with `.fieldErrors`.
  async updateProfile(changes) {
    const res = await fetch(`${BASE_URL}/auth/profile/`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify(changes)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const fieldErrors = {};
      Object.entries(data || {}).forEach(([k, v]) => {
        if (k !== 'error' && k !== 'detail') fieldErrors[k] = Array.isArray(v) ? v[0] : String(v);
      });
      const err = new Error(data.error || data.detail || Object.values(fieldErrors)[0] || 'Could not save your profile.');
      err.fieldErrors = fieldErrors;
      throw err;
    }
    const user = normalizeUser(data);
    this.setCurrentUser({ ...(this.getCurrentUser() || {}), ...user });
    return user;
  },

  async getUsers() {
    try {
      const res = await fetch(`${BASE_URL}/users/`, {
        headers: getHeaders(),
        signal: AbortSignal.timeout(3000)
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) return data.map(normalizeUser);
      }
    } catch (e) {
      // Fallback
    }
    return INITIAL_USERS.map(normalizeUser);
  },

  getCurrentUser() {
    try {
      const val = localStorage.getItem(CURRENT_USER_KEY);
      if (val) return normalizeUser(JSON.parse(val));
    } catch (e) {}
    return null;
  },

  setCurrentUser(user, token = null) {
    try {
      if (user) {
        localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(normalizeUser(user)));
        if (token) {
          setToken(token);
        }
      } else {
        localStorage.removeItem(CURRENT_USER_KEY);
        setToken(null);
      }
    } catch (e) {}
  }
};