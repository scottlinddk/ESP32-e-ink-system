// =========================================================================
// card.tsx — surface card with optional head / body / footer
// =========================================================================
import React, { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Icon } from './Logo';

interface CardProps {
  icon?: string;
  title?: string;
  desc?: string;
  action?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  flat?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function Card({
  icon,
  title,
  desc,
  action,
  children,
  footer,
  flat,
  className = '',
  style,
}: CardProps) {
  return (
    <section
      className={cn(
        'bg-surface rounded-md border border-border overflow-hidden',
        !flat && 'shadow-1',
        className
      )}
      style={style}
    >
      {(title || icon) && (
        <header className="px-5 py-4 border-b border-divider">
          <div className="flex items-center gap-3">
            {icon && (
              <span className="text-fg3 inline-flex [&_.material-symbols-outlined]:text-[22px]">
                <Icon name={icon} />
              </span>
            )}
            <div className="flex-1 min-w-0">
              <h2 className="text-h6 font-medium m-0">{title}</h2>
              {desc && <p className="text-sm text-fg2 mt-1 mb-0">{desc}</p>}
            </div>
            {action}
          </div>
        </header>
      )}
      <div className="p-5">{children}</div>
      {footer && (
        <footer className="px-5 py-4 border-t border-divider flex items-center gap-3 justify-end">
          {footer}
        </footer>
      )}
    </section>
  );
}
