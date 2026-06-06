// =========================================================================
// select.tsx — native select element styled with design tokens (canonical)
// =========================================================================
import React from 'react';

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
}

export function Select({ value, onChange, options, id, ...rest }: SelectProps) {
  return (
    <select
      id={id}
      className="select-native font-sans text-sm text-fg-1 px-3 py-[10px] min-h-[42px] rounded border border-border-strong bg-surface outline-none w-full transition-colors focus:border-accent focus:ring-1 focus:ring-accent appearance-none cursor-pointer"
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

// Legacy shadcn Select API shim (for old DataSourceToggle etc.)
export const SelectContent = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
export const SelectItem = ({ value, children }: { value: string; children?: React.ReactNode }) => <option value={value}>{children}</option>;
export const SelectTrigger = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
export const SelectValue = ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>;
