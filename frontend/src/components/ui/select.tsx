// =========================================================================
// select.tsx — native select element styled with design tokens
// =========================================================================
import React from 'react';
import { cn } from '@/lib/utils';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  options: SelectOption[];
  id?: string;
  disabled?: boolean;
  className?: string;
}

export function Select({ value, onChange, options, id, className, ...rest }: SelectProps) {
  return (
    <select
      id={id}
      className={cn(
        'select-native font-sans text-sm text-fg1 px-3 py-2.5 min-h-[42px] rounded-sm',
        'border border-border-strong bg-surface outline-none w-full',
        'transition-[border-color,box-shadow] duration-[150ms]',
        'focus:border-accent focus:shadow-[0_0_0_1px_var(--accent)]',
        className
      )}
      value={value}
      onChange={onChange}
      {...rest}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// Legacy shadcn Select API shim
export const SelectContent = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
export const SelectItem = ({ value, children }: { value: string; children?: React.ReactNode }) => (
  <option value={value}>{children}</option>
);
export const SelectTrigger = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
export const SelectValue = ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>;
