import { useMemo, useSyncExternalStore } from 'react';
import i18n from './index';
import type { TFunction } from './translator';

/* The React binding of the translator (the part of react-i18next the app uses). */

function subscribe(onChange: () => void) {
  i18n.on('languageChanged', onChange);
  return () => i18n.off('languageChanged', onChange);
}

const currentLanguage = () => i18n.language;

/** Like react-i18next's hook: re-renders on a language change, and `t` changes identity with the language. */
export function useTranslation() {
  const language = useSyncExternalStore(subscribe, currentLanguage, currentLanguage);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- a new function per language invalidates memos that use t.
  const t = useMemo<TFunction>(() => (key, options) => i18n.t(key, options), [language]);
  return { t, i18n };
}
