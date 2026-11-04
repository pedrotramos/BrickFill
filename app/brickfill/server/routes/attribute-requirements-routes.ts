import { join } from 'node:path';
import type { Application } from 'express';
import { z } from 'zod';
import { readAppSchema, readSettingsEditors } from '../app-config';
import { sendError } from '../http-errors';
import { reviewer, type Reviewer } from '../identity';
import { type LockingPool, type Queryable, withLock } from '../lakebase-lock';
import { loadLakebaseQueries, readLakebaseSchema, readResultsSchema } from '../lakebase-queries';
import { recordChanges, settingsEvent, text, timestamp, VersionConflict, type Row } from '../settings-events';
import { runLakebaseQuery } from './lakebase-query-routes';

interface AppKitWithLakebase {
  lakebase: Queryable & { pool: LockingPool };
  server: {
    extend(fn: (app: Application) => void): void;
  };
}

/**
 * Attribute requirements per subcategory. The load job syncs what the source says ({results}.attribute_requirement_
 * source, replaced at every load); the team's choice lives here, in the app's own table, so a sync never overwrites
 * it. The enrichment job reads the choices at the start of each batch: effective requirement = the choice, else the
 * source's is_required, else attributes_required_default.
 */
const ddl = (S: string) => [
  `CREATE TABLE IF NOT EXISTS ${S}.attribute_requirement_override (
    subcategory_id TEXT NOT NULL,
    attribute_id TEXT NOT NULL,
    required BOOLEAN,
    revision INT NOT NULL DEFAULT 1,
    updated_by TEXT NOT NULL,
    updated_by_id TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (subcategory_id, attribute_id)
  )`,
];

const Id = z.string().trim().min(1).max(200);
/** true: required; false: optional; null: follow the source again. */
export const RequirementBody = z.object({
  required: z.boolean().nullable(),
  expectedRevision: z.number().int().min(0),
  reason: z.string().trim().max(2000).optional(),
});

/** History scope id of one (subcategory, attribute) pair. */
export const requirementScopeId = (subcategoryId: string, attributeId: string) => `${subcategoryId}:${attributeId}`;

function requirement(row: Row) {
  const optionalBoolean = (value: unknown) => (typeof value === 'boolean' ? value : null);
  const source = optionalBoolean(row.source_effective_required);
  const override = optionalBoolean(row.override_required);
  return {
    subcategoryId: text(row.subcategory_id) ?? '',
    attributeId: text(row.attribute_id) ?? '',
    attributeName: text(row.attribute_name),
    sourceRequired: optionalBoolean(row.source_required),
    /** the source's flag, or attributes_required_default when the source has none */
    sourceEffectiveRequired: source,
    overrideRequired: override,
    effectiveRequired: override ?? source,
    revision: Number(row.revision ?? 0),
    updatedBy: text(row.updated_by),
    updatedAt: timestamp(row.updated_at),
    inSource: row.in_source === true,
    syncedAt: timestamp(row.synced_at),
  };
}

export async function setupAttributeRequirementRoutes(appkit: AppKitWithLakebase) {
  const { name: schemaName, sql: S } = readAppSchema();
  const editors = readSettingsEditors();
  const canEdit = (user: Reviewer | undefined) =>
    user !== undefined && (editors.size === 0 || editors.has(user.email.toLowerCase()));
  const queries = loadLakebaseQueries(join(process.cwd(), 'config', 'lakebase-queries'), {
    serving: readLakebaseSchema(),
    results: readResultsSchema(),
    app: S,
  });
  const attributesQuery = queries.get('attribute_requirements');
  if (!attributesQuery) throw new Error('config/lakebase-queries/attribute_requirements.sql is missing');

  if (process.env.NODE_ENV !== 'development') {
    for (const statement of ddl(S)) await appkit.lakebase.query(statement);
  }

  appkit.server.extend((app) => {
    app.get('/api/attribute-requirements/:subcategoryId', async (req, res) => {
      const subcategoryId = Id.safeParse(req.params.subcategoryId);
      if (!subcategoryId.success) {
        sendError(res, 400, 'INVALID_REQUIREMENT');
        return;
      }
      try {
        const [rows, history] = await Promise.all([
          runLakebaseQuery(appkit.lakebase, attributesQuery, [subcategoryId.data]),
          appkit.lakebase.query(
            `SELECT * FROM ${S}.settings_event WHERE scope = 'attribute' AND scope_id LIKE $1 || ':%'
             ORDER BY created_at DESC, id DESC LIMIT 100`,
            [subcategoryId.data.replace(/[\\%_]/g, (character) => `\\${character}`)]
          ),
        ]);
        res.json({
          attributes: rows.map(requirement),
          canEdit: canEdit(reviewer(req)),
          history: history.rows.map(settingsEvent),
        });
      } catch (error) {
        console.error('Failed to load the attribute requirements', error);
        sendError(res, 500, 'REQUIREMENTS_LOAD_FAILED');
      }
    });

    app.put('/api/attribute-requirements/:subcategoryId/:attributeId', async (req, res) => {
      const user = reviewer(req);
      if (!user) {
        sendError(res, 401, 'UNIDENTIFIED_USER');
        return;
      }
      if (!canEdit(user)) {
        sendError(res, 403, 'SETTINGS_FORBIDDEN');
        return;
      }
      const subcategoryId = Id.safeParse(req.params.subcategoryId);
      const attributeId = Id.safeParse(req.params.attributeId);
      const body = RequirementBody.safeParse(req.body);
      if (!subcategoryId.success || !attributeId.success || !body.success) {
        sendError(res, 400, 'INVALID_REQUIREMENT', body.success ? undefined : body.error.issues[0]?.message);
        return;
      }
      const next = body.data;
      try {
        const row = await withLock(
          appkit.lakebase.pool,
          `${schemaName}.attribute_requirement:${subcategoryId.data}:${attributeId.data}`,
          async (client) => {
            const current = (
              await client.query(
                `SELECT * FROM ${S}.attribute_requirement_override WHERE subcategory_id = $1 AND attribute_id = $2`,
                [subcategoryId.data, attributeId.data]
              )
            ).rows[0];
            if (Number(current?.revision ?? 0) !== next.expectedRevision) throw new VersionConflict();
            const saved = await client.query(
              `INSERT INTO ${S}.attribute_requirement_override
                 (subcategory_id, attribute_id, required, revision, updated_by, updated_by_id, updated_at)
               VALUES ($1, $2, $3, 1, $4, $5, NOW())
               ON CONFLICT (subcategory_id, attribute_id) DO UPDATE SET
                 required = EXCLUDED.required, revision = ${S}.attribute_requirement_override.revision + 1,
                 updated_by = EXCLUDED.updated_by, updated_by_id = EXCLUDED.updated_by_id, updated_at = NOW()
               RETURNING *`,
              [subcategoryId.data, attributeId.data, next.required, user.email, user.id]
            );
            const before = typeof current?.required === 'boolean' ? current.required : null;
            if (before !== next.required) {
              await recordChanges(
                client,
                S,
                'attribute',
                requirementScopeId(subcategoryId.data, attributeId.data),
                [{ key: 'required', before, after: next.required }],
                next.reason,
                user,
                Number(saved.rows[0].revision)
              );
            }
            return saved.rows[0];
          }
        );
        res.json({
          subcategoryId: text(row.subcategory_id),
          attributeId: text(row.attribute_id),
          overrideRequired: typeof row.required === 'boolean' ? row.required : null,
          revision: Number(row.revision),
          updatedBy: text(row.updated_by),
          updatedAt: timestamp(row.updated_at),
        });
      } catch (error) {
        if (error instanceof VersionConflict) {
          sendError(res, 409, 'REQUIREMENT_VERSION_CONFLICT');
          return;
        }
        console.error('Failed to save the attribute requirement', error);
        sendError(res, 500, 'REQUIREMENT_SAVE_FAILED');
      }
    });
  });
}
