import React, { useEffect, useMemo, useRef, useState } from 'react';
import { buildNotifications } from '../utils/notifications';

const readKey = (user) => `ats-notif-read-${user?.id || user?.phone || 'guest'}`;

const loadRead = (user) => {
  try { return new Set(JSON.parse(localStorage.getItem(readKey(user)) || '[]')); } catch { return new Set(); }
};

const ICONS = { danger: '⚠️', warn: '⏰', ok: '✅', info: 'ℹ️' };

export default function NotificationBell({ payments, payouts = [], results = [], currentUser, onAction }) {
  const [open, setOpen] = useState(false);
  const [readIds, setReadIds] = useState(() => loadRead(currentUser));
  const ref = useRef(null);

  useEffect(() => { setReadIds(loadRead(currentUser)); }, [currentUser?.id, currentUser?.phone]);

  const items = useMemo(() => buildNotifications(payments, currentUser, payouts, results), [payments, payouts, results, currentUser]);
  const unread = items.filter(n => !readIds.has(n.id)).length;

  const persist = (set) => {
    setReadIds(set);
    try { localStorage.setItem(readKey(currentUser), JSON.stringify([...set])); } catch { /* ignore */ }
  };
  const markRead = (id) => { if (!readIds.has(id)) persist(new Set(readIds).add(id)); };
  const markAllRead = () => persist(new Set([...readIds, ...items.map(n => n.id)]));

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

  const handleClick = (n) => {
    markRead(n.id);
    setOpen(false);
    onAction?.(n.action);
  };

  return (
    <div className="notif-wrap" ref={ref}>
      <button
        type="button"
        className="btn-icon notif-btn"
        onClick={() => setOpen(o => !o)}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
        aria-haspopup="true"
        aria-expanded={open}
        title="Notifications"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && <span className="notif-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="notif-head">
            <strong>Notifications</strong>
            {unread > 0 && <button type="button" className="notif-link" onClick={markAllRead}>Mark all as read</button>}
          </div>
          {items.length === 0 ? (
            <div className="notif-empty">
              <div style={{ fontSize: '1.6rem' }}>🎉</div>
              You're all caught up.
            </div>
          ) : (
            <ul className="notif-list">
              {items.map(n => (
                <li key={n.id}>
                  <button type="button" className={`notif-item ${readIds.has(n.id) ? 'read' : ''}`} onClick={() => handleClick(n)}>
                    <span className={`notif-icon ${n.type}`}>{ICONS[n.type] || ICONS.info}</span>
                    <span className="notif-text">
                      <span className="notif-title">{n.title}</span>
                      <span className="notif-body">{n.body}</span>
                    </span>
                    {!readIds.has(n.id) && <span className="notif-dot" aria-hidden="true" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}