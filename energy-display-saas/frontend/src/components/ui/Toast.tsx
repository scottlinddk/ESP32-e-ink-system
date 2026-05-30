// =========================================================================
// Toast.tsx — ToastStack + ToastItem
// =========================================================================
import React, { useState, useEffect } from 'react';
import { Icon } from './Logo';
import type { ToastData } from '../../types';

interface ToastItemProps {
  toast: ToastData & { id: number };
  dismiss: (id: number) => void;
}

const ICONS: Record<string, string> = {
  success: 'check',
  error: 'priority_high',
  warning: 'warning',
  info: 'info',
};

export function ToastItem({ toast, dismiss }: ToastItemProps) {
  const [out, setOut] = useState(false);

  useEffect(() => {
    if (toast.persist) return;
    const ttl = toast.ttl || 3600;
    const a = setTimeout(() => setOut(true), ttl);
    const b = setTimeout(() => dismiss(toast.id), ttl + 240);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={'toast' + (out ? ' is-out' : '')} role="status">
      <span className={'toast__icon toast__icon--' + toast.type}>
        <Icon name={ICONS[toast.type] ?? 'info'} />
      </span>
      <div className="toast__body">
        <div className="toast__title">{toast.title}</div>
        {toast.msg && <div className="toast__msg">{toast.msg}</div>}
        {toast.action && (
          <button
            className="toast__action"
            onClick={() => {
              toast.action!.onClick();
              dismiss(toast.id);
            }}
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        className="toast__close"
        onClick={() => {
          setOut(true);
          setTimeout(() => dismiss(toast.id), 240);
        }}
        aria-label="Dismiss"
      >
        <Icon name="close" />
      </button>
    </div>
  );
}

interface ToastStackProps {
  toasts: (ToastData & { id: number })[];
  dismiss: (id: number) => void;
}

export function ToastStack({ toasts, dismiss }: ToastStackProps) {
  return (
    <div className="toast-wrap" role="region" aria-live="polite">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} dismiss={dismiss} />
      ))}
    </div>
  );
}
