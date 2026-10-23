import i18n from '../i18n';

function currentLanguage(): string {
  return i18n.resolvedLanguage ?? i18n.language ?? 'en';
}

/** A 0–100 score as a localized percentage ("12.5%", "12,5%", "12,5 %"). */
export function formatPercent(value: number | string | null | undefined, language = currentLanguage()): string {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 1 }).format(
    Number.isFinite(number) ? number / 100 : 0
  );
}

export function formatNumber(value: number | string | null | undefined, language = currentLanguage()): string {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat(language).format(Number.isFinite(number) ? number : 0);
}

export function formatDate(value: string | Date | null | undefined, language = currentLanguage()): string {
  if (!value) return i18n.t('common:notUpdatedYet', { lng: language });
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'short' }).format(date);
}
