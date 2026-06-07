// =========================================================================
// appContext.tsx — global app state, context, and AppProvider
// =========================================================================
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  ReactNode,
} from 'react';
import { STRINGS, Lang, Strings } from './strings';
import type {
  Preferences,
  AppDevice,
  ApiKeyEntry,
  ToastData,
  AppUser,
  UsageData,
} from '../types';

// ---- localStorage helpers ----
function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem('ed_' + key);
    return v == null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
function save<T>(key: string, val: T): void {
  try {
    localStorage.setItem('ed_' + key, JSON.stringify(val));
  } catch {
    // ignore
  }
}

// ---- AppState interface ----
export interface AppState {
  theme: 'light' | 'dark';
  lang: Lang;
  online: boolean;
  navOpen: boolean;
  user: AppUser;
  prefs: Preferences;
  apiKeys: Record<string, ApiKeyEntry>;
  devices: AppDevice[];
  usage: UsageData;
  t: Strings;
  toasts: (ToastData & { id: number })[];
  // actions
  setLang: (l: Lang) => void;
  toggleTheme: () => void;
  setUser: (u: AppUser) => void;
  setPrefs: (p: Preferences) => void;
  setApiKeys: (k: Record<string, ApiKeyEntry>) => void;
  setDevices: (d: AppDevice[]) => void;
  setOnline: (v: boolean) => void;
  setNavOpen: (open: boolean) => void;
  toast: (obj: ToastData) => void;
  dismiss: (id: number) => void;
}

const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}

const DEFAULT_PREFS: Preferences = {
  energy: { on: true, zone: 'DK1' },
  weather: { on: true, location: '57.05, 9.92' },
  news: { on: false, lang: 'da', source: 'dr' },
  monta: { on: false, fields: ['charger_status', 'active_session'] },
  zaptec: { on: false, fields: ['charger_status', 'active_session'] },
};

const DEFAULT_USER: AppUser = {
  name: '',
  email: '',
};

const USAGE: UsageData = { apiCalls: 312, apiLimit: 1000, deviceLimit: 5 };

export function AppProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<'light' | 'dark'>(() =>
    load<'light' | 'dark'>('theme', 'light')
  );
  const [lang, setLangState] = useState<Lang>(() => load<Lang>('lang', 'en'));
  const [online, setOnlineState] = useState<boolean>(true);
  const [navOpen, setNavOpen] = useState<boolean>(false);
  const [user, setUserState] = useState<AppUser>(() => load<AppUser>('user', DEFAULT_USER));
  const [prefs, setPrefsState] = useState<Preferences>(() => {
    const stored = load<Partial<Preferences>>('prefs', {});
    return { ...DEFAULT_PREFS, ...stored };
  });
  const [apiKeys, setApiKeysState] = useState<Record<string, ApiKeyEntry>>(() =>
    load<Record<string, ApiKeyEntry>>('apiKeys', {})
  );
  const [devices, setDevicesState] = useState<AppDevice[]>(() =>
    load<AppDevice[]>('devices', [])
  );
  const [toasts, setToasts] = useState<(ToastData & { id: number })[]>([]);
  const idRef = useRef<number>(1);

  // Persist to localStorage
  useEffect(() => { save('theme', theme); }, [theme]);
  useEffect(() => { save('lang', lang); }, [lang]);
  useEffect(() => { save('user', user); }, [user]);
  useEffect(() => { save('prefs', prefs); }, [prefs]);
  useEffect(() => { save('apiKeys', apiKeys); }, [apiKeys]);
  useEffect(() => { save('devices', devices); }, [devices]);

  // Apply data-theme to <html>
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }, [theme]);

  const t = STRINGS[lang] as Strings;

  const toast = (obj: ToastData) => {
    const id = idRef.current++;
    setToasts((ts) => [...ts, { ...obj, type: obj.type ?? 'info', id }]);
  };

  const dismiss = (id: number) => {
    setToasts((ts) => ts.filter((x) => x.id !== id));
  };

  const value: AppState = {
    theme,
    lang,
    online,
    navOpen,
    user,
    prefs,
    apiKeys,
    devices,
    usage: USAGE,
    t,
    toasts,
    setLang: (l: Lang) => setLangState(l),
    toggleTheme: () => setThemeState((th) => (th === 'dark' ? 'light' : 'dark')),
    setUser: (u: AppUser) => setUserState(u),
    setPrefs: (p: Preferences) => setPrefsState(p),
    setApiKeys: (k: Record<string, ApiKeyEntry>) => setApiKeysState(k),
    setDevices: (d: AppDevice[]) => setDevicesState(d),
    setOnline: (v: boolean) => setOnlineState(v),
    setNavOpen,
    toast,
    dismiss,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
