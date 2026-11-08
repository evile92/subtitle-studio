'use client';

import React, { useMemo, useState } from 'react';
import {
  Search,
  Sparkles,
  Check,
  ChevronDown,
  ArrowRightLeft,
  Languages,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import {
  ARABIC_DIALECTS,
  getLanguageName,
  SUPPORTED_LANGUAGES,
} from '@/lib/languages';
import { ArabicDialect } from '@/types/subtitle';

interface LanguageSelectorsProps {
  sourceLanguage: string;
  onChangeSourceLanguage: (code: string) => void;
  detectedLanguage?: string;
  targetLanguage: string;
  onChangeTargetLanguage: (code: string) => void;
  arabicDialect: ArabicDialect;
  onChangeArabicDialect: (dialect: ArabicDialect) => void;
}

export function LanguageSelectors({
  sourceLanguage,
  onChangeSourceLanguage,
  detectedLanguage,
  targetLanguage,
  onChangeTargetLanguage,
  arabicDialect,
  onChangeArabicDialect,
}: LanguageSelectorsProps) {
  const { uiLang, t } = useApp();
  const [sourceOpen, setSourceOpen] = useState(false);
  const [targetOpen, setTargetOpen] = useState(false);
  const [sourceQuery, setSourceQuery] = useState('');
  const [targetQuery, setTargetQuery] = useState('');

  const filteredSourceLangs = useMemo(() => {
    const q = sourceQuery.trim().toLowerCase();
    if (!q) return SUPPORTED_LANGUAGES;
    return SUPPORTED_LANGUAGES.filter(
      (l) =>
        l.nameEn.toLowerCase().includes(q) ||
        l.nameAr.includes(q) ||
        l.nativeName.toLowerCase().includes(q) ||
        l.code.toLowerCase().includes(q)
    );
  }, [sourceQuery]);

  const filteredTargetLangs = useMemo(() => {
    const q = targetQuery.trim().toLowerCase();
    if (!q) return SUPPORTED_LANGUAGES;
    return SUPPORTED_LANGUAGES.filter(
      (l) =>
        l.nameEn.toLowerCase().includes(q) ||
        l.nameAr.includes(q) ||
        l.nativeName.toLowerCase().includes(q) ||
        l.code.toLowerCase().includes(q)
    );
  }, [targetQuery]);

  const swapLanguages = () => {
    const resolvedSource = sourceLanguage === 'auto' ? detectedLanguage || 'en' : sourceLanguage;
    onChangeSourceLanguage(targetLanguage);
    onChangeTargetLanguage(resolvedSource);
    if (resolvedSource === 'ar') {
      onChangeArabicDialect('msa');
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-11 gap-4 items-stretch">
        {/* STEP 2: SOURCE LANGUAGE SELECTOR */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800/90 p-5 shadow-xs relative">
          <div className="mb-3">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold inline-flex items-center justify-center">
                2
              </span>
              <span>{t.steps.step2Title}</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {t.steps.step2Desc}
            </p>
          </div>

          {/* Selected Source Trigger */}
          <button
            type="button"
            onClick={() => {
              setSourceOpen(!sourceOpen);
              setTargetOpen(false);
            }}
            className="w-full flex items-center justify-between gap-2 px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/60 hover:border-indigo-400 dark:hover:border-indigo-500 text-start transition-colors"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <Languages className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
              <div className="truncate">
                <span className="font-semibold text-sm text-slate-900 dark:text-white">
                  {getLanguageName(sourceLanguage, uiLang)}
                </span>
                {sourceLanguage === 'auto' && detectedLanguage && (
                  <span className="ms-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300">
                    <Sparkles className="w-3 h-3" />
                    {t.languages.detectedAs} {getLanguageName(detectedLanguage, uiLang)}
                  </span>
                )}
              </div>
            </div>
            <ChevronDown
              className={`w-4 h-4 text-slate-400 transition-transform ${
                sourceOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {/* Quick Popular Source Language Pills */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => onChangeSourceLanguage('auto')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1 ${
                sourceLanguage === 'auto'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
              }`}
            >
              <Sparkles className="w-3 h-3" />
              <span>{t.languages.autoDetect}</span>
            </button>
            {['en', 'ar', 'fr', 'es', 'de', 'tr', 'ja', 'ko'].map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => onChangeSourceLanguage(code)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                  sourceLanguage === code
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {getLanguageName(code, uiLang)}
              </button>
            ))}
          </div>

          {/* Searchable Dropdown Menu */}
          {sourceOpen && (
            <div className="mt-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-3 z-30">
              <div className="relative mb-2">
                <Search className="w-4 h-4 text-slate-400 absolute top-2.5 start-3" />
                <input
                  type="text"
                  value={sourceQuery}
                  onChange={(e) => setSourceQuery(e.target.value)}
                  placeholder={t.languages.searchPlaceholder}
                  className="w-full ps-9 pe-3 py-2 rounded-lg text-xs sm:text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
                  autoFocus
                />
              </div>

              <div className="max-h-60 overflow-y-auto space-y-1 pr-1">
                <button
                  type="button"
                  onClick={() => {
                    onChangeSourceLanguage('auto');
                    setSourceOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs sm:text-sm font-medium ${
                    sourceLanguage === 'auto'
                      ? 'bg-indigo-50 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-400'
                      : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                    {t.languages.autoDetect}
                  </span>
                  {sourceLanguage === 'auto' && <Check className="w-4 h-4" />}
                </button>

                {filteredSourceLangs.map((lang) => (
                  <button
                    key={lang.code}
                    type="button"
                    onClick={() => {
                      onChangeSourceLanguage(lang.code);
                      setSourceOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs sm:text-sm ${
                      sourceLanguage === lang.code
                        ? 'bg-indigo-50 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-400 font-semibold'
                        : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span>{uiLang === 'ar' ? lang.nameAr : lang.nameEn}</span>
                      <bdi dir="ltr" className="text-slate-400 text-xs">
                        ({lang.nativeName})
                      </bdi>
                    </span>
                    {sourceLanguage === lang.code && <Check className="w-4 h-4" />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* SWAP LANGUAGES BUTTON */}
        <div className="lg:col-span-1 flex items-center justify-center">
          <button
            type="button"
            onClick={swapLanguages}
            className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 hover:border-indigo-400 shadow-xs transition-all"
            title="Swap Source and Target Languages"
            aria-label="Swap Source and Target Languages"
          >
            <ArrowRightLeft className="w-4 h-4" />
          </button>
        </div>

        {/* STEP 3: TARGET LANGUAGE SELECTOR */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800/90 p-5 shadow-xs relative">
          <div className="mb-3">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold inline-flex items-center justify-center">
                3
              </span>
              <span>{t.steps.step3Title}</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {t.steps.step3Desc}
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setTargetOpen(!targetOpen);
              setSourceOpen(false);
            }}
            className="w-full flex items-center justify-between gap-2 px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/60 hover:border-indigo-400 dark:hover:border-indigo-500 text-start transition-colors"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <Languages className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span className="font-semibold text-sm text-slate-900 dark:text-white truncate">
                {getLanguageName(targetLanguage, uiLang)}
              </span>
              {targetLanguage === 'ar' && (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                  {uiLang === 'ar' ? 'محرك التعريب المتقدم' : 'Arabic Engine'}
                </span>
              )}
            </div>
            <ChevronDown
              className={`w-4 h-4 text-slate-400 transition-transform ${
                targetOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {/* Quick Popular Target Language Pills */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {['ar', 'en', 'fr', 'es', 'de', 'it', 'pt', 'ru', 'tr', 'ja'].map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => {
                  onChangeTargetLanguage(code);
                  if (code === 'ar' && !arabicDialect) {
                    onChangeArabicDialect('msa');
                  }
                }}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                  targetLanguage === code
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {getLanguageName(code, uiLang)}
              </button>
            ))}
          </div>

          {targetOpen && (
            <div className="mt-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-3 z-30">
              <div className="relative mb-2">
                <Search className="w-4 h-4 text-slate-400 absolute top-2.5 start-3" />
                <input
                  type="text"
                  value={targetQuery}
                  onChange={(e) => setTargetQuery(e.target.value)}
                  placeholder={t.languages.searchPlaceholder}
                  className="w-full ps-9 pe-3 py-2 rounded-lg text-xs sm:text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
                  autoFocus
                />
              </div>

              <div className="max-h-60 overflow-y-auto space-y-1 pr-1">
                {filteredTargetLangs.map((lang) => (
                  <button
                    key={lang.code}
                    type="button"
                    onClick={() => {
                      onChangeTargetLanguage(lang.code);
                      if (lang.code === 'ar') {
                        onChangeArabicDialect('msa');
                      }
                      setTargetOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs sm:text-sm ${
                      targetLanguage === lang.code
                        ? 'bg-indigo-50 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-400 font-semibold'
                        : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span>{uiLang === 'ar' ? lang.nameAr : lang.nameEn}</span>
                      <bdi dir="ltr" className="text-slate-400 text-xs">
                        ({lang.nativeName})
                      </bdi>
                    </span>
                    {targetLanguage === lang.code && <Check className="w-4 h-4" />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* SPECIAL ARABIC VARIETY & DIALECT CONFIGURATION PANEL */}
      {targetLanguage === 'ar' && (
        <div className="bg-gradient-to-r from-indigo-50/80 via-white to-emerald-50/60 dark:from-indigo-950/30 dark:via-slate-900 dark:to-emerald-950/20 rounded-2xl border border-indigo-200/80 dark:border-indigo-800/60 p-5 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
            <div>
              <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span>{t.languages.arabicDialectTitle}</span>
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                {t.languages.arabicDialectDesc}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {ARABIC_DIALECTS.map((dialect) => {
              const isSelected = arabicDialect === dialect.id;
              return (
                <button
                  key={dialect.id}
                  type="button"
                  onClick={() => onChangeArabicDialect(dialect.id)}
                  className={`text-start p-3 rounded-xl border transition-all ${
                    isSelected
                      ? 'border-indigo-600 dark:border-indigo-400 bg-white dark:bg-slate-900 ring-2 ring-indigo-500/20 shadow-xs'
                      : 'border-slate-200/90 dark:border-slate-800 bg-white/70 dark:bg-slate-950/50 hover:border-indigo-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                      {uiLang === 'ar' ? dialect.nameAr : dialect.nameEn}
                    </span>
                    {isSelected && (
                      <span className="w-4 h-4 rounded-full bg-indigo-600 text-white flex items-center justify-center shrink-0">
                        <Check className="w-2.5 h-2.5" />
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-indigo-600 dark:text-indigo-400 font-medium mt-0.5">
                    {dialect.nativeLabel}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                    {uiLang === 'ar' ? dialect.descriptionAr : dialect.descriptionEn}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
