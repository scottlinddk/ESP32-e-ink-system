// =========================================================================
// card.tsx — surface card with optional head / body / footer (canonical)
// =========================================================================
import React, { ReactNode } from 'react';
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
      className={'card' + (flat ? ' card--flat' : '') + (className ? ' ' + className : '')}
      style={style}
    >
      {(title || icon) && (
        <header className="card__head">
          <div className="card__head-row">
            {icon && (
              <span className="card__icon">
                <Icon name={icon} />
              </span>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 className="card__title">{title}</h2>
              {desc && <p className="card__desc">{desc}</p>}
            </div>
            {action}
          </div>
        </header>
      )}
      <div className="card__body">{children}</div>
      {footer && <footer className="card__foot">{footer}</footer>}
    </section>
  );
}
