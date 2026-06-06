// =========================================================================
// LoginPage.tsx
// =========================================================================
import React, { useState } from 'react';
import { useSignIn } from '@clerk/react-router';
import { useApp } from '../lib/appContext';
import { Logo, Icon } from '../components/ui/Logo';
import { Card } from '../components/ui/card';
import { Spinner } from '../components/ui/Spinner';
import { Button } from '../components/ui/button';
import { LangToggle, ThemeToggle } from '../components/shell/AppBar';
import { cn } from '../lib/utils';

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="w-5 h-5">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.57c2.08-1.92 3.27-4.74 3.27-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.76c-.99.66-2.26 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.05l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}

function AppleGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" className="w-5 h-5">
      <path d="M17.05 12.54c-.03-2.6 2.12-3.85 2.22-3.91-1.21-1.77-3.1-2.01-3.77-2.04-1.6-.16-3.13.94-3.94.94-.81 0-2.07-.92-3.4-.9-1.75.03-3.36 1.02-4.26 2.58-1.82 3.15-.47 7.82 1.3 10.38.86 1.25 1.89 2.66 3.24 2.61 1.3-.05 1.79-.84 3.36-.84 1.57 0 2.01.84 3.39.81 1.4-.02 2.29-1.28 3.15-2.54.99-1.46 1.4-2.87 1.42-2.94-.03-.01-2.72-1.04-2.75-4.13zM14.6 4.7c.72-.87 1.2-2.08 1.07-3.28-1.03.04-2.28.69-3.02 1.56-.66.77-1.24 2-1.08 3.18 1.15.09 2.32-.58 3.03-1.46z" />
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
  { icon: 'bolt', text: 'Live energy spot prices, updated hourly' },
  { icon: 'partly_cloudy_day', text: 'Current weather from OpenWeatherMap' },
  { icon: 'article', text: 'Top headline from your chosen news source' },
  { icon: 'devices', text: 'Works with any ESP32 + 2.13″ e-ink display' },
];

export function LoginPage() {
  const app = useApp();
  const t = app.t;
  const { signIn, fetchStatus } = useSignIn();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [showFeatures, setShowFeatures] = useState(false);

  async function go(provider: 'google' | 'apple' | 'github') {
    if (fetchStatus !== 'idle' || !signIn) return;
    setError(false);
    setLoading(provider);
    try {
      const result = await signIn.sso({
        strategy: `oauth_${provider}` as const,
        redirectCallbackUrl: `${window.location.origin}/sso-callback`,
        redirectUrl: window.location.origin,
      });
      if (result.error) {
        setLoading(null);
        setError(true);
      }
    } catch {
      setLoading(null);
      setError(true);
    }
  }

  return (
    <div className="flex-1 flex items-center justify-center p-6 min-h-screen">
      <div className="fixed top-4 right-4 flex gap-2 z-10">
        <LangToggle />
        <ThemeToggle />
      </div>
      <div className="w-full max-w-[420px]">
        <div className="flex flex-col items-center gap-4 mb-6 text-center">
          <Logo lg />
          <div>
            <h1 className="text-[2.5rem] font-light tracking-tight m-0">{t.product}</h1>
            <p className="text-fg-2 text-base mt-2 m-0">{t.tagline}</p>
          </div>
        </div>
        <Card>
          {error && (
            <div
              className="flex gap-[10px] items-start px-[14px] py-3 rounded bg-[rgba(243,22,78,0.08)] text-error text-sm leading-[1.5] [&_.material-symbols-outlined]:text-[19px] [&_.material-symbols-outlined]:flex-shrink-0 [&_.material-symbols-outlined]:mt-[1px] mb-4"
              role="alert"
            >
              <Icon name="error" />
              <div>
                <strong style={{ fontWeight: 500 }}>{t.authFailed}</strong>
                <div className="text-sm opacity-85">
                  {t.authFailedMsg}
                </div>
              </div>
            </div>
          )}
          <div className="flex flex-col gap-3">
            <Button
              variant="oauth"
              onClick={() => go('google')}
              disabled={!!loading || fetchStatus !== 'idle'}
            >
              {loading === 'google' ? <Spinner /> : <GoogleGlyph />}
              {loading === 'google' ? t.signingIn : t.signInGoogle}
            </Button>
            <Button
              variant="oauth"
              onClick={() => go('apple')}
              disabled={!!loading || fetchStatus !== 'idle'}
            >
              {loading === 'apple' ? <Spinner /> : <AppleGlyph />}
              {loading === 'apple' ? t.signingIn : t.signInApple}
            </Button>
            <Button
              variant="oauth"
              onClick={() => go('github')}
              disabled={!!loading || fetchStatus !== 'idle'}
            >
              {loading === 'github' ? <Spinner /> : <GitHubGlyph />}
              {loading === 'github' ? t.signingIn : t.signInGithub}
            </Button>
          </div>
          <div className="text-center mt-5 text-xs text-fg-3">{t.loginFoot}</div>
        </Card>

        <div className="mt-4">
          <button
            className="flex items-center gap-1.5 w-full text-sm text-fg-2 bg-transparent border-none cursor-pointer px-0 py-2 hover:text-fg-1 [&_.material-symbols-outlined]:text-[18px]"
            onClick={() => setShowFeatures((v) => !v)}
            aria-expanded={showFeatures}
          >
            <span>{t.whatIsThis}</span>
            <Icon name={showFeatures ? 'expand_less' : 'expand_more'} />
          </button>

          {showFeatures && (
            <div className="mt-2 flex flex-col gap-2 animate-fade-up">
              {FEATURES.map((f) => (
                <div
                  key={f.icon}
                  className="flex items-center gap-3 text-sm text-fg-2 py-1.5 [&_.material-symbols-outlined]:text-[20px] [&_.material-symbols-outlined]:text-accent"
                >
                  <Icon name={f.icon} />
                  <span>{f.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
