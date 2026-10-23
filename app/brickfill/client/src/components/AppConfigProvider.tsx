import { useEffect, useState, type ReactNode } from 'react';
import i18n, { hasDetectedLanguage } from '../i18n';
import { matchLanguage } from '../i18n/languages';
import { AppConfigContext, DEFAULT_APP_CONFIG, parseAppConfig, type AppConfig } from '../lib/app-config';
import { applyAccentColor } from '../lib/branding';

/** Loads /api/config once: the default UI language and the optional customer co-branding. Never blocks rendering. */
export function AppConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_APP_CONFIG);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/config', { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: unknown) => {
        if (controller.signal.aborted || !payload) return;
        const loaded = parseAppConfig(payload);
        setConfig(loaded);
        const serverDefault = matchLanguage(loaded.uiDefaultLanguage);
        if (serverDefault && !hasDetectedLanguage() && i18n.resolvedLanguage !== serverDefault) {
          void i18n.changeLanguage(serverDefault);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    applyAccentColor(config.brand.accentColor);
  }, [config.brand.accentColor]);

  return <AppConfigContext.Provider value={config}>{children}</AppConfigContext.Provider>;
}
