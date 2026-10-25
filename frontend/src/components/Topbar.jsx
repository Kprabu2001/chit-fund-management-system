import React from 'react';
import ThemeToggle from './ThemeToggle';
import ProfileMenu from './ProfileMenu';
import NotificationBell from './NotificationBell';

export default function Topbar({
  currentView,
  currentUser,
  payments,
  onNotificationAction,
  onOpenProfile,
  isLightTheme,
  onToggleTheme,
  onToggleMobileMenu,
  onLogout
}) {
  const isAdmin = currentUser?.role === 'admin';

  const titles = {
    overview: { title: 'Dashboard Overview', breadcrumb: 'Portal / Member Overview' },
    pools: isAdmin
      ? { title: 'Chit Scheme Management', breadcrumb: 'Administration / Enrolled Members & Collections' }
      : { title: 'Chit Scheme Passbook', breadcrumb: 'Chit Schemes / 1 Lakh & Monthly Installments' },
    ledger: { title: 'Monthly Paid Installment Ledger', breadcrumb: 'Passbook / Monthly Collections' },
    tickets: { title: 'My Active Tickets Portfolio', breadcrumb: 'Holdings / Passbook Records' },
    admin: { title: 'Admin Dashboard', breadcrumb: 'Administration / Managed Users & Collections' }
  };

  const currentInfo = titles[currentView] || titles.overview;

  return (
    <header className="app-topbar">
      <div className="topbar-left">
        <button className="mobile-menu-toggle" onClick={onToggleMobileMenu}>
          ☰
        </button>
        <div className="topbar-page-info">
          <h1 className="topbar-page-title">{currentInfo.title}</h1>
          <div className="topbar-breadcrumbs">{currentInfo.breadcrumb}</div>
        </div>
      </div>

      <div className="topbar-right">
        <NotificationBell payments={payments} currentUser={currentUser} onAction={onNotificationAction} />
        <ThemeToggle isLight={isLightTheme} onToggle={onToggleTheme} />
        <span className="topbar-divider" />
        <ProfileMenu currentUser={currentUser} onLogout={onLogout} onOpenProfile={onOpenProfile} />
      </div>
    </header>
  );
}