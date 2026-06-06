// =========================================================================
// checkbox.tsx — custom checkbox (canonical implementation)
// =========================================================================
import React from 'react';
import { Icon } from './Logo';
import { cn } from '../../lib/utils';

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
        className="absolute opacity-0 inset-0 m-0 cursor-pointer"
        {...rest}
      />
      <span
        className={cn(
          'w-5 h-5 rounded border-2 border-border-strong flex items-center justify-center transition-all',
          checked && 'bg-accent border-accent',
        )}
      >
        <Icon
          name="check"
          className={cn('transition-all', checked ? 'opacity-100 scale-100' : 'opacity-0 scale-50')}
          style={{ fontSize: 16, color: 'var(--fg-on-primary)' }}
        />
      </span>
    </span>
  );
}
