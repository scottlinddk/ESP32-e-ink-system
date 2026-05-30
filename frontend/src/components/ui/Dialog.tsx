// =========================================================================
// Dialog.tsx — AlertDialog / Modal
// =========================================================================
import React, { useEffect, ReactNode } from 'react';
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
      className="scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog" role="alertdialog" aria-modal="true" aria-label={title}>
        <div className="dialog__body">
          <h2 className={'dialog__title' + (danger ? ' is-danger' : '')}>
            {icon && <Icon name={icon} />}
            {title}
          </h2>
          {children}
        </div>
        {footer && <div className="dialog__foot">{footer}</div>}
      </div>
    </div>
  );
}
