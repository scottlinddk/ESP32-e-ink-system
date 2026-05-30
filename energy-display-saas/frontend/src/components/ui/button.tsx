// =========================================================================
// button.tsx — MUI-style button + IconButton (canonical implementation)
// =========================================================================
import React from 'react';
import { Icon } from './Logo';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'contained' | 'outlined' | 'text' | 'danger' | 'danger-outlined' | 'oauth';
  size?: 'sm';
  block?: boolean;
  loading?: boolean;
  icon?: string;
}

export function Button({
  variant = 'contained',
  size,
  block,
  loading,
  disabled,
  icon,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const cls = ['btn', 'btn--' + variant];
  if (size === 'sm') cls.push('btn--sm');
  if (block) cls.push('btn--block');
  return (
    <button
      type={type}
      className={cls.join(' ')}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <span className="spinner" /> : icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  ...rest
}: { icon: string; label: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className="iconbtn" aria-label={label} title={label} {...rest}>
      <Icon name={icon} />
    </button>
  );
}
