// =========================================================================
// Field.tsx — form field wrapper with label / helper / error
// =========================================================================
import React, { ReactNode } from 'react';
import { Icon } from './Logo';
import { cn } from '../../lib/utils';

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
    <div className="flex flex-col gap-1.5">
      {label && (
        <label className="text-sm font-medium text-fg-1" htmlFor={htmlFor}>
          {label}
          {required && <span className="text-error"> *</span>}
        </label>
      )}
      {children}
      {(error || helper) && (
        <span
          className={cn(
            'text-xs text-fg-3 flex items-center gap-[5px] [&_.material-symbols-outlined]:text-[15px]',
            error && 'text-error',
          )}
          id={htmlFor ? htmlFor + '-help' : undefined}
        >
          {error && <Icon name="error" />}
          {error || helper}
        </span>
      )}
    </div>
  );
}
