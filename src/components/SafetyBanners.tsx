import React, { useEffect, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, FileCheck2, ShieldAlert } from 'lucide-react';
import type { Banner, LanguageCode } from '../types';

interface Props {
  banners: Banner[];
  lang: LanguageCode;
}

export const SafetyBanners: React.FC<Props> = ({ banners, lang }) => {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (banners.length <= 1) return;
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % banners.length);
    }, 6000);
    return () => clearInterval(timer);
  }, [banners.length]);

  if (!banners.length) return null;
  const active = banners[index % banners.length];

  const Icon =
    active.severity === 'danger'
      ? ShieldAlert
      : active.severity === 'warning'
      ? AlertTriangle
      : FileCheck2;

  const accentBg =
    active.severity === 'danger'
      ? 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-900/60'
      : active.severity === 'warning'
      ? 'bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-900/60'
      : 'bg-white border-slate-200 dark:bg-slate-900 dark:border-slate-800';

  const iconBg =
    active.severity === 'danger'
      ? 'bg-red-600 text-white'
      : active.severity === 'warning'
      ? 'bg-[#F5A623] text-[#123B65]'
      : 'bg-[#123B65] text-white';

  return (
    <section aria-label="Safety advisories" className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-6">
      <div className={`relative rounded-2xl border p-4 sm:p-5 transition-colors ${accentBg}`}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${iconBg}`}>
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-lg font-bold text-[#123B65] dark:text-white tracking-tight">
                  {active.title_am}
                </h2>
                <span className="text-sm font-semibold text-[#172033]/80 dark:text-slate-300">
                  {active.title_en}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                {lang === 'am' ? active.subtitle_am : active.subtitle_en}
                {lang !== 'am' && (
                  <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
                    ({active.subtitle_am})
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
            <div className="flex items-center gap-1.5 mr-2">
              {banners.map((b, i) => (
                <button
                  key={b.id}
                  type="button"
                  aria-label={`Banner ${i + 1}`}
                  onClick={() => setIndex(i)}
                  className={`h-2 rounded-full transition-all ${
                    i === index ? 'w-6 bg-[#123B65] dark:bg-[#F5A623]' : 'w-2 bg-slate-300 dark:bg-slate-700'
                  }`}
                />
              ))}
            </div>
            <button
              type="button"
              aria-label="Previous safety notice"
              onClick={() => setIndex((prev) => (prev - 1 + banners.length) % banners.length)}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Next safety notice"
              onClick={() => setIndex((prev) => (prev + 1) % banners.length)}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
