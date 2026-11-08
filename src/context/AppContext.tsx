'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
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

const AppContext = createContext<AppContextValue | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const defaultEnvName = process.env.NEXT_PUBLIC_APP_NAME || 'Subtitle Studio';

  const [uiLang, setUiLangState] = useState<UILanguage>('en');
  const [theme, setThemeState] = useState<ThemeMode>('dark');
  const [resolvedTheme, setResolvedTheme] = useState<'dark' | 'light'>('dark');
  const [customAppName, setCustomAppNameState] = useState<string>('');

  // Load saved preferences from localStorage on mount
  useEffect(() => {
    try {
      const savedLang = localStorage.getItem('subtitle_studio_ui_lang') as UILanguage | null;
      if (savedLang === 'en' || savedLang === 'ar') {
        setUiLangState(savedLang);
      }
      const savedTheme = localStorage.getItem('subtitle_studio_theme') as ThemeMode | null;
      if (savedTheme === 'dark' || savedTheme === 'light' || savedTheme === 'system') {
        setThemeState(savedTheme);
      }
      const savedName = localStorage.getItem('subtitle_studio_app_name');
      if (savedName) {
        setCustomAppNameState(savedName);
      }
    } catch {
      // Ignore storage access errors
    }
  }, []);

  // Apply language & direction to documentElement immediately
  useEffect(() => {
    const dir = uiLang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = uiLang;
    document.documentElement.dir = dir;
  }, [uiLang]);

  // Apply theme & listen to system theme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const applyTheme = () => {
      const effective: 'dark' | 'light' =
        theme === 'system' ? (mediaQuery.matches ? 'dark' : 'light') : theme;
      setResolvedTheme(effective);
      if (effective === 'dark') {
        document.documentElement.classList.add('dark');
        document.documentElement.classList.remove('light');
      } else {
        document.documentElement.classList.add('light');
        document.documentElement.classList.remove('dark');
      }
    };

    applyTheme();
    mediaQuery.addEventListener('change', applyTheme);
    return () => mediaQuery.removeEventListener('change', applyTheme);
  }, [theme]);

  const setUiLang = (lang: UILanguage) => {
    setUiLangState(lang);
    try {
      localStorage.setItem('subtitle_studio_ui_lang', lang);
    } catch {
      // Ignore
    }
  };

  const setTheme = (newTheme: ThemeMode) => {
    setThemeState(newTheme);
    try {
      localStorage.setItem('subtitle_studio_theme', newTheme);
    } catch {
      // Ignore
    }
  };

  const setAppName = (name: string) => {
    setCustomAppNameState(name);
    try {
      if (name.trim()) {
        localStorage.setItem('subtitle_studio_app_name', name.trim());
      } else {
        localStorage.removeItem('subtitle_studio_app_name');
      }
    } catch {
      // Ignore
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
