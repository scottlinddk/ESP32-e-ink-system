// =========================================================================
// Dialog.tsx — AlertDialog / Modal
// =========================================================================
import React, { useEffect, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Icon } from './Logo';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  icon?: string;
  danger?: boolean;
  children?: ReactNode;
  footer?: ReactNode;
}

export function Dialog({ open, onClose, title, icon, danger, children, footer }: DialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4 animate-scrim-fade"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-[440px] bg-surface rounded-lg shadow-4 overflow-hidden animate-dialog-in"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="p-5">
          <h2
            className={cn(
              'text-h5 font-medium m-0 mb-2 flex items-center gap-2.5 [&_.material-symbols-outlined]:text-[24px]',
              danger && '[&_.material-symbols-outlined]:text-error'
            )}
          >
            {icon && <Icon name={icon} />}
            {title}
          </h2>
          {children}
        </div>
        {footer && (
          <div className="px-5 py-4 bg-black/[0.04] border-t border-divider flex gap-3 justify-end">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
