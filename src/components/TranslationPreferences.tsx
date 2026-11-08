'use client';

import React, { useState } from 'react';
import {
  SlidersHorizontal,
  ChevronDown,
  Check,
  Sparkles,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import {
  TranslationPreferencesConfig,
  TranslationStyle,
} from '@/types/subtitle';

interface TranslationPreferencesProps {
  preferences: TranslationPreferencesConfig;
  onChangePreferences: (updated: TranslationPreferencesConfig) => void;
}

const STYLE_KEYS: TranslationStyle[] = [
  'natural',
  'professional',
  'cinematic',
  'informal',
  'formal',
];

const RULE_KEYS: Array<
  keyof Pick<
    TranslationPreferencesConfig,
    | 'preserveMeaning'
    | 'prioritizeNaturalDialogue'
    | 'preserveHumorAndSarcasm'
    | 'translateIdiomsByMeaning'
    | 'preserveProfanity'
    | 'preserveCulturalReferences'
    | 'maintainConsistentNames'
  >
> = [
  'preserveMeaning',
  'prioritizeNaturalDialogue',
  'preserveHumorAndSarcasm',
  'translateIdiomsByMeaning',
  'preserveProfanity',
  'preserveCulturalReferences',
  'maintainConsistentNames',
];

export function TranslationPreferences({
  preferences,
  onChangePreferences,
}: TranslationPreferencesProps) {
  const { uiLang, t } = useApp();
  const [isOpen, setIsOpen] = useState(false);

  const toggleRule = (key: (typeof RULE_KEYS)[number]) => {
    onChangePreferences({
      ...preferences,
      [key]: !preferences[key],
    });
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800/90 shadow-xs overflow-hidden transition-all">
      {/* Collapsible Header */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full p-5 flex items-center justify-between gap-4 text-start hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
      >
        <div className="flex items-start gap-3">
          <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold inline-flex items-center justify-center shrink-0 mt-0.5">
            4
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                {t.steps.step4Title}
              </h2>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/60">
                <Sparkles className="w-3 h-3" />
                {t.preferences.styles[preferences.style].title}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {t.preferences.defaultNote}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400 shrink-0">
          <SlidersHorizontal className="w-4 h-4" />
          <span className="hidden sm:inline">{t.preferences.toggleButton}</span>
          <ChevronDown
            className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      {isOpen && (
        <div className="px-5 pb-6 pt-2 border-t border-slate-200/80 dark:border-slate-800/80 space-y-6">
          {/* Translation Style Selector */}
          <div>
            <label className="block text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-200 mb-2.5">
              {t.preferences.styleLabel}
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
              {STYLE_KEYS.map((styleKey) => {
                const active = preferences.style === styleKey;
                const info = t.preferences.styles[styleKey];
                return (
                  <button
                    key={styleKey}
                    type="button"
                    onClick={() =>
                      onChangePreferences({
                        ...preferences,
                        style: styleKey,
                      })
                    }
                    className={`p-3 rounded-xl border text-start transition-all ${
                      active
                        ? 'border-indigo-600 dark:border-indigo-400 bg-indigo-50/50 dark:bg-indigo-950/40 ring-2 ring-indigo-500/20'
                        : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 hover:border-indigo-300'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-900 dark:text-white">
                        {info.title}
                      </span>
                      {active && (
                        <span className="w-4 h-4 rounded-full bg-indigo-600 text-white flex items-center justify-center shrink-0">
                          <Check className="w-2.5 h-2.5" />
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                      {info.desc}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 7 Contextual Localization Rule Checkboxes */}
          <div>
            <label className="block text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-200 mb-2.5">
              {t.preferences.rulesTitle}
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {RULE_KEYS.map((ruleKey) => {
                const checked = preferences[ruleKey];
                return (
                  <button
                    key={ruleKey}
                    type="button"
                    onClick={() => toggleRule(ruleKey)}
                    className={`flex items-center gap-3 p-3 rounded-xl border text-start transition-colors ${
                      checked
                        ? 'border-indigo-200 dark:border-indigo-900/80 bg-indigo-50/30 dark:bg-indigo-950/25 text-slate-900 dark:text-slate-100'
                        : 'border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-950/40 text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 border transition-colors ${
                        checked
                          ? 'bg-indigo-600 border-indigo-600 text-white'
                          : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900'
                      }`}
                    >
                      {checked && <Check className="w-3.5 h-3.5" />}
                    </div>
                    <span className="text-xs sm:text-sm font-medium">
                      {t.preferences.rules[ruleKey]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Chunking & Custom Translator Notes */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-slate-200/60 dark:border-slate-800/60">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                {t.preferences.batchSizeLabel}:{' '}
                <span className="text-indigo-600 dark:text-indigo-400 font-bold">
                  {preferences.batchSize}
                </span>
              </label>
              <input
                type="range"
                min={10}
                max={60}
                step={5}
                value={preferences.batchSize}
                onChange={(e) =>
                  onChangePreferences({
                    ...preferences,
                    batchSize: Number(e.target.value),
                  })
                }
                className="w-full accent-indigo-600"
              />
              <div className="flex justify-between text-[11px] text-slate-400 mt-0.5">
                <span>{uiLang === 'ar' ? '10 (دقة قصوى)' : '10 (High Detail)'}</span>
                <span>{uiLang === 'ar' ? '35 (متوازن)' : '35 (Balanced)'}</span>
                <span>{uiLang === 'ar' ? '60 (سريع)' : '60 (Fast)'}</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                {t.preferences.overlapSizeLabel}:{' '}
                <bdi dir="ltr" className="text-indigo-600 dark:text-indigo-400 font-bold">
                  ±{preferences.contextOverlapSize}
                </bdi>
              </label>
              <input
                type="range"
                min={3}
                max={12}
                step={1}
                value={preferences.contextOverlapSize}
                onChange={(e) =>
                  onChangePreferences({
                    ...preferences,
                    contextOverlapSize: Number(e.target.value),
                  })
                }
                className="w-full accent-indigo-600"
              />
              <div className="flex justify-between text-[11px] text-slate-400 mt-0.5">
                <span>{uiLang === 'ar' ? '±3 أسطر' : '±3 lines'}</span>
                <span>{uiLang === 'ar' ? '±6 أسطر' : '±6 lines'}</span>
                <span>{uiLang === 'ar' ? '±12 سطراً' : '±12 lines'}</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                {t.preferences.customInstructionsLabel}
              </label>
              <input
                type="text"
                value={preferences.customInstructions || ''}
                onChange={(e) =>
                  onChangePreferences({
                    ...preferences,
                    customInstructions: e.target.value,
                  })
                }
                placeholder={t.preferences.customInstructionsPlaceholder}
                className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
