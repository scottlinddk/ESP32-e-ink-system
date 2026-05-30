// =========================================================================
// Spinner.tsx — spinner + LoadBox + Skeleton
// =========================================================================
import React from 'react';

export function Spinner({ lg }: { lg?: boolean }) {
  return <span className={'spinner' + (lg ? ' spinner--lg' : '')} />;
}

export function LoadBox({ text }: { text?: string }) {
  return (
    <div className="loadbox">
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
