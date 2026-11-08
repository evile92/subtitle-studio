'use client';

import React, { useState } from 'react';
import {
  BookOpen,
  Users,
  Sparkles,
  Plus,
  Trash2,
  CheckCircle2,
  MessageSquareQuote,
  GitBranch,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { GlobalContextProfile, GlossaryItem } from '@/types/subtitle';

interface ContextProfileViewProps {
  contextProfile?: GlobalContextProfile;
  glossary: GlossaryItem[];
  onUpdateGlossary: (updated: GlossaryItem[]) => Promise<void>;
}

export function ContextProfileView({
  contextProfile,
  glossary,
  onUpdateGlossary,
}: ContextProfileViewProps) {
  const { uiLang, t } = useApp();
  const [newSource, setNewSource] = useState('');
  const [newTarget, setNewTarget] = useState('');
  const [newCategory, setNewCategory] = useState<GlossaryItem['category']>('terminology');
  const [isSaving, setIsSaving] = useState(false);

  const handleAddTerm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSource.trim() || !newTarget.trim()) return;
    setIsSaving(true);
    try {
      const added: GlossaryItem = {
        id: `manual-${Date.now()}`,
        sourceTerm: newSource.trim(),
        targetTerm: newTarget.trim(),
        category: newCategory,
      };
      await onUpdateGlossary([...glossary, added]);
      setNewSource('');
      setNewTarget('');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveTerm = async (id: string) => {
    setIsSaving(true);
    try {
      await onUpdateGlossary(glossary.filter((g) => g.id !== id));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Global Storyline & Narrative Summary Card */}
      {contextProfile && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200/80 dark:border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-indigo-100 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {t.workspace.context.storylineTitle}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {uiLang === 'ar'
                    ? `تم تحليل ${contextProfile.analyzedEntryCount} من أصل ${contextProfile.totalEntriesInFile} مقطعاً (${contextProfile.analysisPassCount} مراحل تحليل)`
                    : `${contextProfile.analyzedEntryCount} / ${contextProfile.totalEntriesInFile} entries analyzed (${contextProfile.analysisPassCount} pass${contextProfile.analysisPassCount > 1 ? 'es' : ''})`}
                </p>
              </div>
            </div>

            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {t.workspace.context.analyzedBadge}
            </span>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800">
            <p
              dir="auto"
              className="text-sm text-slate-800 dark:text-slate-200 leading-relaxed text-start"
            >
              {contextProfile.subjectAndStoryline}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-slate-50/70 dark:bg-slate-950/40 border border-slate-200/60 dark:border-slate-800">
              <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 block mb-1">
                {t.workspace.context.genreLabel}
              </span>
              <p dir="auto" className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 text-start">
                {contextProfile.narrativeContextAndGenre}
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-50/70 dark:bg-slate-950/40 border border-slate-200/60 dark:border-slate-800">
              <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 block mb-1">
                {t.workspace.context.toneLabel}
              </span>
              <p dir="auto" className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 text-start">
                {contextProfile.overallTone}
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-50/70 dark:bg-slate-950/40 border border-slate-200/60 dark:border-slate-800">
              <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 block mb-1">
                {t.workspace.context.speechPatternsLabel}
              </span>
              <p dir="auto" className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 text-start">
                {contextProfile.speechPatternsSummary}
              </p>
            </div>
          </div>

          {/* Plot Developments */}
          {contextProfile.plotDevelopments.length > 0 && (
            <div>
              <h4 className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2 mb-2.5">
                <GitBranch className="w-4 h-4 text-indigo-500" />
                <span>{t.workspace.context.plotPointsTitle}</span>
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {contextProfile.plotDevelopments.map((pt, i) => (
                  <div
                    key={i}
                    className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200/60 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 flex items-start gap-2"
                  >
                    <span className="w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 font-bold flex items-center justify-center shrink-0">
                      {i + 1}
                    </span>
                    <span dir="auto" className="text-start flex-1">{pt}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Character Profiles & Gender Agreement Map (Arabic on Right, English on Left) */}
          {contextProfile.characters.length > 0 && (
            <div>
              <h4 className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2 mb-2.5">
                <Users className="w-4 h-4 text-indigo-500" />
                <span>{t.workspace.context.charactersTitle}</span>
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {contextProfile.characters.map((char, idx) => (
                  <div
                    key={idx}
                    className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 space-y-1.5"
                  >
                    <div
                      dir="ltr"
                      className="flex items-center justify-between gap-2 pb-1 border-b border-slate-200/60 dark:border-slate-800"
                    >
                      {/* Left: English Name & Gender Badge */}
                      <div className="flex items-center gap-1.5 min-w-0">
                        <bdi
                          dir="ltr"
                          className="font-semibold text-xs sm:text-sm text-slate-600 dark:text-slate-300 truncate"
                        >
                          {char.name}
                        </bdi>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300">
                          {char.gender}
                        </span>
                      </div>

                      {/* Right: Arabic Translated Name */}
                      <bdi
                        dir="rtl"
                        className="font-bold text-sm text-indigo-600 dark:text-indigo-400 truncate"
                      >
                        {char.translatedName}
                      </bdi>
                    </div>

                    <p dir="auto" className="text-xs font-medium text-slate-600 dark:text-slate-400 text-start">
                      {char.role} ({char.formalityLevel})
                    </p>
                    <p dir="auto" className="text-xs text-slate-500 dark:text-slate-400 text-start">
                      {char.personalityAndTone}
                    </p>
                    <p dir="auto" className="text-[11px] text-indigo-600 dark:text-indigo-400 pt-1 border-t border-slate-200/60 dark:border-slate-800 text-start">
                      {char.relationships}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Detected Idioms, Sarcasm & Nuances */}
          {contextProfile.idiomsAndNuances.length > 0 && (
            <div>
              <h4 className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2 mb-2.5">
                <MessageSquareQuote className="w-4 h-4 text-indigo-500" />
                <span>{t.workspace.context.idiomsTitle}</span>
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {contextProfile.idiomsAndNuances.map((nuance, idx) => (
                  <div
                    key={idx}
                    className="p-3.5 rounded-xl bg-amber-50/40 dark:bg-amber-950/20 border border-amber-200/70 dark:border-amber-900/50 space-y-1.5"
                  >
                    <div
                      dir="ltr"
                      className="flex items-center justify-between gap-2"
                    >
                      <bdi
                        dir="ltr"
                        className="font-semibold text-xs sm:text-sm text-slate-900 dark:text-white"
                      >
                        &ldquo;{nuance.originalExpression}&rdquo;
                      </bdi>
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300">
                        {nuance.type}
                      </span>
                    </div>
                    <p dir="auto" className="text-xs text-slate-600 dark:text-slate-300 text-start">
                      <strong>{uiLang === 'ar' ? 'المعنى المقصود:' : 'Meaning:'}</strong>{' '}
                      {nuance.intendedMeaning}
                    </p>
                    <p dir="auto" className="text-xs text-emerald-700 dark:text-emerald-400 text-start">
                      <strong>{uiLang === 'ar' ? 'الترجمة السياقية:' : 'Strategy:'}</strong>{' '}
                      {nuance.recommendedTranslationStrategy}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Persistent Translation Glossary Manager */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <span>
              {t.workspace.context.glossaryTitle} ({glossary.length})
            </span>
          </h3>
        </div>

        {/* Add Custom Glossary Entry Form */}
        <form
          onSubmit={handleAddTerm}
          className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800"
        >
          <input
            type="text"
            dir="rtl"
            value={newTarget}
            onChange={(e) => setNewTarget(e.target.value)}
            placeholder={
              uiLang === 'ar'
                ? 'الترجمة العربية المعتمدة (مثال: إيلينا فانس)'
                : 'Target Translation (e.g. إيلينا فانس)'
            }
            className="px-3 py-2 rounded-lg text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-right"
          />
          <input
            type="text"
            dir="ltr"
            value={newSource}
            onChange={(e) => setNewSource(e.target.value)}
            placeholder={
              uiLang === 'ar'
                ? 'المصطلح الإنجليزي الأصلي (e.g. Elena Vance)'
                : 'Original Term (e.g. Elena Vance)'
            }
            className="px-3 py-2 rounded-lg text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-left"
          />
          <select
            value={newCategory}
            onChange={(e) =>
              setNewCategory(e.target.value as GlossaryItem['category'])
            }
            className="px-3 py-2 rounded-lg text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
          >
            <option value="character">
              {uiLang === 'ar' ? 'اسم شخصية' : 'Character Name'}
            </option>
            <option value="location">
              {uiLang === 'ar' ? 'موقع / مكان' : 'Location'}
            </option>
            <option value="organization">
              {uiLang === 'ar' ? 'منظمة / جهة' : 'Organization'}
            </option>
            <option value="terminology">
              {uiLang === 'ar' ? 'مصطلح متكرر' : 'Terminology'}
            </option>
            <option value="idiom">
              {uiLang === 'ar' ? 'تعبير اصطلاحي' : 'Idiom / Expression'}
            </option>
            <option value="recurring_phrase">
              {uiLang === 'ar' ? 'عبارة متكررة' : 'Recurring Phrase'}
            </option>
          </select>
          <button
            type="submit"
            disabled={isSaving || !newSource.trim() || !newTarget.trim()}
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white flex items-center justify-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t.workspace.context.addGlossaryTerm}</span>
          </button>
        </form>

        {/* Glossary Cards: English on Left, Arabic on Right */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {glossary.map((item) => (
            <div
              key={item.id}
              dir="ltr"
              className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-950/40 flex items-center justify-between gap-2"
            >
              {/* Left side: Delete button + Original English Term */}
              <div className="flex items-center gap-2 min-w-0">
                <button
                  type="button"
                  onClick={() => handleRemoveTerm(item.id)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 shrink-0"
                  title="Remove glossary term"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                <div className="min-w-0 text-left">
                  <bdi
                    dir="ltr"
                    className="text-xs font-semibold text-slate-700 dark:text-slate-300 block truncate"
                  >
                    {item.sourceTerm}
                  </bdi>
                  <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-slate-200/70 dark:bg-slate-800 text-slate-500 dark:text-slate-400 inline-block mt-0.5">
                    {item.category}
                  </span>
                </div>
              </div>

              <span className="text-slate-400 shrink-0">→</span>

              {/* Right side: Arabic Translated Term */}
              <div className="min-w-0 text-right">
                <bdi
                  dir="rtl"
                  className="text-xs sm:text-sm font-bold text-indigo-600 dark:text-indigo-400 block truncate"
                >
                  {item.targetTerm}
                </bdi>
                {item.contextNotes && (
                  <span
                    dir="auto"
                    className="text-[11px] text-slate-500 block truncate max-w-[140px]"
                  >
                    {item.contextNotes}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
