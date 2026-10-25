import React from 'react';

export default function ToastContainer({ toasts }) {
  if (!toasts || toasts.length === 0) return null;

  return (
    <div id="toast-container">
      {toasts.map(toast => {
        let icon = 'ℹ️';
        if (toast.type === 'success') icon = '✅';
        if (toast.type === 'error') icon = '⚠️';

        return (
          <div key={toast.id} className={`toast-item ${toast.type || 'info'}`}>
            <span>{icon}</span>
            <span>{toast.message}</span>
          </div>
        );
      })}
    </div>
  );
}
