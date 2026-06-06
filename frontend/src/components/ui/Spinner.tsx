// =========================================================================
// Spinner.tsx — spinner + LoadBox + Skeleton
// =========================================================================
import React from 'react';
import { cn } from '@/lib/utils';

export function Spinner({ lg, className }: { lg?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        'inline-block rounded-full border-2 border-current border-r-transparent animate-spin',
        lg ? 'w-[30px] h-[30px] border-[3px]' : 'w-[18px] h-[18px]',
        className
      )}
    />
  );
}

export function LoadBox({ text }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 px-4 text-fg2 text-sm">
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
      className="skel"
      style={{ display: 'block', width: w, height: h, ...style }}
    />
  );
}
