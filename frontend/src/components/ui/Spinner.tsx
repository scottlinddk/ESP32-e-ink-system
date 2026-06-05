// =========================================================================
// Spinner.tsx — spinner + LoadBox + Skeleton
// =========================================================================
import React from 'react';
import { cn } from '../../lib/utils';

export function Spinner({ lg }: { lg?: boolean }) {
  return (
    <span
      className={cn(
        'inline-block rounded-full border-2 border-current border-r-transparent animate-spin',
        lg ? 'w-[30px] h-[30px] border-[3px]' : 'w-[18px] h-[18px]',
      )}
    />
  );
}

export function LoadBox({ text }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 px-4 text-fg-2 text-sm">
      <Spinner lg />
      {text && <span>{text}</span>}
    </div>
  );
}

export function Skeleton({
  w = '100%',
  h = 14,
  style,
}: {
  w?: string | number;
  h?: number;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className="block rounded animate-shimmer"
      style={{
        display: 'block',
        width: w,
        height: h,
        background: 'linear-gradient(90deg, rgba(128,128,128,0.10) 0%, rgba(128,128,128,0.18) 50%, rgba(128,128,128,0.10) 100%)',
        backgroundSize: '400% 100%',
        ...style,
      }}
    />
  );
}
