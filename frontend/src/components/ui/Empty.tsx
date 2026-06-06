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
      <div className="w-16 h-16 rounded-pill bg-black/[0.10] flex items-center justify-center mx-auto mb-4 text-fg3 [&_.material-symbols-outlined]:text-[32px]">
        <Icon name={icon} />
      </div>
      <h3 className="text-h5 font-medium m-0 mb-1.5">{title}</h3>
      <p className="text-sm text-fg2 m-0 mx-auto mb-4 max-w-xs">{text}</p>
      {action}
    </div>
  );
}
