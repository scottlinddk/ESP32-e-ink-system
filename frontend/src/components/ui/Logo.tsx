// =========================================================================
// Logo.tsx — Logo mark (3x3 pixel grid) + Icon component
// =========================================================================
import React from 'react';

export function Icon({
  name,
  className = '',
  style,
}: {
  name: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className={'material-symbols-outlined ' + className}
      style={style}
      aria-hidden="true"
    >
      {name}
    </span>
  );
}

export function Logo({ lg }: { lg?: boolean }) {
  return (
    <span className={'logo' + (lg ? ' logo--lg' : '')} aria-hidden="true">
      {Array.from({ length: 9 }).map((_, i) => (
        <i key={i} />
      ))}
    </span>
  );
}
