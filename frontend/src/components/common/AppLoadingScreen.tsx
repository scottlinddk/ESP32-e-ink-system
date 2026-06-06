import { Logo } from '../ui/Logo';
import { useApp } from '../../lib/appContext';

export function AppLoadingScreen() {
  const app = useApp();
  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center gap-6 bg-bg z-[100] animate-app-enter"
      role="status"
      aria-label={app.t.loading}
    >
      <div className="flex flex-col items-center gap-3 animate-fade-up">
        <Logo lg />
        <div style={{ textAlign: 'center' }}>
          <p className="text-lg font-medium tracking-tight text-fg-1 m-0">{app.t.product}</p>
          <p className="text-xs text-fg-3 m-0">{app.t.tagline}</p>
        </div>
      </div>
      <div
        className="w-40 h-[3px] bg-[rgba(128,128,128,0.15)] rounded-full overflow-hidden animate-fade-up"
        aria-hidden="true"
      >
        <div className="h-full w-1/2 bg-accent rounded-full animate-progress" />
      </div>
    </div>
  );
}
