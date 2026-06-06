import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'],
  theme: {
    extend: {
      colors: {
        accent: 'var(--accent)',
        'accent-hover': 'var(--accent-hover)',
        'accent-press': 'var(--accent-press)',
        bg: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        border: {
          DEFAULT: 'var(--color-border)',
          strong: 'var(--color-border-strong)',
        },
        divider: 'var(--color-divider)',
        fg1: 'var(--fg-1)',
        fg2: 'var(--fg-2)',
        fg3: 'var(--fg-3)',
        'fg-on': 'var(--fg-on-primary)',
        error: 'var(--palette-error-main)',
        warning: 'var(--palette-warning-main)',
        info: 'var(--palette-info-main)',
        success: 'var(--palette-success-main)',
      },
      boxShadow: {
        '1': 'var(--shadow-1)',
        '2': 'var(--shadow-2)',
        '3': 'var(--shadow-3)',
        '4': 'var(--shadow-4)',
      },
      fontFamily: {
        sans: ['DM Sans', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['Roboto Mono', 'ui-monospace', 'SF Mono', 'Menlo', 'monospace'],
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        pill: 'var(--radius-pill)',
      },
      fontSize: {
        h1: 'var(--fs-h1)',
        h2: 'var(--fs-h2)',
        h3: 'var(--fs-h3)',
        h4: 'var(--fs-h4)',
        h5: 'var(--fs-h5)',
        h6: 'var(--fs-h6)',
        body: 'var(--fs-body)',
        sm: 'var(--fs-body-sm)',
        caption: 'var(--fs-caption)',
      },
      keyframes: {
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          from: { backgroundPosition: '100% 0' },
          to: { backgroundPosition: '-100% 0' },
        },
        progress: {
          '0%': { left: '-35%', width: '35%' },
          '100%': { left: '110%', width: '35%' },
        },
        pop: {
          from: { opacity: '0', transform: 'translateY(-4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        toastIn: {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        toastOut: {
          to: { opacity: '0', transform: 'translateX(20px)' },
        },
        dialogIn: {
          from: { opacity: '0', transform: 'translateY(8px) scale(0.98)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        scrimFade: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        progressFadeIn: {
          '0%': { opacity: '0' },
          '50%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
      animation: {
        'fade-up': 'fadeUp 200ms cubic-bezier(0,0,0.2,1) both',
        shimmer: 'shimmer 1.3s ease infinite',
        progress: 'progress 1.2s linear infinite',
        pop: 'pop 150ms cubic-bezier(0,0,0.2,1)',
        'toast-in': 'toastIn 225ms cubic-bezier(0,0,0.2,1)',
        'toast-out': 'toastOut 225ms cubic-bezier(0.4,0,1,1) forwards',
        'dialog-in': 'dialogIn 225ms cubic-bezier(0,0,0.2,1)',
        'scrim-fade': 'scrimFade 225ms cubic-bezier(0.4,0,0.2,1)',
        'progress-fade-in': 'progressFadeIn 600ms ease forwards',
      },
    },
  },
  plugins: [],
};

export default config;
