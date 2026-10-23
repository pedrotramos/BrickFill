import { createContext, useContext } from 'react';

export interface BrandConfig {
  customerName: string | null;
  customerLogoUrl: string | null;
  accentColor: string | null;
}

/** GET /api/config. */
export interface AppConfig {
  uiDefaultLanguage: string;
  contentLanguageDefault: string;
  brand: BrandConfig;
}

export const DEFAULT_APP_CONFIG: AppConfig = {
  uiDefaultLanguage: 'en',
  contentLanguageDefault: 'en',
  brand: { customerName: null, customerLogoUrl: null, accentColor: null },
};

export const AppConfigContext = createContext<AppConfig>(DEFAULT_APP_CONFIG);

export function useAppConfig(): AppConfig {
  return useContext(AppConfigContext);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Tolerates a partial or older server: any missing field keeps the BrickFill default. */
export function parseAppConfig(payload: unknown): AppConfig {
  const body = (payload ?? {}) as Record<string, unknown>;
  const brand = (body.brand ?? {}) as Record<string, unknown>;
  const logo = text(brand.customerLogoUrl);
  return {
    uiDefaultLanguage: text(body.uiDefaultLanguage) ?? DEFAULT_APP_CONFIG.uiDefaultLanguage,
    contentLanguageDefault: text(body.contentLanguageDefault) ?? DEFAULT_APP_CONFIG.contentLanguageDefault,
    brand: {
      customerName: text(brand.customerName),
      // Only http(s) or same-origin logos are rendered.
      customerLogoUrl: logo && /^(https:\/\/|\/)/.test(logo) ? logo : null,
      accentColor: text(brand.accentColor),
    },
  };
}
