// =========================================================================
// Chip.tsx — badge / status chip
// =========================================================================
import React, { ReactNode } from 'react';
import { Icon } from './Logo';
import { cn } from '../../lib/utils';

interface ChipProps {
  variant?: 'default' | 'success' | 'error' | 'warning' | 'info';
  dot?: boolean;
  icon?: string;
  children?: ReactNode;
  title?: string;
}

const VARIANT_CLASSES: Record<string, string> = {
  default: 'bg-[rgba(128,128,128,0.14)] text-fg-2',
  success: 'bg-[rgba(38,169,95,0.14)] text-success',
  error: 'bg-[rgba(243,22,78,0.13)] text-error',
  warning: 'bg-[rgba(211,151,10,0.16)] text-warning',
  info: 'bg-[rgba(0,144,214,0.13)] text-info',
};

export function Chip({ variant = 'default', dot, icon, children, title }: ChipProps) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 px-[10px] py-1 rounded-full text-xs font-medium whitespace-nowrap [&_.material-symbols-outlined]:text-[14px]',
        VARIANT_CLASSES[variant],
      )}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current" />}
      {icon && <Icon name={icon} />}
      {children}
    </span>
  );
}
