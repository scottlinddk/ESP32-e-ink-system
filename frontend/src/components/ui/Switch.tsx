// =========================================================================
// Switch.tsx — toggle switch
// =========================================================================
import React from 'react';

interface SwitchProps {
  checked: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  label?: string;
  disabled?: boolean;
}

export function Switch({ checked, onChange, label, ...rest }: SwitchProps) {
  return (
    <span className="switch">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={onChange}
        aria-label={label}
        {...rest}
      />
      <span className="switch__track" />
      <span className="switch__thumb" />
    </span>
  );
}
