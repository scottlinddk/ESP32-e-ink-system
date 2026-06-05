import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        border: {
          DEFAULT: 'var(--color-border)',
          strong: 'var(--color-border-strong)',
        },
        divider: 'var(--color-divider)',
        fg: {
          1: 'var(--fg-1)',
          2: 'var(--fg-2)',
          3: 'var(--fg-3)',
          on: 'var(--fg-on-primary)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          press: 'var(--accent-press)',
        },
        error: 'var(--palette-error-main)',
        warning: 'var(--palette-warning-main)',
        success: 'var(--palette-success-main)',
        info: 'var(--palette-info-main)',
      },
      borderRadius: {
        sm: '4px',
        DEFAULT: '4px',
        md: '8px',
        lg: '8px',
        xl: '12px',
        '2xl': '16px',
        pill: '9999px',
        full: '9999px',
      },
      boxShadow: {
        1: 'var(--shadow-1)',
        2: 'var(--shadow-2)',
        3: 'var(--shadow-3)',
        4: 'var(--shadow-4)',
      },
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
        mono: ['Roboto Mono', 'ui-monospace', 'monospace'],
      },
      keyframes: {
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'none' },
        },
        shimmer: {
          from: { backgroundPosition: '100% 0' },
          to: { backgroundPosition: '-100% 0' },
        },
        progressIndeterminate: {
          '0%': { transform: 'translateX(-100%)' },
          '60%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        toastIn: {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'none' },
        },
        toastOut: {
          to: { opacity: '0', transform: 'translateX(20px)' },
        },
        pop: {
          from: { opacity: '0', transform: 'translateY(-4px)' },
          to: { opacity: '1', transform: 'none' },
        },
        dialogIn: {
          from: { opacity: '0', transform: 'translateY(8px) scale(0.98)' },
          to: { opacity: '1', transform: 'none' },
        },
        appEntrance: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        fade: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
      },
      animation: {
        'fade-up': 'fadeUp 250ms cubic-bezier(0,0,0.2,1)',
        shimmer: 'shimmer 1.3s ease infinite',
        progress: 'progressIndeterminate 1.6s cubic-bezier(0.4,0,0.2,1) 400ms infinite',
        'toast-in': 'toastIn 250ms cubic-bezier(0,0,0.2,1)',
        'toast-out': 'toastOut 225ms cubic-bezier(0.4,0,1,1) forwards',
        pop: 'pop 150ms cubic-bezier(0,0,0.2,1)',
        'dialog-in': 'dialogIn 250ms cubic-bezier(0,0,0.2,1)',
        'page-enter': 'fadeUp 250ms cubic-bezier(0,0,0.2,1)',
        'app-enter': 'appEntrance 300ms cubic-bezier(0,0,0.2,1)',
      },
    },
  },
  plugins: [],
};

export default config;
