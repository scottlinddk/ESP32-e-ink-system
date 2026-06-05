// =========================================================================
// input.tsx — text input + PasswordInput (canonical implementation)
// =========================================================================
import React, { useState } from 'react';
import { Icon } from './Logo';
import { STRINGS, Lang } from '../../lib/strings';
import { cn } from '../../lib/utils';

const INPUT_BASE =
  'font-sans text-sm text-fg-1 px-3 py-[10px] min-h-[42px] rounded border border-border-strong bg-surface outline-none w-full transition-colors focus:border-accent focus:ring-1 focus:ring-accent placeholder:text-fg-3';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean;
  invalid?: boolean;
  helpId?: string;
}

export function Input({ mono, invalid, id, helpId, className, ...rest }: InputProps) {
  return (
    <input
      id={id}
      className={cn(INPUT_BASE, mono && 'font-mono tracking-[0.02em]', className)}
      aria-invalid={invalid || undefined}
      aria-describedby={helpId}
      {...rest}
    />
  );
}

interface PasswordInputProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  id?: string;
  placeholder?: string;
  mono?: boolean;
  helpId?: string;
  lang?: Lang;
  disabled?: boolean;
  autoComplete?: string;
}

export function PasswordInput({
  value,
  onChange,
  id,
  placeholder,
  mono = true,
  helpId,
  lang = 'en',
  ...rest
}: PasswordInputProps) {
  const [show, setShow] = useState(false);
  const t = STRINGS[lang];
  return (
    <div className="relative flex items-center">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={cn(INPUT_BASE, mono && 'font-mono tracking-[0.02em]', 'pr-11')}
        aria-describedby={helpId}
        {...rest}
      />
      <button
        type="button"
        className="absolute right-1 w-[34px] h-[34px] rounded border-none bg-transparent text-fg-3 cursor-pointer inline-flex items-center justify-center hover:bg-[rgba(128,128,128,0.12)] hover:text-fg-1 [&_.material-symbols-outlined]:text-[19px]"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? t.hide : t.show}
        title={show ? t.hide : t.show}
      >
        <Icon name={show ? 'visibility_off' : 'visibility'} />
      </button>
    </div>
  );
}
