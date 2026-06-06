import { cn } from '@/lib/utils';

interface LoadingSpinnerProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  label?: string;
}

const sizeClasses = {
  sm: 'h-4 w-4 border-2',
  md: 'h-8 w-8 border-2',
  lg: 'h-12 w-12 border-4',
};

export function LoadingSpinner({ className, size = 'md', label }: LoadingSpinnerProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2', className)}>
      <div
        className={cn(
          'animate-spin rounded-full border-fg3 border-t-accent',
          sizeClasses[size]
        )}
        role="status"
        aria-label={label ?? 'Loading'}
      />
      {label && <p className="text-sm text-fg2">{label}</p>}
    </div>
  );
}

/** Narrow indeterminate progress bar that fades in after a short delay. */
export function ProgressBar() {
  return (
    <div className="fixed top-0 inset-x-0 h-[3px] z-[100] overflow-hidden animate-progress-fade-in">
      <div className="absolute h-full bg-accent rounded-full animate-progress" />
    </div>
  );
}

export function FullPageSpinner({ label }: { label?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <LoadingSpinner size="lg" label={label ?? 'Loading...'} />
    </div>
  );
}
