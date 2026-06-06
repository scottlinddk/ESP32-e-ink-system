// =========================================================================
// Chip.tsx — badge / status chip
// =========================================================================
import React, { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Icon } from './Logo';

interface ChipProps {
  variant?: 'default' | 'success' | 'error' | 'warning' | 'info';
  dot?: boolean;
  icon?: string;
  children?: ReactNode;
}

const variantClasses: Record<string, string> = {
  default: 'bg-black/[0.14] text-fg2',
  success: 'bg-success/[0.14] text-success',
  error: 'bg-error/[0.13] text-error',
  warning: 'bg-warning/[0.16] text-warning',
  info: 'bg-info/[0.13] text-info',
};

export function Chip({ variant = 'default', dot, icon, children }: ChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-pill text-xs font-medium whitespace-nowrap',
        '[&_.material-symbols-outlined]:text-[14px]',
        variantClasses[variant]
      )}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current" />}
      {icon && <Icon name={icon} />}
      {children}
    </span>
  );
}
