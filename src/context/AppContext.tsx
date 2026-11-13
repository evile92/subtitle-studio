'use client';

import React, {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
} from 'react';
import { UI_TRANSLATIONS, UILanguage } from '@/lib/i18n/translations';

export type ThemeMode = 'dark' | 'light' | 'system';

interface AppContextValue {
  uiLang: UILanguage;
  setUiLang: (lang: UILanguage) => void;
  dir: 'ltr' | 'rtl';
  theme: ThemeMode;
  resolvedTheme: 'dark' | 'light';
  setTheme: (theme: ThemeMode) => void;
  appName: string;
  setAppName: (name: string) => void;
  t: (typeof UI_TRANSLATIONS)[UILanguage];
}

const APP_PREFS_CHANGE_EVENT = 'subtitle_studio_app_prefs_change';
const AppContext = createContext<AppContextValue | undefined>(undefined);

function subscribeToAppPrefs(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => onStoreChange();

  window.addEventListener('storage', handler);
  window.addEventListener(APP_PREFS_CHANGE_EVENT, handler);
  mediaQuery.addEventListener('change', handler);

  return () => {
    window.removeEventListener('storage', handler);
    window.removeEventListener(APP_PREFS_CHANGE_EVENT, handler);
    mediaQuery.removeEventListener('change', handler);
  };
}

function readStoredLang(): UILanguage {
  try {
    const saved = localStorage.getItem('subtitle_studio_ui_lang');
    return saved === 'en' || saved === 'ar' ? saved : 'en';
  } catch {
    return 'en';
  }
}

function readStoredTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem('subtitle_studio_theme');
    return saved === 'dark' || saved === 'light' || saved === 'system'
      ? saved
      : 'dark';
  } catch {
    return 'dark';
  }
}

function readStoredAppName(): string {
  try {
    return localStorage.getItem('subtitle_studio_app_name') || '';
  } catch {
    return '';
  }
}

function readSystemPrefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return true;
  }
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const defaultEnvName = process.env.NEXT_PUBLIC_APP_NAME || 'Subtitle Studio';

  const uiLang = useSyncExternalStore<UILanguage>(
    subscribeToAppPrefs,
    readStoredLang,
    () => 'en'
  );
  const theme = useSyncExternalStore<ThemeMode>(
    subscribeToAppPrefs,
    readStoredTheme,
    () => 'dark'
  );
  const customAppName = useSyncExternalStore<string>(
    subscribeToAppPrefs,
    readStoredAppName,
    () => ''
  );
  const systemPrefersDark = useSyncExternalStore<boolean>(
    subscribeToAppPrefs,
    readSystemPrefersDark,
    () => true
  );

  const resolvedTheme: 'dark' | 'light' =
    theme === 'system' ? (systemPrefersDark ? 'dark' : 'light') : theme;

  // Apply language & direction to documentElement immediately
  useEffect(() => {
    const dir = uiLang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = uiLang;
    document.documentElement.dir = dir;
  }, [uiLang]);

  // Apply theme class to documentElement
  useEffect(() => {
    if (resolvedTheme === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
    }
  }, [resolvedTheme]);

  const setUiLang = (lang: UILanguage) => {
    try {
      localStorage.setItem('subtitle_studio_ui_lang', lang);
      window.dispatchEvent(new Event(APP_PREFS_CHANGE_EVENT));
    } catch {
      // Ignore storage errors
    }
  };

  const setTheme = (newTheme: ThemeMode) => {
    try {
      localStorage.setItem('subtitle_studio_theme', newTheme);
      window.dispatchEvent(new Event(APP_PREFS_CHANGE_EVENT));
    } catch {
      // Ignore storage errors
    }
  };

  const setAppName = (name: string) => {
    try {
      if (name.trim()) {
        localStorage.setItem('subtitle_studio_app_name', name.trim());
      } else {
        localStorage.removeItem('subtitle_studio_app_name');
      }
      window.dispatchEvent(new Event(APP_PREFS_CHANGE_EVENT));
    } catch {
      // Ignore storage errors
    }
  };

  const t = UI_TRANSLATIONS[uiLang];
  const appName =
    customAppName.trim() ||
    (uiLang === 'ar' && defaultEnvName === 'Subtitle Studio'
      ? UI_TRANSLATIONS.ar.appNameDefault
      : defaultEnvName);

  return (
    <AppContext.Provider
      value={{
        uiLang,
        setUiLang,
        dir: uiLang === 'ar' ? 'rtl' : 'ltr',
        theme,
        resolvedTheme,
        setTheme,
        appName,
        setAppName,
        t,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return ctx;
}
