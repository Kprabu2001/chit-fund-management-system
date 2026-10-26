import React, { useState, useEffect } from 'react';
import { api } from './services/api';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import ToastContainer from './components/Toast';
import ThemeToggle from './components/ThemeToggle';

import OverviewView from './views/OverviewView';
import PoolsView from './views/PoolsView';
import MonthlyPaidLedgerView from './views/MonthlyPaidLedgerView';
import MyTicketsView from './views/MyTicketsView';
import AdminConsoleView from './views/AdminConsoleView';
import LoginPage from './views/LoginPage';

import PaymentModal from './modals/PaymentModal';
import ReceiptModal from './modals/ReceiptModal';
import BookingModal from './modals/BookingModal';
import SchemeModal from './modals/SchemeModal';
import AuthModal from './modals/AuthModal';
import ProfileModal from './modals/ProfileModal';

export default function App() {
  const [currentView, setCurrentView] = useState('overview');
  const [currentUser, setCurrentUser] = useState(() => api.getCurrentUser());
  const [users, setUsers] = useState([]);

  // Stale/invalid token (e.g. DB was re-seeded): drop session and show login.
  useEffect(() => {
    const onUnauthorized = () => setCurrentUser(null);
    window.addEventListener('ats:unauthorized', onUnauthorized);
    if (api.getCurrentUser()) api.getMe();
    return () => window.removeEventListener('ats:unauthorized', onUnauthorized);
  }, []);
  const [tiers, setTiers] = useState([]);
  const [schemes, setSchemes] = useState([]);
  const [payments, setPayments] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [stats, setStats] = useState(null);

  const [activeTier, setActiveTier] = useState('silver');
  const [activeSchemeId, setActiveSchemeId] = useState('SCH-BRZ-1L');
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('ats-theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch { /* storage unavailable */ }
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const isLightTheme = theme === 'light';

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('ats-theme', theme); } catch { /* ignore */ }
  }, [theme]);
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  // Modals state
  const [activePayment, setActivePayment] = useState(null);
  const [activeReceipt, setActiveReceipt] = useState(null);
  const [activeBookingScheme, setActiveBookingScheme] = useState(null);
  const [showCreateSchemeModal, setShowCreateSchemeModal] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [toasts, setToasts] = useState([]);

  // Toast helper
  const showToast = (message, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3500);
  };

  // Load all data
  const loadData = async (user = null) => {
    const activeUser = user || api.getCurrentUser();
    if (!activeUser) {
      setCurrentUser(null);
      return;
    }
    setCurrentUser(activeUser);

    const [usersRes, tiersRes, schemesRes, ticketsRes, paymentsRes, statsRes] = await Promise.allSettled([
      api.getUsers(),
      api.getTiers(),
      api.getSchemes(),
      api.getTickets(activeUser?.role === 'admin' ? null : activeUser?.id),
      api.getPayments(activeUser?.role === 'admin' ? {} : { userId: activeUser?.id }),
      api.getOverviewStats(activeUser?.id)
    ]);
    const allUsers = usersRes.status === 'fulfilled' ? usersRes.value : [];
    const loadedTiers = tiersRes.status === 'fulfilled' ? tiersRes.value : [];
    const loadedSchemes = schemesRes.status === 'fulfilled' ? schemesRes.value : [];
    const loadedTickets = ticketsRes.status === 'fulfilled' ? ticketsRes.value : [];
    setUsers(allUsers);
    if (paymentsRes.status === 'rejected' || statsRes.status === 'rejected') {
      showToast('Could not load payment data from the server. Please refresh in a moment.', 'error');
    }

    // Keep every scheme (dedupe by id only) - several chits can share the same amount.
    const uniqueLoadedSchemes = (loadedSchemes || []).filter((s, idx, arr) => {
      const val = Math.round(Number(s.totalValue || s.total_value || 0));
      return val > 0 && arr.findIndex(x => (x.id || x._id) === (s.id || s._id)) === idx;
    }).sort((a, b) => Number(a.totalValue || a.total_value || 0) - Number(b.totalValue || b.total_value || 0));

    setTiers(loadedTiers);
    setSchemes(uniqueLoadedSchemes);
    setTickets(loadedTickets);
    if (paymentsRes.status === 'fulfilled') setPayments(paymentsRes.value);
    if (statsRes.status === 'fulfilled') setStats(statsRes.value);
  };

  // Members: quietly refresh every 30s so admin reminders show up in the bell
  useEffect(() => {
    if (!currentUser || currentUser.role === 'admin') return undefined;
    const timer = setInterval(async () => {
      try {
        const fresh = await api.getPayments({ userId: currentUser.id });
        if (Array.isArray(fresh)) setPayments(fresh);
      } catch { /* ignore, next tick retries */ }
    }, 30000);
    return () => clearInterval(timer);
  }, [currentUser?.id, currentUser?.role]);

  useEffect(() => {
    if (currentUser) {
      loadData(currentUser);
      if (currentUser.role === 'admin') {
        setCurrentView('admin');
      } else {
        setCurrentView('overview');
      }
    }
  }, []);

  // Strict role guard: keep admin and member views completely separated
  useEffect(() => {
    if (currentUser) {
      if (currentUser.role === 'admin') {
        if (['overview', 'ledger', 'tickets'].includes(currentView)) {
          setCurrentView('admin');
        }
      } else {
        if (currentView === 'admin') {
          setCurrentView('overview');
        }
      }
    }
  }, [currentUser, currentView]);

  // Logout / Sign Out Action
  const handleLogout = async () => {
    await api.logout();
    setCurrentUser(null);
    setTickets([]);
    setPayments([]);
    setStats(null);
    showToast('Signed out. Return to role-based login.', 'info');
  };

  // Theme toggle
  const handleToggleTheme = () => setTheme(t => (t === 'light' ? 'dark' : 'light'));

  // Complete Payment Action
  const handleCompletePayment = async (paymentId, method) => {
    const res = await api.payInstallment(paymentId, method);
    if (res) {
      setActivePayment(null);
      showToast(`Installment paid successfully via ${method}!`, 'success');
      loadData(currentUser);
      setActiveReceipt(res.payment || res.receipt);
    }
  };

  // Reconcile Payment (Admin)
  const handleReconcilePayment = async (paymentId) => {
    const res = await api.reconcilePayment(paymentId);
    if (res) {
      showToast('Offline installment reconciled as Paid.', 'success');
      loadData(currentUser);
    }
  };

  // Send Reminder (Admin)
  const handleSendReminder = async (paymentId, scope = 'payment') => {
    try {
      const res = await api.sendReminder(paymentId, scope);
      showToast(res.message, 'success');
      loadData(currentUser); // refresh so "Reminded just now" shows
    } catch (err) {
      showToast(err.message || 'Could not send reminder.', 'error');
    }
  };

  // Book Slot Action
  const handleConfirmBooking = async (schemeId, slotNumber) => {
    try {
      const res = await api.bookSlot(schemeId, slotNumber, currentUser);
      if (res) {
        setActiveBookingScheme(null);
        showToast(`Booked Ticket #${slotNumber} in scheme! First installment due in passbook.`, 'success');
        await loadData(currentUser);
        setActiveSchemeId(schemeId);
        setCurrentView('pools');
      }
    } catch (err) {
      showToast(err.message || 'Slot booking failed.', 'error');
      throw err;
    }
  };

  // Create Scheme (Admin)
  const handleCreateScheme = async (schemeData) => {
    try {
      const res = await api.createScheme(schemeData);
      if (res) {
        setShowCreateSchemeModal(false);
        showToast(`Scheme "${res.name}" launched successfully!`, 'success');
        await loadData(currentUser);
        setActiveTier(res.tierId);
        setCurrentView('pools');
      }
    } catch (err) {
      showToast(err.message || 'Scheme creation failed.', 'error');
      throw err;
    }
  };

  // Remove Scheme (Admin)
  const handleDeleteScheme = async (scheme) => {
    try {
      await api.deleteScheme(scheme.id);
      showToast(`Scheme "${scheme.name}" removed.`, 'success');
      const remaining = schemes.filter(s => s.id !== scheme.id);
      if (remaining.length > 0) setActiveSchemeId(remaining[0].id);
      await loadData(currentUser);
    } catch (err) {
      showToast(err.message || 'Could not remove scheme.', 'error');
    }
  };

  // Dues calculations for member sidebar badge (case-insensitive)
  const overduePayments = payments.filter(p => (p.status || '').toUpperCase() === 'OVERDUE');
  const overdueAmount = overduePayments.reduce((sum, p) => sum + Number(p.netPayable ?? p.net_payable ?? 0), 0);

  const pendingPayments = payments.filter(p => {
    const s = (p.status || '').toUpperCase();
    return s === 'DUE' || s === 'OVERDUE';
  });
  const dueAmount = pendingPayments.reduce((sum, p) => sum + Number(p.netPayable ?? p.net_payable ?? 0), 0);

  const upcomingPayments = payments.filter(p => (p.status || '').toUpperCase() === 'UPCOMING');
  const upcomingAmount = upcomingPayments.reduce((sum, p) => sum + Number(p.netPayable ?? p.net_payable ?? 0), 0);

  // 1. FIRST SHOW LOGIN PAGE IF NOT AUTHENTICATED
  if (!currentUser) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-app)' }}>
        <div style={{ position: 'fixed', top: '1rem', right: '1rem', zIndex: 50 }}>
          <ThemeToggle isLight={isLightTheme} onToggle={handleToggleTheme} />
        </div>
        <LoginPage
          onLoginSuccess={(user) => {
            setCurrentUser(user);
            loadData(user);
            if (user.role === 'admin') {
              setCurrentView('admin');
            } else {
              setCurrentView('overview');
            }
          }}
          onShowToast={showToast}
        />
        <ToastContainer toasts={toasts} />
      </div>
    );
  }

  // Handle chit selection from sidebar (1 Lakh, 2 Lakh, etc.)
  const handleSelectChit = (scheme) => {
    setActiveTier(scheme.tierId || 'all');
    setActiveSchemeId(scheme.id);
    setCurrentView('pools');
    setIsMobileOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // 2. AUTHENTICATED ROLE-BASED DASHBOARD SHELL
  return (
    <div className="app-shell">
      {/* Sidebar Navigation */}
      <Sidebar
        currentView={currentView}
        onNavigate={(view) => {
          const target = view === 'auction' ? 'overview' : view;
          setCurrentView(target);
          setIsMobileOpen(false);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        currentUser={currentUser}
        schemes={schemes}
        tickets={tickets}
        payments={payments}
        activeSchemeId={activeSchemeId}
        onSelectChit={handleSelectChit}
        dueAmount={dueAmount}
        overdueAmount={overdueAmount}
        upcomingAmount={upcomingAmount}
        totalPaymentsCount={payments.length}
        isMobileOpen={isMobileOpen}
        onOpenAuthModal={() => setShowAuthModal(true)}
        onLogout={handleLogout}
      />

      {/* Main Content Area */}
      <div className="app-main">
        <Topbar
          currentView={currentView}
          currentUser={currentUser}
          payments={payments}
          onOpenProfile={() => setShowProfile(true)}
          onNotificationAction={(action) => {
            if (!action) return;
            if (action.kind === 'pay' && action.payment) setActivePayment(action.payment);
            else if (action.kind === 'receipt' && action.payment) setActiveReceipt(action.payment);
            else setCurrentView('ledger');
          }}
          isLightTheme={isLightTheme}
          onToggleTheme={handleToggleTheme}
          onToggleMobileMenu={() => setIsMobileOpen(!isMobileOpen)}
          onOpenAuthModal={() => setShowAuthModal(true)}
          onLogout={handleLogout}
        />

        <main className="content-area">
          {currentView === 'overview' && (
            <OverviewView
              stats={stats}
              payments={payments}
              tickets={tickets}
              currentUser={currentUser}
              onNavigate={setCurrentView}
              onFilterTier={setActiveTier}
              onOpenPaymentModal={(p) => setActivePayment(p)}
              onViewReceipt={(p) => setActiveReceipt(p)}
              onReconcilePayment={handleReconcilePayment}
            />
          )}

          {currentView === 'pools' && (
            <PoolsView
              tiers={tiers}
              schemes={schemes}
              activeSchemeId={activeSchemeId}
              currentUser={currentUser}
              tickets={tickets}
              payments={payments}
              onSelectScheme={(schemeId) => setActiveSchemeId(schemeId)}
              onOpenBookingModal={(s) => setActiveBookingScheme(s)}
              onOpenPaymentModal={(p) => setActivePayment(p)}
              onViewReceipt={(p) => setActiveReceipt(p)}
              onReconcilePayment={handleReconcilePayment}
              onSendReminder={handleSendReminder}
              onDeleteScheme={handleDeleteScheme}
              onOpenSchemeDetails={(s) => {
                showToast(`Rules: ${s.rules || 'Standard Chit Fund Act, 1982 rules apply.'}`, 'info');
              }}
            />
          )}

          {currentView === 'ledger' && (
            <MonthlyPaidLedgerView
              payments={payments}
              currentUser={currentUser}
              onOpenPaymentModal={(p) => setActivePayment(p)}
              onViewReceipt={(p) => setActiveReceipt(p)}
              onReconcilePayment={handleReconcilePayment}
            />
          )}

          {currentView === 'tickets' && (
            <MyTicketsView
              tickets={tickets}
              schemes={schemes}
              currentUser={currentUser}
              onNavigate={setCurrentView}
              onViewPassbook={(t) => {
                showToast(`Passbook for Ticket ${t.id}: ${t.totalMonthsPaid} months paid so far.`, 'info');
              }}
            />
          )}

          {currentView === 'admin' && currentUser?.role === 'admin' && (
            <AdminConsoleView
              stats={stats}
              payments={payments}
              schemes={schemes}
              users={users}
              tickets={tickets}
              onSelectScheme={(schemeId) => {
                setActiveSchemeId(schemeId);
                setCurrentView('pools');
              }}
              onReconcilePayment={handleReconcilePayment}
              onSendReminder={handleSendReminder}
              onOpenCreateSchemeModal={() => setShowCreateSchemeModal(true)}
              onShowToast={showToast}
            />
          )}
        </main>
      </div>

      {/* Modals */}
      {activePayment && (
        <PaymentModal
          payment={activePayment}
          onClose={() => setActivePayment(null)}
          onCompletePayment={handleCompletePayment}
          onPaymentVerified={(settledPayment, receipt) => {
            loadData(currentUser);
            showToast('Installment paid successfully via Razorpay UPI QR!', 'success');
            if (receipt) setActiveReceipt(receipt);
          }}
          onViewReceipt={(receipt) => {
            setActivePayment(null);
            setActiveReceipt(receipt);
          }}
        />
      )}

      {activeReceipt && (
        <ReceiptModal
          payment={activeReceipt}
          onClose={() => setActiveReceipt(null)}
        />
      )}

      {activeBookingScheme && (
        <BookingModal
          scheme={activeBookingScheme}
          existingTickets={tickets}
          onClose={() => setActiveBookingScheme(null)}
          onConfirmBooking={handleConfirmBooking}
        />
      )}

      {showCreateSchemeModal && (
        <SchemeModal
          tiers={tiers}
          onClose={() => setShowCreateSchemeModal(false)}
          onCreateScheme={handleCreateScheme}
        />
      )}

      {showProfile && (
        <ProfileModal
          currentUser={currentUser}
          onClose={() => setShowProfile(false)}
          onSaved={(saved) => setCurrentUser(prev => ({ ...prev, ...saved }))}
          onShowToast={showToast}
        />
      )}

      {showAuthModal && (
        <AuthModal
          currentUser={currentUser}
          users={users}
          onClose={() => setShowAuthModal(false)}
          onLoginSuccess={(user) => {
            setCurrentUser(user);
            loadData(user);
            if (user.role === 'admin') {
              setCurrentView('admin');
            } else {
              setCurrentView('overview');
            }
          }}
          onShowToast={showToast}
        />
      )}

      {/* Floating Toasts */}
      <ToastContainer toasts={toasts} />
    </div>
  );
}