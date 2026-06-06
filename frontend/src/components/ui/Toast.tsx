// =========================================================================
// Toast.tsx — ToastStack + ToastItem
// =========================================================================
import React, { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
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

const iconBg: Record<string, string> = {
  success: 'bg-success',
  error: 'bg-error',
  warning: 'bg-warning',
  info: 'bg-info',
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
    <div
      className={cn(
        'flex items-start gap-3 min-w-[300px] max-w-[400px] px-3.5 py-3',
        'rounded-md bg-surface border border-border shadow-3',
        out ? 'animate-toast-out' : 'animate-toast-in'
      )}
      role="status"
    >
      <span
        className={cn(
          'w-[22px] h-[22px] rounded-full flex-shrink-0 flex items-center justify-center mt-[1px]',
          '[&_.material-symbols-outlined]:text-[16px] [&_.material-symbols-outlined]:text-white',
          iconBg[toast.type] ?? iconBg.info
        )}
      >
        <Icon name={ICONS[toast.type] ?? 'info'} />
      </span>
      <div className="flex-1">
        <div className="text-sm font-medium">{toast.title}</div>
        {toast.msg && <div className="text-xs text-fg2 mt-0.5 leading-snug">{toast.msg}</div>}
        {toast.action && (
          <button
            className="bg-none border-none text-info text-xs font-medium cursor-pointer p-0 mt-1.5 hover:underline"
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
        className="bg-none border-none text-fg3 cursor-pointer inline-flex p-0 [&_.material-symbols-outlined]:text-[18px]"
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
    <div
      className="fixed right-6 bottom-6 z-[90] flex flex-col gap-2.5 items-end"
      role="region"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} dismiss={dismiss} />
      ))}
    </div>
  );
}
