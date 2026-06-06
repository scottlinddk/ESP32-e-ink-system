// =========================================================================
// LoginPage.tsx
// =========================================================================
import React, { useState } from 'react';
import { useSignIn } from '@clerk/clerk-react';
import { useApp } from '../lib/appContext';
import { Logo, Icon } from '../components/ui/Logo';
import { Card } from '../components/ui/card';
import { Spinner } from '../components/ui/Spinner';
import { LangToggle, ThemeToggle } from '../components/shell/AppBar';

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="w-5 h-5">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.57c2.08-1.92 3.27-4.74 3.27-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.76c-.99.66-2.26 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.05l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  );
}

function GitHubGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" className="w-5 h-5">
      <path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.868-.013-1.703-2.782.604-3.369-1.341-3.369-1.341-.454-1.154-1.11-1.461-1.11-1.461-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.202 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
    </svg>
  );
}

const FEATURES = [
  { icon: 'bolt', text: 'Live energy spot prices (Energinet)' },
  { icon: 'partly_cloudy_day', text: 'Local weather conditions' },
  { icon: 'article', text: 'Top news headlines' },
  { icon: 'memory', text: 'ESP32 + 2.13″ e-ink hardware' },
];

export function LoginPage() {
  const app = useApp();
  const t = app.t;
  const { signIn, isLoaded } = useSignIn();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [showFeatures, setShowFeatures] = useState(false);

  async function go(provider: 'google' | 'github') {
    if (!isLoaded || !signIn) return;
    setError(false);
    setLoading(provider);
    try {
      await signIn.authenticateWithRedirect({
        strategy: `oauth_${provider}`,
        redirectUrl: `${window.location.origin}/sso-callback`,
        redirectUrlComplete: window.location.origin,
      });
    } catch {
      setLoading(null);
      setError(true);
    }
  }

  return (
    <div className="flex-1 flex items-center justify-center p-6 min-h-screen animate-fade-up">
      {/* Top-right controls */}
      <div className="fixed top-4 right-4 flex gap-2 z-10">
        <LangToggle />
        <ThemeToggle />
      </div>

      <div className="w-full max-w-[420px]">
        {/* Brand */}
        <div className="flex flex-col items-center gap-4 mb-6 text-center">
          <Logo lg />
          <div>
            <h1 className="text-h1 font-light tracking-tight m-0">{t.product}</h1>
            <p className="text-fg2 text-body mt-2 mb-0">{t.tagline}</p>
          </div>
        </div>

        <Card>
          {error && (
            <div
              className="flex gap-2.5 items-start px-3.5 py-3 rounded-sm mb-4 bg-error/[0.08] text-error [&_.material-symbols-outlined]:text-[19px]"
              role="alert"
            >
              <Icon name="error" />
              <div>
                <strong className="font-medium">{t.authFailed}</strong>
                <div className="text-xs mt-0.5 opacity-85">{t.authFailedMsg}</div>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-3">
            {(
              [
                { provider: 'google', glyph: <GoogleGlyph />, label: t.signInGoogle },
                { provider: 'github', glyph: <GitHubGlyph />, label: t.signInGithub },
              ] as const
            ).map(({ provider, glyph, label }) => (
              <button
                key={provider}
                className="w-full min-h-[48px] bg-surface border border-border-strong text-fg1 text-base flex items-center justify-center gap-3 rounded-md cursor-pointer transition-[background] duration-[150ms] hover:bg-black/[0.05] disabled:opacity-55 disabled:pointer-events-none"
                onClick={() => go(provider)}
                disabled={!!loading}
              >
                {loading === provider ? <Spinner /> : glyph}
                {loading === provider ? t.signingIn : label}
              </button>
            ))}
          </div>

          <div className="text-center mt-5 text-xs text-fg3">{t.loginFoot}</div>
        </Card>

        {/* "What is this?" expandable */}
        <div className="mt-4 text-center">
          <button
            className="text-info text-xs cursor-pointer bg-none border-none p-0 hover:underline inline-flex items-center gap-1"
            onClick={() => setShowFeatures((s) => !s)}
            aria-expanded={showFeatures}
          >
            {t.whatIsThis}
            <Icon name={showFeatures ? 'expand_less' : 'expand_more'} className="!text-[16px]" />
          </button>

          {showFeatures && (
            <div className="mt-3 text-left bg-surface border border-border rounded-md p-4 animate-fade-up">
              <p className="text-sm text-fg2 mb-3">
                An always-on dashboard for your ESP32 e-ink display, showing:
              </p>
              <ul className="list-none m-0 p-0 flex flex-col gap-2">
                {FEATURES.map((f) => (
                  <li
                    key={f.icon}
                    className="flex items-center gap-2.5 text-sm text-fg1 [&_.material-symbols-outlined]:text-[18px] [&_.material-symbols-outlined]:text-accent"
                  >
                    <Icon name={f.icon} />
                    {f.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
