/** UI languages shipped with BrickFill. To add one: create locales/<code>/*.json, register it in resources.ts and here. */
export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'pt-BR', label: 'Português (Brasil)' },
  { code: 'es', label: 'Español' },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code'];

export const FALLBACK_LANGUAGE: LanguageCode = 'en';
export const LANGUAGE_STORAGE_KEY = 'brickfill.language';

const CODES: readonly string[] = SUPPORTED_LANGUAGES.map((language) => language.code);

/** Maps a BCP 47 tag to a shipped language: exact match first, then the base language ("pt-PT" → "pt-BR"). */
export function matchLanguage(tag: string | null | undefined): LanguageCode | null {
  if (!tag) return null;
  const exact = CODES.find((code) => code.toLowerCase() === tag.toLowerCase());
  if (exact) return exact as LanguageCode;
  const base = tag.split(/[-_]/)[0]?.toLowerCase();
  const byBase = CODES.find((code) => code.split('-')[0].toLowerCase() === base);
  return (byBase as LanguageCode | undefined) ?? null;
}

/** Name of a language in its own language (for content-language badges and selectors). */
export function languageLabel(code: string | null | undefined): string {
  if (!code) return '';
  return SUPPORTED_LANGUAGES.find((language) => language.code === code)?.label ?? code;
}
