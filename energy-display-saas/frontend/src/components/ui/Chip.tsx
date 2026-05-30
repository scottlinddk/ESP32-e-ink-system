// =========================================================================
// Chip.tsx — badge / status chip
// =========================================================================
import React, { ReactNode } from 'react';
import { Icon } from './Logo';

interface ChipProps {
  variant?: 'default' | 'success' | 'error' | 'warning' | 'info';
  dot?: boolean;
  icon?: string;
  children?: ReactNode;
}

export function Chip({ variant = 'default', dot, icon, children }: ChipProps) {
  return (
    <span className={'chip chip--' + variant}>
      {dot && <span className="dot" />}
      {icon && <Icon name={icon} />}
      {children}
    </span>
  );
}
