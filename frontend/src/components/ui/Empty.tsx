// =========================================================================
// Empty.tsx — empty state component
// =========================================================================
import React, { ReactNode } from 'react';
import { Icon } from './Logo';

interface EmptyProps {
  icon: string;
  title: string;
  text: string;
  action?: ReactNode;
}

export function Empty({ icon, title, text, action }: EmptyProps) {
  return (
    <div className="text-center py-12 px-4">
      <div className="w-16 h-16 rounded-full bg-[rgba(128,128,128,0.1)] flex items-center justify-center mx-auto mb-4 text-fg-3 [&_.material-symbols-outlined]:text-[32px]">
        <Icon name={icon} />
      </div>
      <h3 className="text-lg font-medium m-0 mb-1.5">{title}</h3>
      <p className="text-sm text-fg-2 m-0 mx-auto mb-4 max-w-[320px]">{text}</p>
      {action}
    </div>
  );
}
