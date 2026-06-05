import { Logo } from '../ui/Logo';
import { useApp } from '../../lib/appContext';

export function AppLoadingScreen() {
  const app = useApp();
  return (
    <div className="app-init" role="status" aria-label={app.t.loading}>
      <div className="app-init__brand">
        <Logo lg />
        <div style={{ textAlign: 'center' }}>
          <p className="app-init__name">{app.t.product}</p>
          <p className="app-init__sub">{app.t.tagline}</p>
        </div>
      </div>
      <span className="spinner spinner--lg" aria-hidden="true" />
    </div>
  );
}
