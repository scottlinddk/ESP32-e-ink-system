// =========================================================================
// Field.tsx — form field wrapper with label / helper / error
// =========================================================================
import React, { ReactNode } from 'react';
import { Icon } from './Logo';

interface FieldProps {
  label?: string;
  htmlFor?: string;
  required?: boolean;
  error?: string;
  helper?: string;
  children?: ReactNode;
}

export function Field({ label, htmlFor, required, error, helper, children }: FieldProps) {
  return (
    <div className={'field' + (error ? ' is-error' : '')}>
      {label && (
        <label className="field__label" htmlFor={htmlFor}>
          {label}
          {required && <span className="req"> *</span>}
        </label>
      )}
      {children}
      {(error || helper) && (
        <span
          className={'helper' + (error ? ' is-error' : '')}
          id={htmlFor ? htmlFor + '-help' : undefined}
        >
          {error && <Icon name="error" />}
          {error || helper}
        </span>
      )}
    </div>
  );
}
