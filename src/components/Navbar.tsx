'use client';

import React, { useState } from 'react';
import {
  Subtitles,
  Globe,
  Sun,
  Moon,
  Monitor,
  Settings,
  ShieldCheck,
  History,
  FileEdit,
  Sparkles,
  Menu,
  X,
  AlertCircle,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import { useApp, ThemeMode } from '@/context/AppContext';
import { ServerAIConfigState } from '@/lib/ai/types';

type NavView = 'dashboard' | 'progress' | 'workspace' | 'history' | 'sync';

interface NavbarProps {
  activeView: NavView;
  onNavigate: (view: NavView) => void;
  hasActiveJob: boolean;
  aiConfig: ServerAIConfigState | null;
  onOpenSettings: () => void;
  onOpenPrivacy: () => void;
}

export function Navbar({
  activeView,
  onNavigate,
  hasActiveJob,
  aiConfig,
  onOpenSettings,
  onOpenPrivacy,
}: NavbarProps) {
  const { uiLang, setUiLang, theme, setTheme, appName, t } = useApp();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const cycleTheme = () => {
    const order: ThemeMode[] = ['dark', 'light', 'system'];
    const next = order[(order.indexOf(theme) + 1) % order.length];
    setTheme(next);
  };

  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;

  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-200/80 dark:border-slate-800/80 bg-white/90 dark:bg-slate-950/90 backdrop-blur-md transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3">
        {/* Brand Logo & Configurable Name */}
        <div className="flex items-center gap-3 shrink-0 min-w-0">
          <button
            type="button"
            onClick={() => onNavigate('dashboard')}
            className="flex items-center gap-2.5 text-start group focus:outline-none min-w-0"
          >
            <div className="w-10 h-10 rounded-xl bg-indigo-600 dark:bg-indigo-500 flex items-center justify-center text-white shadow-sm group-hover:bg-indigo-700 transition-colors shrink-0">
              <Subtitles className="w-5 h-5" />
            </div>
            <div className="min-w-0 max-w-[170px] sm:max-w-xs md:max-w-[200px] lg:max-w-xs">
              <div className="font-bold text-base sm:text-lg tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
                <span className="truncate">{appName}</span>
                <bdi
                  dir="ltr"
                  className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-indigo-50 text-indigo-700 dark:bg-indigo-950/80 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/60 shrink-0"
                >
                  AI SRT
                </bdi>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 hidden lg:block truncate">
                {t.tagline}
              </p>
            </div>
          </button>
        </div>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-1 bg-slate-100/80 dark:bg-slate-900/80 p-1 rounded-xl border border-slate-200/60 dark:border-slate-800/60 shrink-0">
          <button
            type="button"
            onClick={() => onNavigate('dashboard')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap shrink-0 transition-all ${
              activeView === 'dashboard'
                ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Sparkles className="w-4 h-4 shrink-0" />
            <span className="whitespace-nowrap">{t.nav.dashboard}</span>
          </button>

          {hasActiveJob && (
            <button
              type="button"
              onClick={() => onNavigate('workspace')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap shrink-0 transition-all ${
                activeView === 'workspace' || activeView === 'progress'
                  ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <FileEdit className="w-4 h-4 shrink-0" />
              <span className="whitespace-nowrap">{t.nav.workspace}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => onNavigate('history')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap shrink-0 transition-all ${
              activeView === 'history'
                ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <History className="w-4 h-4 shrink-0" />
            <span className="whitespace-nowrap">{t.nav.history}</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('sync')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap shrink-0 transition-all ${
              activeView === 'sync'
                ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Clock className="w-4 h-4 shrink-0" />
            <span className="whitespace-nowrap">{t.nav.sync}</span>
          </button>
        </nav>

        {/* Right Controls: AI Status, Language Switcher, Theme Switcher, Settings */}
        <div className="hidden md:flex items-center gap-2 shrink-0">
          {/* AI Engine Status Badge */}
          <button
            type="button"
            onClick={onOpenSettings}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              aiConfig?.isConfigured
                ? 'bg-emerald-50/80 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/70 hover:bg-emerald-100/80'
                : 'bg-amber-50/90 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-800 hover:bg-amber-100'
            }`}
            title={aiConfig?.isConfigured ? `${aiConfig.provider.toUpperCase()} (${aiConfig.model})` : t.nav.aiMissing}
          >
            {aiConfig?.isConfigured ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>{aiConfig.provider.toUpperCase()}</span>
              </>
            ) : (
              <>
                <AlertCircle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                <span>{t.nav.aiMissing}</span>
              </>
            )}
          </button>

          {/* Bilingual Interface Switcher (English LTR / Arabic RTL) */}
          <button
            type="button"
            onClick={() => setUiLang(uiLang === 'en' ? 'ar' : 'en')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-800 transition-colors"
            title="Switch Interface Language (English / العربية)"
          >
            <Globe className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
            <span>{uiLang === 'en' ? 'العربية' : 'English'}</span>
          </button>

          {/* Theme Switcher (Dark / Light / System) */}
          <button
            type="button"
            onClick={cycleTheme}
            className="p-2 rounded-lg bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-800 transition-colors"
            title={`Theme: ${theme.toUpperCase()}`}
            aria-label="Toggle theme"
          >
            <ThemeIcon className="w-4 h-4" />
          </button>

          {/* Privacy Notice */}
          <button
            type="button"
            onClick={onOpenPrivacy}
            className="p-2 rounded-lg bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-800 transition-colors"
            title={t.nav.privacy}
            aria-label={t.nav.privacy}
          >
            <ShieldCheck className="w-4 h-4" />
          </button>

          {/* Settings Button */}
          <button
            type="button"
            onClick={onOpenSettings}
            className="p-2 rounded-lg bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-800 transition-colors"
            title={t.nav.settings}
            aria-label={t.nav.settings}
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>

        {/* Mobile Quick Controls & Menu Trigger */}
        <div className="flex md:hidden items-center gap-1.5">
          <button
            type="button"
            onClick={() => setUiLang(uiLang === 'en' ? 'ar' : 'en')}
            className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800"
          >
            {uiLang === 'en' ? 'عربي' : 'EN'}
          </button>
          <button
            type="button"
            onClick={cycleTheme}
            className="p-2 rounded-lg bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800"
            aria-label="Toggle theme"
          >
            <ThemeIcon className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 rounded-lg bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800"
            aria-label="Open menu"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Responsive Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-4 py-3 space-y-2">
          <button
            type="button"
            onClick={() => {
              onNavigate('dashboard');
              setMobileMenuOpen(false);
            }}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium ${
              activeView === 'dashboard'
                ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400'
                : 'text-slate-700 dark:text-slate-300'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <span>{t.nav.dashboard}</span>
          </button>

          {hasActiveJob && (
            <button
              type="button"
              onClick={() => {
                onNavigate('workspace');
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium ${
                activeView === 'workspace' || activeView === 'progress'
                  ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400'
                  : 'text-slate-700 dark:text-slate-300'
              }`}
            >
              <FileEdit className="w-4 h-4" />
              <span>{t.nav.workspace}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              onNavigate('history');
              setMobileMenuOpen(false);
            }}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium ${
              activeView === 'history'
                ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400'
                : 'text-slate-700 dark:text-slate-300'
            }`}
          >
            <History className="w-4 h-4" />
            <span>{t.nav.history}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              onNavigate('sync');
              setMobileMenuOpen(false);
            }}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium ${
              activeView === 'sync'
                ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400'
                : 'text-slate-700 dark:text-slate-300'
            }`}
          >
            <Clock className="w-4 h-4" />
            <span>{t.nav.sync}</span>
          </button>

          <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => {
                onOpenSettings();
                setMobileMenuOpen(false);
              }}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-200"
            >
              <span className="flex items-center gap-2">
                <Settings className="w-4 h-4" />
                {t.nav.settings}
              </span>
              <span
                className={`text-xs px-2 py-0.5 rounded-full ${
                  aiConfig?.isConfigured
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                    : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                }`}
              >
                {aiConfig?.isConfigured ? aiConfig.provider.toUpperCase() : t.nav.aiMissing}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                onOpenPrivacy();
                setMobileMenuOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-400"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>{t.nav.privacy}</span>
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
