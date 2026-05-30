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
    <div className="empty">
      <div className="empty__icon">
        <Icon name={icon} />
      </div>
      <h3 className="empty__title">{title}</h3>
      <p className="empty__text">{text}</p>
      {action}
    </div>
  );
}
