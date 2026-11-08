'use client';

import React, { useEffect, useState } from 'react';
import {
  X,
  Settings,
  KeyRound,
  Cpu,
  CheckCircle2,
  AlertCircle,
  Save,
  Loader2,
  Server,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { ServerAIConfigState } from '@/lib/ai/types';
import { AIProviderType } from '@/types/subtitle';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  aiConfig: ServerAIConfigState | null;
  onConfigSaved: (updated: ServerAIConfigState) => void;
}

export function SettingsModal({
  isOpen,
  onClose,
  aiConfig,
  onConfigSaved,
}: SettingsModalProps) {
  const { uiLang, appName, setAppName } = useApp();

  const [provider, setProvider] = useState<AIProviderType>('gemini');
  const [model, setModel] = useState('gemini-3.1-flash-lite');
  const [apiKey, setApiKey] = useState('');
  const [customBaseUrl, setCustomBaseUrl] = useState('https://api.openai.com/v1');
  const [temperature, setTemperature] = useState(0.2);
  const [maxRetries, setMaxRetries] = useState(3);
  const [platformNameInput, setPlatformNameInput] = useState(appName);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    if (aiConfig) {
      setProvider(aiConfig.provider);
      setModel(aiConfig.model);
      setCustomBaseUrl(aiConfig.customBaseUrl || 'https://api.openai.com/v1');
      setTemperature(aiConfig.temperature);
      setMaxRetries(aiConfig.maxRetries);
    }
    setPlatformNameInput(appName);
  }, [aiConfig, appName, isOpen]);

  if (!isOpen) return null;

  const suggestedModels = aiConfig?.availableModels?.[provider] || [];

  const handleProviderChange = (nextProvider: AIProviderType) => {
    setProvider(nextProvider);
    const defaultForNext = aiConfig?.availableModels?.[nextProvider]?.[0];
    if (defaultForNext) {
      setModel(defaultForNext);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveMessage(null);

    try {
      setAppName(platformNameInput);

      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model,
          apiKey: apiKey.trim() || undefined,
          customBaseUrl,
          temperature,
          maxRetries,
        }),
      });
      const updated = await res.json();
      if (res.ok) {
        onConfigSaved(updated);
        setApiKey('');
        setSaveMessage(
          uiLang === 'ar'
            ? 'تم حفظ إعدادات المزود والنموذج بنجاح على الخادم الآمن.'
            : 'AI provider and platform settings saved securely on the server.'
        );
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="w-full max-w-xl bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {uiLang === 'ar'
                  ? 'إعدادات الذكاء الاصطناعي والمنصة'
                  : 'AI Provider & Platform Settings'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {uiLang === 'ar'
                  ? 'تُحفظ مفاتيح API على الخادم فقط ولا يتم كشفها في المتصفح أبداً'
                  : 'API keys are stored strictly server-side and never exposed to the client'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {/* Current Status Banner */}
          <div
            className={`p-3.5 rounded-xl border flex items-start gap-3 text-xs ${
              aiConfig?.isConfigured
                ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/70 text-emerald-800 dark:text-emerald-200'
                : 'bg-amber-50/80 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200'
            }`}
          >
            {aiConfig?.isConfigured ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            )}
            <div className="flex-1">
              {aiConfig?.isConfigured ? (
                uiLang === 'ar' ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>المزود النشط ومفتاح الاتصال:</span>
                    <bdi dir="ltr" className="font-mono text-[11px]">
                      <strong>{aiConfig.provider.toUpperCase()}</strong> ({aiConfig.model}) •{' '}
                      {aiConfig.maskedKey || 'Configured'} ({aiConfig.configuredSource})
                    </bdi>
                  </div>
                ) : (
                  <span>
                    Active Provider: <strong>{aiConfig.provider.toUpperCase()}</strong> ({aiConfig.model}) • Key:{' '}
                    <code className="font-mono">{aiConfig.maskedKey || 'Configured'}</code> (Source: {aiConfig.configuredSource})
                  </span>
                )
              ) : (
                <span>{aiConfig?.missingConfigMessage}</span>
              )}
            </div>
          </div>

          {/* Configurable Platform Name */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              {uiLang === 'ar' ? 'اسم المنصة (قابل للتخصيص)' : 'Configurable Platform Name'}
            </label>
            <input
              type="text"
              value={platformNameInput}
              onChange={(e) => setPlatformNameInput(e.target.value)}
              placeholder="Subtitle Studio"
              className="w-full px-3.5 py-2 rounded-xl text-xs sm:text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white"
            />
          </div>

          {/* AI Provider Selector */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-indigo-500" />
              <span>{uiLang === 'ar' ? 'مزود الذكاء الاصطناعي' : 'AI Model Provider'}</span>
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(
                [
                  { id: 'gemini', label: 'Google Gemini' },
                  { id: 'openai', label: 'OpenAI' },
                  { id: 'anthropic', label: 'Anthropic Claude' },
                  { id: 'custom', label: 'Custom / Local' },
                ] as const
              ).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleProviderChange(p.id)}
                  className={`py-2 px-3 rounded-xl text-xs font-semibold border transition-all ${
                    provider === p.id
                      ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300'
                      : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Model Name Selector + Custom Input */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              {uiLang === 'ar' ? 'اسم النموذج (Model)' : 'AI Model Name'}
            </label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="e.g. gemini-2.5-flash or gpt-4o"
              className="w-full px-3.5 py-2 rounded-xl text-xs sm:text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white"
            />
            {suggestedModels.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {suggestedModels.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setModel(m)}
                    className={`px-2 py-0.5 rounded-md text-[11px] font-mono ${
                      model === m
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Custom Base URL for OpenAI-Compatible Endpoint */}
          {provider === 'custom' && (
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5 text-indigo-500" />
                <span>OpenAI-Compatible Base URL (OpenRouter / DeepSeek / Groq / Ollama)</span>
              </label>
              <input
                type="url"
                value={customBaseUrl}
                onChange={(e) => setCustomBaseUrl(e.target.value)}
                placeholder="https://api.deepseek.com/v1 or http://localhost:11434/v1"
                className="w-full px-3.5 py-2 rounded-xl text-xs sm:text-sm font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white"
              />
            </div>
          )}

          {/* Server-Side API Key Input */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-indigo-500" />
              <span>
                {uiLang === 'ar'
                  ? `مفتاح API لمزود ${provider.toUpperCase()} (يُخزن على الخادم فقط)`
                  : `${provider.toUpperCase()} API Key (Stored Server-Side Only)`}
              </span>
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                aiConfig?.maskedKey
                  ? `Current key: ${aiConfig.maskedKey} (leave blank to keep existing)`
                  : 'Enter API key or configure via .env.local'
              }
              className="w-full px-3.5 py-2 rounded-xl text-xs sm:text-sm font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white"
            />
          </div>

          {saveMessage && (
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-300">
              {saveMessage}
            </div>
          )}

          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
            >
              {uiLang === 'ar' ? 'إغلاق' : 'Close'}
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-1.5"
            >
              {isSaving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              <span>{uiLang === 'ar' ? 'حفظ الإعدادات' : 'Save Configuration'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
