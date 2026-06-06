// =========================================================================
// Field.tsx — form field wrapper with label / helper / error
// =========================================================================
import React, { ReactNode } from 'react';
import { cn } from '@/lib/utils';
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
    <div className={cn('flex flex-col gap-1.5', error && 'is-error')}>
      {label && (
        <label
          className={cn('text-sm font-medium text-fg1', error && 'text-error')}
          htmlFor={htmlFor}
        >
          {label}
          {required && <span className="text-error"> *</span>}
        </label>
      )}
      {children}
      {(error || helper) && (
        <span
          className={cn(
            'text-xs text-fg3 flex items-center gap-[5px] [&_.material-symbols-outlined]:text-[15px]',
            error && 'text-error'
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
