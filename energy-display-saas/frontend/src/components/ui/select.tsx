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
    <select id={id} className="select-native" value={value} onChange={onChange} {...rest}>
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
