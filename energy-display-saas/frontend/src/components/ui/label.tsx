// Legacy shadcn label — superseded by Field.tsx (new design system).
import React from 'react';
export type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement>;
export const Label = React.forwardRef<HTMLLabelElement, LabelProps>((props, ref) => <label ref={ref} {...props} />);
Label.displayName = 'LegacyLabel';
