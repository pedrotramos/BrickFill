import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

/**
 * What the Settings screen may choose: languages, content profiles, markets and the overridable subset of a profile.
 * Generated from the pipeline's content packs (scripts/export_content_manifest.py at the repository root) into
 * config/content-manifest.json, because the app bundle does not ship the Python package.
 */
const OverrideSpec = z.discriminatedUnion('type', [
  z.object({ type: z.literal('integer'), minimum: z.number().int(), maximum: z.number().int() }),
  z.object({ type: z.literal('boolean') }),
  z.object({ type: z.literal('string_list'), max_items: z.number().int().positive(), max_length: z.number().int() }),
  z.object({ type: z.literal('enum'), values: z.array(z.string()).min(1) }),
]);
export type OverrideSpec = z.infer<typeof OverrideSpec>;

const ContentManifest = z.object({
  contract_version: z.string(),
  languages: z.array(z.object({ code: z.string(), name: z.string() })).min(1),
  profiles: z.array(z.object({ id: z.string(), name: z.string() })).min(1),
  markets: z.array(z.object({ code: z.string(), name: z.string() })),
  overrides: z.record(z.string(), OverrideSpec),
  profile_defaults: z.record(z.string(), z.record(z.string(), z.unknown())),
});
export type ContentManifest = z.infer<typeof ContentManifest>;

/** Used only when config/content-manifest.json is missing; mirrors the neutral "default" profile. */
export const FALLBACK_MANIFEST: ContentManifest = {
  contract_version: '1',
  languages: [
    { code: 'en', name: 'English' },
    { code: 'pt-BR', name: 'Português (Brasil)' },
    { code: 'es', name: 'Español' },
  ],
  profiles: [{ id: 'default', name: 'Default (neutral)' }],
  markets: [
    { code: 'BR', name: 'Brazil' },
    { code: 'ES', name: 'Spain' },
    { code: 'MX', name: 'Mexico' },
    { code: 'US', name: 'United States' },
  ],
  overrides: {
    title_max_length: { type: 'integer', minimum: 40, maximum: 300 },
    short_description_min_length: { type: 'integer', minimum: 0, maximum: 1000 },
    short_description_max_length: { type: 'integer', minimum: 50, maximum: 2000 },
    meta_description_min_length: { type: 'integer', minimum: 0, maximum: 300 },
    meta_description_max_length: { type: 'integer', minimum: 50, maximum: 320 },
    meta_description_required_suffixes: { type: 'string_list', max_items: 5, max_length: 40 },
    faq_enabled: { type: 'boolean' },
    units: { type: 'enum', values: ['metric', 'imperial'] },
    image_min_width: { type: 'integer', minimum: 100, maximum: 5000 },
    image_min_height: { type: 'integer', minimum: 100, maximum: 5000 },
  },
  profile_defaults: {
    default: {
      title_max_length: 150,
      short_description_min_length: 120,
      short_description_max_length: 300,
      meta_description_min_length: 70,
      meta_description_max_length: 160,
      meta_description_required_suffixes: [],
      faq_enabled: true,
      units: 'metric',
      image_min_width: 1000,
      image_min_height: 1000,
    },
  },
};

export function loadContentManifest(path = join(process.cwd(), 'config', 'content-manifest.json')): ContentManifest {
  if (!existsSync(path)) {
    console.warn(`${path} not found; Settings uses the built-in content manifest`);
    return FALLBACK_MANIFEST;
  }
  return ContentManifest.parse(JSON.parse(readFileSync(path, 'utf8')));
}

function overrideValue(spec: OverrideSpec): z.ZodType {
  switch (spec.type) {
    case 'integer':
      return z.number().int().min(spec.minimum).max(spec.maximum);
    case 'boolean':
      return z.boolean();
    case 'string_list':
      return z.array(z.string().trim().min(1).max(spec.max_length)).max(spec.max_items);
    case 'enum':
      return z.enum(spec.values as [string, ...string[]]);
  }
}

/** Flat object with only the manifest's override keys, each validated by its spec; unknown keys are rejected. */
export function overridesSchema(manifest: ContentManifest) {
  const shape = Object.fromEntries(
    Object.entries(manifest.overrides).map(([key, spec]) => [key, overrideValue(spec).optional()])
  );
  return z
    .object(shape)
    .strict()
    .superRefine((value: Record<string, unknown>, context) => {
      // Every "<name>_min_length" must not exceed its "<name>_max_length" when both are set.
      for (const [key, minimum] of Object.entries(value)) {
        if (!key.endsWith('_min_length') || typeof minimum !== 'number') continue;
        const maximumKey = key.replace(/_min_length$/, '_max_length');
        const maximum = value[maximumKey];
        if (typeof maximum === 'number' && minimum > maximum) {
          context.addIssue({ code: 'custom', path: [key], message: `${key} must not exceed ${maximumKey}` });
        }
      }
    });
}

/** One settings layer as saved: app_settings or one category_settings row. */
export interface SettingsLayer {
  contentProfile?: string | null;
  overrides: Record<string, unknown>;
}

/** Department, category and subcategory of products in the catalog; one entry per distinct combination. */
export interface ScopeChain {
  department_id?: string | null;
  category_id?: string | null;
  subcategory_id?: string | null;
}

export const SCOPE_KEYS = ['department', 'category', 'subcategory'] as const;
export type ScopeKey = (typeof SCOPE_KEYS)[number];

export interface LengthConflict {
  key: string;
  minimum: number;
  maximum: number;
  /** "global" or the "<scope>:<id>" layers of the products that would get the conflicting limits. */
  layers: string[];
}

/**
 * The first "<name>_min_length" above its "<name>_max_length" in the settings each product would get, resolved as
 * the enrichment job does (brickfill.settings.resolve): profile defaults, then app_settings, then department, category
 * and subcategory, key by key. Products with no scope setting get the global layer only, so that chain is always
 * checked; `chains` lists the department/category/subcategory combinations of the catalog.
 */
export function lengthConflict(
  manifest: ContentManifest,
  defaultProfile: string,
  global: SettingsLayer | undefined,
  scopes: ReadonlyMap<string, SettingsLayer>,
  chains: readonly ScopeChain[]
): LengthConflict | undefined {
  const seen = new Set<string>();
  for (const chain of [{}, ...chains] as ScopeChain[]) {
    const layers: [string, SettingsLayer][] = global ? [['global', global]] : [];
    for (const scope of SCOPE_KEYS) {
      const id = chain[`${scope}_id`];
      const layer = id ? scopes.get(`${scope}:${id}`) : undefined;
      if (layer) layers.push([`${scope}:${id}`, layer]);
    }
    const signature = layers.map(([name]) => name).join('|');
    if (seen.has(signature)) continue;
    seen.add(signature);
    let profile = defaultProfile;
    for (const [, layer] of layers) if (layer.contentProfile) profile = layer.contentProfile;
    const values: Record<string, unknown> = { ...manifest.profile_defaults[profile] };
    for (const [, layer] of layers) Object.assign(values, layer.overrides);
    for (const [key, minimum] of Object.entries(values)) {
      if (!key.endsWith('_min_length') || typeof minimum !== 'number') continue;
      const maximum = values[key.replace(/_min_length$/, '_max_length')];
      if (typeof maximum === 'number' && minimum > maximum) {
        return { key, minimum, maximum, layers: layers.map(([name]) => name) };
      }
    }
  }
  return undefined;
}

export function codesOf(manifest: ContentManifest) {
  return {
    languages: manifest.languages.map((item) => item.code),
    profiles: manifest.profiles.map((item) => item.id),
    markets: manifest.markets.map((item) => item.code),
  };
}
