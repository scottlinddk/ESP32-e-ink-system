// =========================================================================
// checkbox.tsx — custom checkbox (canonical implementation)
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
    <span className="checkbox">
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={onChange}
        aria-label={label}
        {...rest}
      />
      <span className="checkbox__box">
        <Icon name="check" />
      </span>
    </span>
  );
}
