import { join } from 'node:path';
import type { Application } from 'express';
import { z } from 'zod';
import { readAppSchema, readSettingsDefaults, readSettingsEditors } from '../app-config';
import {
  codesOf,
  lengthConflict,
  loadContentManifest,
  overridesSchema,
  type ContentManifest,
  type ScopeChain,
  type SettingsLayer,
} from '../content-manifest';
import { sendError } from '../http-errors';
import { reviewer, type Reviewer } from '../identity';
import { type LockingPool, type Queryable, withLock } from '../lakebase-lock';
import { loadLakebaseQueries, readLakebaseSchema, readResultsSchema } from '../lakebase-queries';
import { runLakebaseQuery } from './lakebase-query-routes';

interface AppKitWithLakebase {
  lakebase: Queryable & { pool: LockingPool };
  server: {
    extend(fn: (app: Application) => void): void;
  };
}

/**
 * Enrichment settings kept in Lakebase and read by the enrichment job at the start of every batch: the language and
 * content profile of the generated content, the market, and profile overrides, globally (app_settings) and per
 * department/category/subcategory (category_settings). Precedence on the job, field by field: subcategory > category
 * > department > app_settings > job parameters > profile file. Every change writes one settings_event per field.
 */
const ddl = (S: string) => [
  `CREATE SCHEMA IF NOT EXISTS ${S}`,
  `CREATE TABLE IF NOT EXISTS ${S}.app_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    content_language TEXT NOT NULL,
    catalog_language TEXT,
    content_profile TEXT NOT NULL DEFAULT 'default',
    market TEXT,
    overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
    version INT NOT NULL DEFAULT 1,
    updated_by TEXT NOT NULL,
    updated_by_id TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS ${S}.category_settings (
    scope TEXT NOT NULL CHECK (scope IN ('department', 'category', 'subcategory')),
    scope_id TEXT NOT NULL,
    scope_name TEXT,
    content_language TEXT,
    content_profile TEXT,
    overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    version INT NOT NULL DEFAULT 1,
    updated_by TEXT NOT NULL,
    updated_by_id TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (scope, scope_id)
  )`,
  `CREATE TABLE IF NOT EXISTS ${S}.settings_event (
    id BIGSERIAL PRIMARY KEY,
    scope TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    field_key TEXT NOT NULL,
    before_value JSONB,
    after_value JSONB,
    reason TEXT,
    actor TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS settings_event_created_idx ON ${S}.settings_event (created_at DESC)`,
];

const SCOPES = ['department', 'category', 'subcategory'] as const;
const Scope = z.enum(SCOPES);
const ScopeId = z.string().trim().min(1).max(200);
const Reason = z.string().trim().max(2000).optional();
const ExpectedVersion = z.number().int().min(0);

type Overrides = Record<string, unknown>;
type Row = Record<string, unknown>;

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const timestamp = (value: unknown): string | null =>
  value instanceof Date ? value.toISOString() : typeof value === 'string' ? value : null;
const objectValue = (value: unknown): Overrides =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Overrides) : {};

function appSettings(row: Row) {
  return {
    contentLanguage: text(row.content_language) ?? '',
    catalogLanguage: text(row.catalog_language),
    contentProfile: text(row.content_profile) ?? 'default',
    market: text(row.market),
    overrides: objectValue(row.overrides),
    version: Number(row.version),
    updatedBy: text(row.updated_by) ?? '',
    updatedAt: timestamp(row.updated_at),
  };
}

function categorySetting(row: Row) {
  return {
    scope: text(row.scope) ?? '',
    scopeId: text(row.scope_id) ?? '',
    scopeName: text(row.scope_name),
    contentLanguage: text(row.content_language),
    contentProfile: text(row.content_profile),
    overrides: objectValue(row.overrides),
    active: row.active === true,
    version: Number(row.version),
    updatedBy: text(row.updated_by) ?? '',
    updatedAt: timestamp(row.updated_at),
  };
}

function settingsEvent(row: Row) {
  return {
    id: Number(row.id),
    scope: text(row.scope) ?? '',
    scopeId: text(row.scope_id) ?? '',
    fieldKey: text(row.field_key) ?? '',
    before: row.before_value ?? null,
    after: row.after_value ?? null,
    reason: text(row.reason),
    actor: text(row.actor) ?? '',
    createdAt: timestamp(row.created_at),
  };
}

/** Field-level changes between two flat states; overrides are compared key by key as "overrides.<key>". */
function changes(before: Record<string, unknown>, after: Record<string, unknown>) {
  const flatten = (state: Record<string, unknown>) => {
    const { overrides, ...fields } = state;
    const flat: Record<string, unknown> = { ...fields };
    for (const [key, value] of Object.entries(objectValue(overrides))) flat[`overrides.${key}`] = value;
    return flat;
  };
  const left = flatten(before);
  const right = flatten(after);
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  return keys
    .filter((key) => JSON.stringify(left[key] ?? null) !== JSON.stringify(right[key] ?? null))
    .map((key) => ({ key, before: left[key] ?? null, after: right[key] ?? null }));
}

const json = (value: unknown) => (value === null || value === undefined ? null : JSON.stringify(value));

async function recordChanges(
  client: Queryable,
  S: string,
  scope: string,
  scopeId: string,
  diff: ReturnType<typeof changes>,
  reason: string | undefined,
  user: Reviewer
) {
  for (const change of diff) {
    await client.query(
      `INSERT INTO ${S}.settings_event
         (scope, scope_id, field_key, before_value, after_value, reason, actor, actor_id)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8)`,
      [scope, scopeId, change.key, json(change.before), json(change.after), reason || null, user.email, user.id]
    );
  }
}

class VersionConflict extends Error {}
class NotFound extends Error {}
/** The saved settings would give some products a minimum length above the maximum: the job would fail the batch. */
class InvalidResolvedSettings extends Error {}

export async function setupSettingsRoutes(appkit: AppKitWithLakebase) {
  const { name: schemaName, sql: S } = readAppSchema();
  const manifest: ContentManifest = loadContentManifest();
  const defaults = readSettingsDefaults();
  const editors = readSettingsEditors();
  const codes = codesOf(manifest);
  const Overrides = overridesSchema(manifest);
  const Language = z.enum(codes.languages as [string, ...string[]]);
  const Profile = z.enum(codes.profiles as [string, ...string[]]);
  const Market = codes.markets.length ? z.enum(codes.markets as [string, ...string[]]) : z.never();

  const AppSettingsBody = z.object({
    contentLanguage: Language,
    catalogLanguage: Language.nullable().optional(),
    contentProfile: Profile,
    market: Market.nullable().optional(),
    overrides: Overrides,
    expectedVersion: ExpectedVersion,
    reason: Reason,
  });
  const CategorySettingBody = z.object({
    scopeName: z.string().trim().max(300).nullable().optional(),
    contentLanguage: Language.nullable().optional(),
    contentProfile: Profile.nullable().optional(),
    overrides: Overrides,
    expectedVersion: ExpectedVersion,
    reason: Reason,
  });

  const scopesQuery = loadLakebaseQueries(join(process.cwd(), 'config', 'lakebase-queries'), {
    serving: readLakebaseSchema(),
    results: readResultsSchema(),
    app: S,
  }).get('settings_scopes');

  /** Department/category/subcategory combinations of the catalog; none while the catalog is not synced yet. */
  async function scopeChains(): Promise<ScopeChain[]> {
    if (!scopesQuery) return [];
    try {
      return (await runLakebaseQuery(appkit.lakebase, scopesQuery, [])) as ScopeChain[];
    } catch (error) {
      console.warn('Catalog scopes unavailable; checking the global settings only', error);
      return [];
    }
  }

  /** Reject the change when, with it applied, some product would resolve to conflicting length limits. */
  async function checkResolved(
    client: Queryable,
    chains: ScopeChain[],
    change: { global?: SettingsLayer; scope?: { key: string; layer: SettingsLayer | null } }
  ) {
    const globalRow = (await client.query(`SELECT * FROM ${S}.app_settings WHERE id = 1`)).rows[0];
    const global =
      change.global ??
      (globalRow
        ? { contentProfile: text(globalRow.content_profile), overrides: objectValue(globalRow.overrides) }
        : undefined);
    const rows = (await client.query(`SELECT * FROM ${S}.category_settings WHERE active`)).rows;
    const scopes = new Map<string, SettingsLayer>(
      rows.map((row) => [
        `${text(row.scope)}:${text(row.scope_id)}`,
        { contentProfile: text(row.content_profile), overrides: objectValue(row.overrides) },
      ])
    );
    if (change.scope?.layer) scopes.set(change.scope.key, change.scope.layer);
    else if (change.scope) scopes.delete(change.scope.key);
    const conflict = lengthConflict(manifest, defaults.contentProfile, global, scopes, chains);
    if (conflict) {
      const maximumKey = conflict.key.replace(/_min_length$/, '_max_length');
      throw new InvalidResolvedSettings(
        `${conflict.key} (${conflict.minimum}) must not exceed ${maximumKey} (${conflict.maximum}) ` +
          `for products under ${conflict.layers.join(' > ') || 'the profile defaults'}`
      );
    }
  }

  const lockKey = `${schemaName}.settings`;
  const canEdit = (user: Reviewer | undefined) =>
    user !== undefined && (editors.size === 0 || editors.has(user.email.toLowerCase()));

  if (process.env.NODE_ENV !== 'development') {
    for (const statement of ddl(S)) {
      await appkit.lakebase.query(statement);
    }
  }

  appkit.server.extend((app) => {
    app.get('/api/settings', async (req, res) => {
      try {
        const [global, categories, history] = await Promise.all([
          appkit.lakebase.query(`SELECT * FROM ${S}.app_settings WHERE id = 1`),
          appkit.lakebase.query(
            `SELECT * FROM ${S}.category_settings WHERE active ORDER BY scope, COALESCE(scope_name, scope_id)`
          ),
          appkit.lakebase.query(`SELECT * FROM ${S}.settings_event ORDER BY created_at DESC, id DESC LIMIT 50`),
        ]);
        res.json({
          app: global.rows[0] ? appSettings(global.rows[0]) : null,
          categories: categories.rows.map(categorySetting),
          defaults,
          manifest,
          canEdit: canEdit(reviewer(req)),
          history: history.rows.map(settingsEvent),
        });
      } catch (error) {
        console.error('Failed to load settings', error);
        sendError(res, 500, 'SETTINGS_LOAD_FAILED');
      }
    });

    app.put('/api/settings', async (req, res) => {
      const user = reviewer(req);
      if (!user) {
        sendError(res, 401, 'UNIDENTIFIED_USER');
        return;
      }
      if (!canEdit(user)) {
        sendError(res, 403, 'SETTINGS_FORBIDDEN');
        return;
      }
      const body = AppSettingsBody.safeParse(req.body);
      if (!body.success) {
        sendError(res, 400, 'INVALID_SETTINGS', body.error.issues[0]?.message);
        return;
      }
      const next = body.data;
      try {
        const chains = await scopeChains();
        const row = await withLock(appkit.lakebase.pool, lockKey, async (client) => {
          const current = (await client.query(`SELECT * FROM ${S}.app_settings WHERE id = 1`)).rows[0];
          if (Number(current?.version ?? 0) !== next.expectedVersion) throw new VersionConflict();
          await checkResolved(client, chains, {
            global: { contentProfile: next.contentProfile, overrides: next.overrides },
          });
          const saved = await client.query(
            `INSERT INTO ${S}.app_settings
               (id, content_language, catalog_language, content_profile, market, overrides, version,
                updated_by, updated_by_id, updated_at)
             VALUES (1, $1, $2, $3, $4, $5::jsonb, 1, $6, $7, NOW())
             ON CONFLICT (id) DO UPDATE SET
               content_language = EXCLUDED.content_language, catalog_language = EXCLUDED.catalog_language,
               content_profile = EXCLUDED.content_profile, market = EXCLUDED.market,
               overrides = EXCLUDED.overrides, version = ${S}.app_settings.version + 1,
               updated_by = EXCLUDED.updated_by, updated_by_id = EXCLUDED.updated_by_id, updated_at = NOW()
             RETURNING *`,
            [
              next.contentLanguage,
              next.catalogLanguage ?? null,
              next.contentProfile,
              next.market ?? null,
              JSON.stringify(next.overrides),
              user.email,
              user.id,
            ]
          );
          const before = current
            ? {
                content_language: current.content_language,
                catalog_language: current.catalog_language,
                content_profile: current.content_profile,
                market: current.market,
                overrides: current.overrides,
              }
            : {};
          const after = {
            content_language: next.contentLanguage,
            catalog_language: next.catalogLanguage ?? null,
            content_profile: next.contentProfile,
            market: next.market ?? null,
            overrides: next.overrides,
          };
          await recordChanges(client, S, 'global', '1', changes(before, after), next.reason, user);
          return saved.rows[0];
        });
        res.json(appSettings(row));
      } catch (error) {
        if (error instanceof VersionConflict) {
          sendError(res, 409, 'SETTINGS_VERSION_CONFLICT');
          return;
        }
        if (error instanceof InvalidResolvedSettings) {
          sendError(res, 400, 'INVALID_SETTINGS', error.message);
          return;
        }
        console.error('Failed to save settings', error);
        sendError(res, 500, 'SETTINGS_SAVE_FAILED');
      }
    });

    app.put('/api/settings/:scope/:scopeId', async (req, res) => {
      const user = reviewer(req);
      if (!user) {
        sendError(res, 401, 'UNIDENTIFIED_USER');
        return;
      }
      if (!canEdit(user)) {
        sendError(res, 403, 'SETTINGS_FORBIDDEN');
        return;
      }
      const scope = Scope.safeParse(req.params.scope);
      const scopeId = ScopeId.safeParse(req.params.scopeId);
      const body = CategorySettingBody.safeParse(req.body);
      if (!scope.success || !scopeId.success || !body.success) {
        sendError(res, 400, 'INVALID_SETTINGS', body.success ? undefined : body.error.issues[0]?.message);
        return;
      }
      const next = body.data;
      try {
        const chains = await scopeChains();
        const row = await withLock(appkit.lakebase.pool, lockKey, async (client) => {
          const current = (
            await client.query(`SELECT * FROM ${S}.category_settings WHERE scope = $1 AND scope_id = $2`, [
              scope.data,
              scopeId.data,
            ])
          ).rows[0];
          // A deactivated row counts as absent: the client sees no setting and sends version 0.
          const active = current?.active === true;
          if ((active ? Number(current.version) : 0) !== next.expectedVersion) throw new VersionConflict();
          await checkResolved(client, chains, {
            scope: {
              key: `${scope.data}:${scopeId.data}`,
              layer: { contentProfile: next.contentProfile ?? null, overrides: next.overrides },
            },
          });
          const saved = await client.query(
            `INSERT INTO ${S}.category_settings
               (scope, scope_id, scope_name, content_language, content_profile, overrides, active, version,
                updated_by, updated_by_id, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, TRUE, 1, $7, $8, NOW())
             ON CONFLICT (scope, scope_id) DO UPDATE SET
               scope_name = EXCLUDED.scope_name, content_language = EXCLUDED.content_language,
               content_profile = EXCLUDED.content_profile, overrides = EXCLUDED.overrides, active = TRUE,
               version = ${S}.category_settings.version + 1, updated_by = EXCLUDED.updated_by,
               updated_by_id = EXCLUDED.updated_by_id, updated_at = NOW()
             RETURNING *`,
            [
              scope.data,
              scopeId.data,
              next.scopeName ?? text(current?.scope_name) ?? null,
              next.contentLanguage ?? null,
              next.contentProfile ?? null,
              JSON.stringify(next.overrides),
              user.email,
              user.id,
            ]
          );
          const before = active
            ? {
                active: true,
                content_language: current.content_language,
                content_profile: current.content_profile,
                overrides: current.overrides,
              }
            : { active: false };
          const after = {
            active: true,
            content_language: next.contentLanguage ?? null,
            content_profile: next.contentProfile ?? null,
            overrides: next.overrides,
          };
          await recordChanges(client, S, scope.data, scopeId.data, changes(before, after), next.reason, user);
          return saved.rows[0];
        });
        res.json(categorySetting(row));
      } catch (error) {
        if (error instanceof VersionConflict) {
          sendError(res, 409, 'SETTINGS_VERSION_CONFLICT');
          return;
        }
        if (error instanceof InvalidResolvedSettings) {
          sendError(res, 400, 'INVALID_SETTINGS', error.message);
          return;
        }
        console.error('Failed to save category settings', error);
        sendError(res, 500, 'SETTINGS_SAVE_FAILED');
      }
    });

    app.delete('/api/settings/:scope/:scopeId', async (req, res) => {
      const user = reviewer(req);
      if (!user) {
        sendError(res, 401, 'UNIDENTIFIED_USER');
        return;
      }
      if (!canEdit(user)) {
        sendError(res, 403, 'SETTINGS_FORBIDDEN');
        return;
      }
      const scope = Scope.safeParse(req.params.scope);
      const scopeId = ScopeId.safeParse(req.params.scopeId);
      const expectedVersion = z.coerce.number().int().min(1).safeParse(req.query.expectedVersion);
      if (!scope.success || !scopeId.success || !expectedVersion.success) {
        sendError(res, 400, 'INVALID_SETTINGS');
        return;
      }
      const reason = typeof req.query.reason === 'string' ? req.query.reason.slice(0, 2000) : undefined;
      try {
        const chains = await scopeChains();
        await withLock(appkit.lakebase.pool, lockKey, async (client) => {
          const current = (
            await client.query(
              `SELECT * FROM ${S}.category_settings WHERE scope = $1 AND scope_id = $2 AND active = TRUE`,
              [scope.data, scopeId.data]
            )
          ).rows[0];
          if (!current) throw new NotFound();
          if (Number(current.version) !== expectedVersion.data) throw new VersionConflict();
          await checkResolved(client, chains, { scope: { key: `${scope.data}:${scopeId.data}`, layer: null } });
          await client.query(
            `UPDATE ${S}.category_settings
             SET active = FALSE, version = version + 1, updated_by = $3, updated_by_id = $4, updated_at = NOW()
             WHERE scope = $1 AND scope_id = $2`,
            [scope.data, scopeId.data, user.email, user.id]
          );
          await recordChanges(
            client,
            S,
            scope.data,
            scopeId.data,
            [{ key: 'active', before: true, after: false }],
            reason,
            user
          );
        });
        res.status(204).send();
      } catch (error) {
        if (error instanceof NotFound) {
          sendError(res, 404, 'NOT_FOUND');
          return;
        }
        if (error instanceof VersionConflict) {
          sendError(res, 409, 'SETTINGS_VERSION_CONFLICT');
          return;
        }
        if (error instanceof InvalidResolvedSettings) {
          sendError(res, 400, 'INVALID_SETTINGS', error.message);
          return;
        }
        console.error('Failed to remove category settings', error);
        sendError(res, 500, 'SETTINGS_SAVE_FAILED');
      }
    });
  });
}
