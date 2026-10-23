const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** UI languages shipped with the client bundle. */
export const UI_LANGUAGES = ['en', 'pt-BR', 'es'] as const;

export interface PostgresSchema {
  /** Bare name, used in advisory-lock keys and messages. */
  name: string;
  /** Double-quoted identifier, safe to interpolate in SQL. */
  sql: string;
}

export function postgresSchema(variable: string, value: string): PostgresSchema {
  if (!IDENTIFIER.test(value)) throw new Error(`${variable} is not a valid identifier: ${value}`);
  return { name: value, sql: `"${value}"` };
}

/** Postgres schema the app creates and owns: reviews, edits, manual evidence, settings and audit. */
export function readAppSchema(env: NodeJS.ProcessEnv = process.env): PostgresSchema {
  return postgresSchema('LAKEBASE_APP_SCHEMA', env.LAKEBASE_APP_SCHEMA?.trim() || 'brickfill_app');
}

// Databricks Apps rejects an env entry with an empty value, so the bundle passes "none" for an unset optional value.
const optional = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed && trimmed.toLowerCase() !== 'none' ? trimmed : null;
};

export interface SettingsDefaults {
  contentLanguage: string;
  catalogLanguage: string;
  contentProfile: string;
  market: string | null;
}

/** Deployment defaults (bundle variables) shown in Settings until someone saves app-level settings. */
export function readSettingsDefaults(env: NodeJS.ProcessEnv = process.env): SettingsDefaults {
  const contentLanguage = optional(env.CONTENT_LANGUAGE_DEFAULT) ?? 'en';
  return {
    contentLanguage,
    // Empty means the catalog is written in the content language, as in the platform bundle.
    catalogLanguage: optional(env.CATALOG_LANGUAGE_DEFAULT) ?? contentLanguage,
    contentProfile: optional(env.CONTENT_PROFILE_DEFAULT) ?? 'default',
    market: optional(env.MARKET_DEFAULT),
  };
}

/** E-mails allowed to change Settings (comma-separated). Unset means every app user; changes are audited either way. */
export function readSettingsEditors(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set(
    (optional(env.SETTINGS_EDITORS) ?? '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  );
}

export interface PublicConfig {
  uiDefaultLanguage: string;
  contentLanguageDefault: string;
  brand: {
    customerName: string | null;
    customerLogoUrl: string | null;
    accentColor: string | null;
  };
}

function logoUrl(value: string | undefined): string | null {
  const url = optional(value);
  if (!url) return null;
  return /^https:\/\/[^\s"'<>]+$/.test(url) || /^\/[^\s"'<>]*$/.test(url) ? url : null;
}

/** Configuration the client needs before rendering: default UI language and optional co-branding. */
export function readPublicConfig(env: NodeJS.ProcessEnv = process.env): PublicConfig {
  const language = optional(env.UI_DEFAULT_LANGUAGE);
  const accent = optional(env.BRAND_ACCENT_COLOR);
  const customerName = optional(env.BRAND_CUSTOMER_NAME);
  return {
    uiDefaultLanguage: language && (UI_LANGUAGES as readonly string[]).includes(language) ? language : 'en',
    contentLanguageDefault: readSettingsDefaults(env).contentLanguage,
    brand: {
      customerName: customerName ? customerName.slice(0, 80) : null,
      customerLogoUrl: logoUrl(env.BRAND_CUSTOMER_LOGO_URL),
      accentColor: accent && /^#[0-9A-Fa-f]{6}$/.test(accent) ? accent : null,
    },
  };
}
