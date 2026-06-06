// =========================================================================
// button.tsx — MUI-style button + IconButton
// =========================================================================
import React from 'react';
import { cn } from '@/lib/utils';
import { Icon } from './Logo';
import { Spinner } from './Spinner';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'contained' | 'outlined' | 'text' | 'danger' | 'danger-outlined' | 'oauth';
  size?: 'sm';
  block?: boolean;
  loading?: boolean;
  icon?: string;
}

const variantClasses: Record<string, string> = {
  contained:
    'bg-accent text-fg-on shadow-1 hover:bg-accent-hover hover:shadow-2 active:bg-accent-press active:shadow-none',
  outlined:
    'bg-transparent text-fg1 border border-border-strong hover:bg-black/[0.06] hover:border-fg1',
  text: 'bg-transparent text-fg1 hover:bg-black/[0.08]',
  danger:
    'bg-error text-white shadow-1 hover:bg-[#d01244] hover:shadow-2',
  'danger-outlined':
    'bg-transparent text-error border border-error/50 hover:bg-error/[0.08] hover:border-error',
  oauth:
    'w-full bg-surface text-fg1 border border-border-strong justify-center gap-3 hover:bg-black/[0.05] min-h-[48px] text-base',
};

export function Button({
  variant = 'contained',
  size,
  block,
  loading,
  disabled,
  icon,
  children,
  type = 'button',
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 text-sm font-medium tracking-[0.01em]',
        'px-4 min-h-[40px] rounded-md border border-transparent cursor-pointer whitespace-nowrap',
        'transition-[background,box-shadow,border-color] duration-[150ms]',
        'disabled:opacity-55 disabled:cursor-default disabled:shadow-none disabled:pointer-events-none',
        '[&_.material-symbols-outlined]:text-[19px]',
        variantClasses[variant] ?? variantClasses.contained,
        size === 'sm' && 'min-h-[34px] px-3 text-xs',
        block && 'w-full',
        className
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Spinner /> : icon ? <Icon name={icon} /> : null}
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
        'inline-flex items-center justify-center w-10 h-10 rounded-pill',
        'border-none bg-transparent text-fg2 cursor-pointer',
        'transition-[background] duration-[150ms]',
        'hover:bg-black/[0.12] hover:text-fg1',
        '[&_.material-symbols-outlined]:text-[22px]',
        className
      )}
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  );
}
