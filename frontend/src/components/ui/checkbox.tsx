// =========================================================================
// checkbox.tsx — custom checkbox
// =========================================================================
import React from 'react';
import { Icon } from './Logo';

interface CheckboxProps {
  checked: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  id?: string;
  label?: string;
  disabled?: boolean;
}

export function Checkbox({ checked, onChange, id, label, ...rest }: CheckboxProps) {
  return (
    <span className="relative flex-shrink-0 w-5 h-5 mt-[9px]">
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={onChange}
        aria-label={label}
        className="absolute opacity-0 w-full h-full m-0 cursor-pointer"
        {...rest}
      />
      <span
        className={[
          'w-5 h-5 rounded-sm border-2 flex items-center justify-center',
          'transition-all duration-[150ms]',
          checked
            ? 'bg-accent border-accent'
            : 'bg-transparent border-border-strong',
          '[&_.material-symbols-outlined]:text-[16px] [&_.material-symbols-outlined]:text-fg-on',
          checked ? '[&_.material-symbols-outlined]:opacity-100 [&_.material-symbols-outlined]:scale-100' : '[&_.material-symbols-outlined]:opacity-0 [&_.material-symbols-outlined]:scale-[0.6]',
        ].join(' ')}
      >
        <Icon name="check" />
      </span>
    </span>
  );
}
