// =========================================================================
// input.tsx — text input + PasswordInput
// =========================================================================
import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { Icon } from './Logo';
import { STRINGS, Lang } from '../../lib/strings';

const inputBase =
  'font-sans text-sm text-fg1 px-3 py-2.5 min-h-[42px] rounded-sm border border-border-strong ' +
  'bg-surface outline-none w-full transition-[border-color,box-shadow] duration-[150ms] ' +
  'placeholder:text-fg3 focus:border-accent focus:shadow-[0_0_0_1px_var(--accent)]';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean;
  invalid?: boolean;
  helpId?: string;
}

export function Input({ mono, invalid, id, helpId, className, ...rest }: InputProps) {
  return (
    <input
      id={id}
      className={cn(inputBase, mono && 'font-mono tracking-[0.02em]', className)}
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
        className={cn(inputBase, 'pr-11', mono && 'font-mono tracking-[0.02em]')}
        aria-describedby={helpId}
        {...rest}
      />
      <button
        type="button"
        className="absolute right-1 w-[34px] h-[34px] rounded-sm border-none bg-transparent text-fg3 cursor-pointer inline-flex items-center justify-center hover:bg-black/[0.12] hover:text-fg1 [&_.material-symbols-outlined]:text-[19px]"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? t.hide : t.show}
        title={show ? t.hide : t.show}
      >
        <Icon name={show ? 'visibility_off' : 'visibility'} />
      </button>
    </div>
  );
}
