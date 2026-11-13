'use client';

import React, { useState } from 'react';
import {
  X,
  Settings,
  KeyRound,
  Cpu,
  CheckCircle2,
  AlertCircle,
  Save,
  Server,
  ShieldCheck,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { DEFAULT_MODELS, DEFAULT_MODEL_BY_PROVIDER } from '@/lib/ai/models';
import { ServerAIConfigState } from '@/lib/ai/types';
import { AIProviderType } from '@/types/subtitle';
import { validateCustomBaseUrl } from '@/lib/security/url-safety';
import {
  applyUserConfigToAIState,
  loadStoredUserConfig,
  saveStoredUserConfig,
  StoredUserAIConfig,
} from '@/lib/storage/client-config';

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
  if (!isOpen) return null;

  return (
    <SettingsModalContent
      onClose={onClose}
      aiConfig={aiConfig}
      onConfigSaved={onConfigSaved}
    />
  );
}

function SettingsModalContent({
  onClose,
  aiConfig,
  onConfigSaved,
}: Omit<SettingsModalProps, 'isOpen'>) {
  const { uiLang, appName, setAppName } = useApp();

  const [initialSnapshot] = useState(() => {
    const stored = loadStoredUserConfig();
    const initialProvider = stored?.provider || aiConfig?.provider || 'deepseek';
    const initialModel =
      stored?.model ||
      aiConfig?.model ||
      DEFAULT_MODEL_BY_PROVIDER[initialProvider];
    const keys = stored?.apiKeys || {};

    return {
      provider: initialProvider,
      model: initialModel,
      customBaseUrl:
        stored?.customBaseUrl || aiConfig?.customBaseUrl || 'https://api.openai.com/v1',
      temperature: stored?.temperature ?? aiConfig?.temperature ?? 0.2,
      maxRetries: stored?.maxRetries ?? aiConfig?.maxRetries ?? 3,
      apiKeysMap: keys,
      apiKey: keys[initialProvider] || '',
      platformNameInput: appName,
    };
  });

  const [provider, setProvider] = useState<AIProviderType>(initialSnapshot.provider);
  const [model, setModel] = useState(initialSnapshot.model);
  const [apiKey, setApiKey] = useState(initialSnapshot.apiKey);
  const [apiKeysMap, setApiKeysMap] = useState<Partial<Record<AIProviderType, string>>>(
    initialSnapshot.apiKeysMap
  );
  const [customBaseUrl, setCustomBaseUrl] = useState(initialSnapshot.customBaseUrl);
  const [temperature] = useState(initialSnapshot.temperature);
  const [maxRetries] = useState(initialSnapshot.maxRetries);
  const [platformNameInput, setPlatformNameInput] = useState(
    initialSnapshot.platformNameInput
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const suggestedModels =
    aiConfig?.availableModels?.[provider] || DEFAULT_MODELS[provider] || [];

  const handleProviderChange = (nextProvider: AIProviderType) => {
    setErrorMessage(null);
    setSaveMessage(null);
    const updatedMap: Partial<Record<AIProviderType, string>> = {
      ...apiKeysMap,
      [provider]: apiKey.trim(),
    };
    setApiKeysMap(updatedMap);

    setProvider(nextProvider);

    const defaultForNext =
      aiConfig?.availableModels?.[nextProvider]?.[0] ||
      DEFAULT_MODELS[nextProvider]?.[0];
    if (defaultForNext) {
      setModel(defaultForNext);
    }

    setApiKey(updatedMap[nextProvider] || '');
  };

  const handleApiKeyChange = (val: string) => {
    setErrorMessage(null);
    setSaveMessage(null);
    setApiKey(val);
    setApiKeysMap((prev) => ({
      ...prev,
      [provider]: val,
    }));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSaveMessage(null);

    let normalizedCustomUrl: string | undefined;
    if (provider === 'custom') {
      try {
        normalizedCustomUrl = validateCustomBaseUrl(customBaseUrl, {
          allowLocalLoopback: true,
        });
        setCustomBaseUrl(normalizedCustomUrl);
      } catch (err) {
        setErrorMessage(
          err instanceof Error
            ? err.message
            : uiLang === 'ar'
              ? 'رابط الخادم المخصص غير صالح أو غير مسموح به.'
              : 'Custom base URL is invalid or blocked.'
        );
        return;
      }
    }

    const cleanedKeys: Partial<Record<AIProviderType, string>> = {};
    for (const [k, v] of Object.entries({ ...apiKeysMap, [provider]: apiKey })) {
      if (typeof v === 'string' && v.trim()) {
        cleanedKeys[k as AIProviderType] = v.trim();
      }
    }

    const newStoredConfig: StoredUserAIConfig = {
      provider,
      model: model.trim() || DEFAULT_MODEL_BY_PROVIDER[provider],
      customBaseUrl: normalizedCustomUrl,
      temperature,
      maxRetries,
      apiKeys: cleanedKeys,
    };

    setAppName(platformNameInput);
    saveStoredUserConfig(newStoredConfig);

    const updatedState = applyUserConfigToAIState(aiConfig, newStoredConfig);
    onConfigSaved(updatedState);

    setSaveMessage(
      uiLang === 'ar'
        ? 'تم حفظ مفتاحك وإعدادات النموذج في متصفحك فقط بنجاح. لم يتم إرسال أي مفتاح إلى الخادم، والمنصة جاهزة للترجمة!'
        : 'Settings and API key saved securely in your browser only. No keys were sent to the server, and you are ready to translate!'
    );
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
                  ? 'مفتاحك يُحفظ بأمان في متصفحك الخاص فقط (BYOK) ولا يتم تخزينه أو كشفه لأي شخص آخر'
                  : 'Your API key is stored safely in your own browser (BYOK) and never saved on the server'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
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
                      {aiConfig.maskedKey || 'Configured'} (
                      {aiConfig.configuredSource === 'client-browser'
                        ? 'متصفحك الخاص'
                        : aiConfig.configuredSource}
                      )
                    </bdi>
                  </div>
                ) : (
                  <span>
                    Active Provider: <strong>{aiConfig.provider.toUpperCase()}</strong> (
                    {aiConfig.model}) • Key:{' '}
                    <code className="font-mono">{aiConfig.maskedKey || 'Configured'}</code> (Source:{' '}
                    {aiConfig.configuredSource})
                  </span>
                )
              ) : (
                <span>
                  {uiLang === 'ar'
                    ? 'لم يتم ضبط أي مفتاح حتى الآن. الرجاء إدخال مفتاح API الخاص بك بالأسفل لبدء الترجمة.'
                    : (aiConfig?.missingConfigMessage || 'No AI key configured. Please enter your API key below.')}
                </span>
              )}
            </div>
          </div>

          {/* BYOK Security Notice */}
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800 flex items-center gap-2.5 text-xs text-slate-600 dark:text-slate-300">
            <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>
              {uiLang === 'ar'
                ? 'نظام Bring Your Own Key (BYOK): تكلفة الترجمة تُحسب على حسابك الشخصي في المزود فقط، ولا يتحمل صاحب الموقع أي تكاليف ولا يطّلع أحد على مفتاحك.'
                : 'Bring Your Own Key (BYOK): Costs are billed strictly to your personal provider account, ensuring privacy and zero shared costs.'}
            </span>
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
              className="w-full px-3.5 py-2 rounded-xl text-xs sm:text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white outline-hidden focus:border-indigo-500"
            />
          </div>

          {/* AI Provider Selector */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-indigo-500" />
              <span>{uiLang === 'ar' ? 'مزود الذكاء الاصطناعي' : 'AI Model Provider'}</span>
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              {(
                [
                  { id: 'deepseek', label: 'DeepSeek' },
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
                      ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 shadow-xs'
                      : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  {p.id === 'deepseek' && uiLang === 'ar' ? 'DeepSeek (ديب سيك)' : p.label}
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
              placeholder="e.g. deepseek-flash, deepseek-chat, or gemini-3.1-flash-lite"
              className="w-full px-3.5 py-2 rounded-xl text-xs sm:text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white font-mono outline-hidden focus:border-indigo-500"
            />
            {suggestedModels.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {suggestedModels.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setModel(m)}
                    className={`px-2 py-0.5 rounded-md text-[11px] font-mono transition-colors ${
                      model === m
                        ? 'bg-indigo-600 text-white font-semibold'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
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
                <span>OpenAI-Compatible Base URL (OpenRouter / DeepSeek / Ollama)</span>
              </label>
              <input
                type="url"
                value={customBaseUrl}
                onChange={(e) => setCustomBaseUrl(e.target.value)}
                placeholder="https://api.deepseek.com/v1 or http://localhost:11434/v1"
                className="w-full px-3.5 py-2 rounded-xl text-xs sm:text-sm font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white outline-hidden focus:border-indigo-500"
              />
            </div>
          )}

          {/* API Key Input */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5 text-indigo-500" />
                <span>
                  {uiLang === 'ar'
                    ? `مفتاح API لمزود ${provider.toUpperCase()} (خاص بك ويُحفظ في متصفحك)`
                    : `${provider.toUpperCase()} API Key (Private & Stored in Browser)`}
                </span>
              </span>
              {apiKeysMap[provider] && (
                <span className="text-[11px] font-normal text-emerald-600 dark:text-emerald-400">
                  {uiLang === 'ar' ? 'محفوظ في متصفحك' : 'Saved in browser'}
                </span>
              )}
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => handleApiKeyChange(e.target.value)}
              placeholder={
                apiKeysMap[provider]
                  ? '••••••••••••••••••••••••••••••••'
                  : provider === 'deepseek'
                  ? 'sk-...'
                  : 'Enter your API key'
              }
              className="w-full px-3.5 py-2 rounded-xl text-xs sm:text-sm font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white outline-hidden focus:border-indigo-500"
            />
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              {uiLang === 'ar'
                ? 'يتم استخدام هذا المفتاح لترجماتك فقط ولا يتم تخزينه على الخادم، مما يضمن أمان حسابك وحفظ استهلاكك الشخصي.'
                : 'This key is sent transiently in memory for your translations and is never stored on the server.'}
            </p>
          </div>

          {errorMessage && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
              <bdi dir="ltr">{errorMessage}</bdi>
            </div>
          )}

          {saveMessage && (
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>{saveMessage}</span>
            </div>
          )}

          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            >
              {uiLang === 'ar' ? 'إغلاق' : 'Close'}
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-1.5 transition-colors shadow-xs"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{uiLang === 'ar' ? 'حفظ الإعدادات' : 'Save Configuration'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
