import { ensureOk } from './api-errors';

/** Mirrors config/content-manifest.json (generated from the pipeline's content packs). */
export type OverrideSpec =
  | { type: 'integer'; minimum: number; maximum: number }
  | { type: 'boolean' }
  | { type: 'string_list'; max_items: number; max_length: number }
  | { type: 'enum'; values: string[] };

export interface ContentManifest {
  contract_version: string;
  languages: Array<{ code: string; name: string }>;
  profiles: Array<{ id: string; name: string }>;
  markets: Array<{ code: string; name: string }>;
  overrides: Record<string, OverrideSpec>;
  profile_defaults: Record<string, Record<string, unknown>>;
}

export type Overrides = Record<string, unknown>;
export type SettingsScope = 'department' | 'category' | 'subcategory';

export interface AppSettings {
  contentLanguage: string;
  catalogLanguage: string | null;
  contentProfile: string;
  market: string | null;
  overrides: Overrides;
  version: number;
  updatedBy: string;
  updatedAt: string | null;
}

export interface CategorySetting {
  scope: SettingsScope | string;
  scopeId: string;
  scopeName: string | null;
  contentLanguage: string | null;
  contentProfile: string | null;
  overrides: Overrides;
  active: boolean;
  version: number;
  updatedBy: string;
  updatedAt: string | null;
}

export interface SettingsEvent {
  id: number;
  scope: string;
  scopeId: string;
  fieldKey: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  actor: string;
  createdAt: string | null;
}

export interface SettingsDefaults {
  contentLanguage: string;
  catalogLanguage: string | null;
  contentProfile: string;
  market: string | null;
}

/** GET /api/settings. */
export interface SettingsState {
  app: AppSettings | null;
  categories: CategorySetting[];
  defaults: SettingsDefaults;
  manifest: ContentManifest;
  canEdit: boolean;
  history: SettingsEvent[];
}

export interface AppSettingsBody {
  contentLanguage: string;
  catalogLanguage: string | null;
  contentProfile: string;
  market: string | null;
  overrides: Overrides;
  expectedVersion: number;
  reason?: string;
}

export interface CategorySettingBody {
  scopeName: string | null;
  contentLanguage: string | null;
  contentProfile: string | null;
  overrides: Overrides;
  expectedVersion: number;
  reason?: string;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export async function loadSettings(signal?: AbortSignal): Promise<SettingsState> {
  const response = await ensureOk(await fetch('/api/settings', { signal }), 'errors:SETTINGS_LOAD_FAILED');
  return (await response.json()) as SettingsState;
}

export async function saveAppSettings(body: AppSettingsBody): Promise<AppSettings> {
  const response = await fetch('/api/settings', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(body) });
  await ensureOk(response, 'errors:SETTINGS_SAVE_FAILED');
  return (await response.json()) as AppSettings;
}

function scopePath(scope: string, scopeId: string): string {
  return `/api/settings/${encodeURIComponent(scope)}/${encodeURIComponent(scopeId)}`;
}

export async function saveCategorySetting(
  scope: SettingsScope,
  scopeId: string,
  body: CategorySettingBody
): Promise<CategorySetting> {
  const response = await fetch(scopePath(scope, scopeId), {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  await ensureOk(response, 'errors:SETTINGS_SAVE_FAILED');
  return (await response.json()) as CategorySetting;
}

export async function removeCategorySetting(scope: string, scopeId: string, expectedVersion: number): Promise<void> {
  const response = await fetch(
    `${scopePath(scope, scopeId)}?${new URLSearchParams({ expectedVersion: String(expectedVersion) })}`,
    {
      method: 'DELETE',
    }
  );
  await ensureOk(response, 'errors:SETTINGS_SAVE_FAILED');
}

/** Drops empty values so the job falls back to the profile (an override only exists when it differs). */
export function cleanOverrides(overrides: Overrides): Overrides {
  return Object.fromEntries(
    Object.entries(overrides).filter(
      ([, value]) => value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && !value.length)
    )
  );
}
