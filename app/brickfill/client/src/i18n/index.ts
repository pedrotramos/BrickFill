import {
  FALLBACK_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  SUPPORTED_LANGUAGES,
  matchLanguage,
  type LanguageCode,
} from './languages';
import { resources } from './resources';
import { Translator, type Resources } from './translator';

/*
 * Language resolution: the reviewer's explicit choice (localStorage) → the browser languages → the app default
 * served by /api/config (UI_DEFAULT_LANGUAGE, applied by AppConfigProvider) → English.
 * Detection never writes localStorage; only the language switcher does, so a later change of the app default
 * still reaches users who never picked a language.
 */

/** The language the user picked in the header, if it is still shipped. */
function storedLanguage(): LanguageCode | null {
  return typeof window === 'undefined' ? null : matchLanguage(window.localStorage.getItem(LANGUAGE_STORAGE_KEY));
}

/** The first browser language BrickFill ships ("pt-PT" → "pt-BR"). */
function browserLanguage(): LanguageCode | null {
  if (typeof window === 'undefined') return null;
  for (const tag of window.navigator.languages ?? [window.navigator.language]) {
    const language = matchLanguage(tag);
    if (language) return language;
  }
  return null;
}

const i18n = new Translator({
  lng: storedLanguage() ?? browserLanguage() ?? FALLBACK_LANGUAGE,
  resources: resources as unknown as Resources,
  defaultNS: 'common',
  fallbackLng: FALLBACK_LANGUAGE,
  supportedLngs: SUPPORTED_LANGUAGES.map((language) => language.code),
});

function syncDocumentLanguage(language: string) {
  if (typeof document !== 'undefined') document.documentElement.lang = language;
}
syncDocumentLanguage(i18n.resolvedLanguage ?? FALLBACK_LANGUAGE);
i18n.on('languageChanged', () => syncDocumentLanguage(i18n.resolvedLanguage ?? FALLBACK_LANGUAGE));

/** True when the current language came from the user's choice or the browser rather than the fallback. */
export function hasDetectedLanguage(): boolean {
  return (storedLanguage() ?? browserLanguage()) !== null;
}

export function chooseLanguage(code: string) {
  const language = matchLanguage(code) ?? FALLBACK_LANGUAGE;
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  void i18n.changeLanguage(language);
}

export default i18n;
