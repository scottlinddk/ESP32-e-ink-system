// Legacy shadcn badge — superseded by Chip.tsx (new design system).
import React from 'react';
export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & { variant?: string };
export function Badge({ variant: _v, ...props }: BadgeProps) {
  return <span {...props} />;
}
export const badgeVariants = () => '';
