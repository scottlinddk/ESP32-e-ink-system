// =========================================================================
// button.tsx — MUI-style button + IconButton (canonical implementation)
// =========================================================================
import React from 'react';
import { Icon } from './Logo';
import { cn } from '../../lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'contained' | 'outlined' | 'text' | 'danger' | 'danger-outlined' | 'oauth';
  size?: 'sm';
  block?: boolean;
  loading?: boolean;
  icon?: string;
}

const BASE =
  'inline-flex items-center justify-center gap-2 text-sm font-medium tracking-[0.01em] px-4 min-h-[40px] rounded-lg border border-transparent cursor-pointer transition-all whitespace-nowrap disabled:opacity-55 disabled:pointer-events-none [&_.material-symbols-outlined]:text-[19px]';

const VARIANTS: Record<string, string> = {
  contained:
    'bg-accent text-fg-on border-transparent shadow-1 hover:bg-accent-hover hover:shadow-2 active:bg-accent-press',
  outlined:
    'bg-transparent text-fg-1 border-border-strong hover:bg-[rgba(128,128,128,0.06)] hover:border-fg-1',
  text: 'bg-transparent text-fg-1 border-transparent hover:bg-[rgba(128,128,128,0.08)]',
  danger:
    'bg-error text-white border-transparent shadow-1 hover:brightness-90 hover:shadow-2',
  'danger-outlined':
    'bg-transparent text-error border-error/50 hover:bg-[rgba(243,22,78,0.08)] hover:border-error',
  oauth:
    'w-full min-h-[48px] bg-surface border border-border-strong text-fg-1 text-base justify-center gap-3 hover:bg-[rgba(128,128,128,0.05)] [&_svg]:w-5 [&_svg]:h-5',
};

export function Button({
  variant = 'contained',
  size,
  block,
  loading,
  disabled,
  icon,
  children,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        BASE,
        VARIANTS[variant],
        size === 'sm' && 'min-h-[34px] px-3 text-xs',
        block && 'w-full',
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <span className="w-[18px] h-[18px] rounded-full border-2 border-current border-r-transparent animate-spin inline-block" />
      ) : icon ? (
        <Icon name={icon} />
      ) : null}
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  className,
  ...rest
}: { icon: string; label: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center w-10 h-10 rounded-full border-none bg-transparent text-fg-2 cursor-pointer transition-colors hover:bg-[rgba(128,128,128,0.12)] hover:text-fg-1 [&_.material-symbols-outlined]:text-[22px]',
        className,
      )}
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  );
}
