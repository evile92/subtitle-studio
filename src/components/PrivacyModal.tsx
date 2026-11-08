'use client';

import React from 'react';
import { X, ShieldCheck, Lock, Server, Trash2 } from 'lucide-react';
import { useApp } from '@/context/AppContext';

interface PrivacyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PrivacyModal({ isOpen, onClose }: PrivacyModalProps) {
  const { uiLang } = useApp();
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              {uiLang === 'ar'
                ? 'إشعار الخصوصية وأمن البيانات'
                : 'Privacy, Security & Data Processing Notice'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4 text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          <div className="flex items-start gap-3">
            <Server className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-slate-900 dark:text-white">
                {uiLang === 'ar'
                  ? 'كيف تتم معالجة ملفات الترجمة؟'
                  : 'How Subtitle Content is Processed'}
              </p>
              <p className="mt-0.5">
                {uiLang === 'ar'
                  ? 'يتم تحليل ملف الترجمة (.SRT) محلياً على الخادم ثم يُرسل محتوى الحوار فقط عبر اتصال مشفر (HTTPS) إلى مزود الذكاء الاصطناعي الذي قمت بإعداده (مثل Google Gemini أو OpenAI أو Anthropic أو خادم محلي) لغرض التحليل السياقي والترجمة فقط. لا يتم إرسال ملفاتك إلى أي جهات خارجية غير ذات صلة.'
                  : 'Uploaded .SRT files are validated and parsed on your application server. Dialogue segments are transmitted over encrypted HTTPS solely to your configured AI model provider (Google Gemini, OpenAI, Anthropic, or your local/custom LLM) to perform contextual analysis and translation. Subtitle files are never shared with unrelated third-party services.'}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Lock className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-slate-900 dark:text-white">
                {uiLang === 'ar'
                  ? 'حماية مفاتيح API ونقاط النهاية'
                  : 'API Key Isolation & Endpoint Protection'}
              </p>
              <p className="mt-0.5">
                {uiLang === 'ar'
                  ? 'تُحفظ مفاتيح API في متغيرات البيئة على الخادم فقط ولا يتم إرسالها أو كشفها في كود الواجهة الأمامية للمتصفح. جميع طلبات الخادم محمية بآلية تحديد معدل الطلبات (Rate Limiting) وفحص صارم لمحتوى الملفات.'
                  : 'AI provider API keys reside exclusively on the server and are never exposed in frontend code or network payloads. All API endpoints enforce rate limiting, extension verification, binary rejection, and size limits.'}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Trash2 className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-slate-900 dark:text-white">
                {uiLang === 'ar'
                  ? 'سياسة الاحتفاظ المؤقت والحذف التلقائي'
                  : 'Temporary Job Storage & Automatic Retention Cleanup'}
              </p>
              <p className="mt-0.5">
                {uiLang === 'ar'
                  ? 'تُحفظ حالة المهام محلياً لتمكينك من استئناف الترجمة عند انقطاع الاتصال، ويتم حذف المهام المؤقتة تلقائياً بعد انتهاء فترة الاحتفاظ المحددة (48 ساعة افتراضياً)، كما يمكنك حذف أي مهمة فوراً بضغطة زر.'
                  : 'Translation jobs are checkpointed locally so interrupted batches can be resumed without data loss. Temporary job files are automatically purged after the retention period (48 hours by default), and you can delete any job immediately from the Recent Jobs panel.'}
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 py-3.5 border-t border-slate-200 dark:border-slate-800 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            {uiLang === 'ar' ? 'فهمت ذلك' : 'Understood'}
          </button>
        </div>
      </div>
    </div>
  );
}
