import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@databricks/appkit-ui/react';
import { Languages } from 'lucide-react';
import { useTranslation } from '../i18n/react';
import { chooseLanguage } from '../i18n';
import { FALLBACK_LANGUAGE, SUPPORTED_LANGUAGES } from '../i18n/languages';

/** `wide` shows the language name at every width (the sidebar); otherwise it is icon-only on small screens. */
export function LanguageSwitcher({ wide = false }: { wide?: boolean }) {
  const { t, i18n } = useTranslation();
  const current = i18n.resolvedLanguage ?? FALLBACK_LANGUAGE;
  return (
    <Select value={current} onValueChange={chooseLanguage}>
      <SelectTrigger
        aria-label={t('common:language.choose')}
        className={wide ? 'h-8 w-full gap-2 px-2' : 'h-9 w-auto gap-1.5 px-2.5'}
        size="sm"
      >
        <Languages aria-hidden className="h-4 w-4 text-muted-foreground" />
        {/* icon only on small screens outside the sidebar; still read by screen readers */}
        <span className={wide ? 'mr-auto' : 'max-lg:sr-only'}>
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
