// =========================================================================
// input.tsx — text input + PasswordInput (canonical implementation)
// =========================================================================
import React, { useState } from 'react';
import { Icon } from './Logo';
import { STRINGS, Lang } from '../../lib/strings';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean;
  invalid?: boolean;
  helpId?: string;
}

export function Input({ mono, invalid, id, helpId, className, ...rest }: InputProps) {
  return (
    <input
      id={id}
      className={'input' + (mono ? ' input--mono' : '') + (className ? ' ' + className : '')}
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
    <div className="input-affix">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={'input' + (mono ? ' input--mono' : '')}
        aria-describedby={helpId}
        {...rest}
      />
      <button
        type="button"
        className="input-affix__btn"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? t.hide : t.show}
        title={show ? t.hide : t.show}
      >
        <Icon name={show ? 'visibility_off' : 'visibility'} />
      </button>
    </div>
  );
}
