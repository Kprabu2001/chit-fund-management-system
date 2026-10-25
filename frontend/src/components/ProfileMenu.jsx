import React, { useEffect, useRef, useState } from 'react';

const initials = (name = '') =>
  name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || 'U';

export default function ProfileMenu({ currentUser, onLogout, onOpenProfile }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const isAdmin = currentUser?.role === 'admin';
  const name = currentUser?.name || (isAdmin ? 'Admin' : 'Member');

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="profile-menu" ref={ref}>
      <button
        type="button"
        className={`profile-trigger ${open ? 'open' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="profile-avatar">{initials(name)}</span>
        <span className="profile-trigger-text">
          <span className="profile-trigger-name">{name}</span>
          <span className="profile-trigger-role">{isAdmin ? 'Administrator' : 'Member'}</span>
        </span>
        <svg className="profile-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="profile-dropdown" role="menu">
          <div className="profile-dropdown-head">
            <span className="profile-avatar large">{initials(name)}</span>
            <div style={{ minWidth: 0 }}>
              <div className="profile-dropdown-name">{name}</div>
              {currentUser?.phone && <div className="profile-dropdown-sub">{currentUser.phone}</div>}
              <span className={`profile-role-chip ${isAdmin ? 'admin' : ''}`}>{isAdmin ? 'Admin' : 'Member'}</span>
            </div>
          </div>
          <div className="profile-dropdown-divider" />
          <button
            type="button"
            role="menuitem"
            className="profile-menu-item"
            onClick={() => { setOpen(false); onOpenProfile?.(); }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" />
            </svg>
            My profile
          </button>
          <button
            type="button"
            role="menuitem"
            className="profile-menu-item danger"
            onClick={() => { setOpen(false); onLogout?.(); }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" />
            </svg>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}