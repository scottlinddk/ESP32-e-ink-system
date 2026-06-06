// =========================================================================
// Logo.tsx — Logo mark (3x3 pixel grid) + Icon component
// =========================================================================
import React from 'react';
import { cn } from '../../lib/utils';

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
    <span
      className={cn(
        'logo grid grid-cols-3 grid-rows-3 gap-0.5 bg-accent p-[3px] rounded-[7px] w-[30px] h-[30px]',
        lg && 'w-[56px] h-[56px] rounded-[13px] gap-[3px] p-[6px]',
      )}
      aria-hidden="true"
    >
      {Array.from({ length: 9 }).map((_, i) => (
        <i key={i} />
      ))}
    </span>
  );
}
