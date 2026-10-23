import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@databricks/appkit-ui/react';
import { Languages } from 'lucide-react';
import { useTranslation } from '../i18n/react';
import { chooseLanguage } from '../i18n';
import { FALLBACK_LANGUAGE, SUPPORTED_LANGUAGES } from '../i18n/languages';

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const current = i18n.resolvedLanguage ?? FALLBACK_LANGUAGE;
  return (
    <Select value={current} onValueChange={chooseLanguage}>
      <SelectTrigger aria-label={t('common:language.choose')} className="h-9 w-auto gap-1.5 px-2.5" size="sm">
        <Languages aria-hidden className="h-4 w-4 text-muted-foreground" />
        {/* icon only until the header has room for the navigation and the language name; still read by screen readers */}
        <span className="max-lg:sr-only">
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent align="end">
        {SUPPORTED_LANGUAGES.map((language) => (
          <SelectItem key={language.code} lang={language.code} value={language.code}>
            {language.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
