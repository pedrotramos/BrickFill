import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Application } from 'express';
import { z } from 'zod';
import { readAppSchema, readSettingsEditors } from '../app-config';
import { seedFileName, TemplateId, templateManifest, templateSchemas, templateState } from '../category-templates';
import { loadContentManifest } from '../content-manifest';
import { sendError } from '../http-errors';
import { reviewer, type Reviewer } from '../identity';
import { type LockingPool, type Queryable, withLock } from '../lakebase-lock';
import {
  changes,
  objectValue,
  recordChanges,
  type Row,
  settingsEvent,
  text,
  timestamp,
  VersionConflict,
} from '../settings-events';

interface AppKitWithLakebase {
  lakebase: Queryable & { pool: LockingPool };
  server: {
    extend(fn: (app: Application) => void): void;
  };
}

const ddl = (S: string) => [
  `CREATE TABLE IF NOT EXISTS ${S}.category_template (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    match JSONB NOT NULL DEFAULT '{}'::jsonb,
    overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    revision INT NOT NULL DEFAULT 1,
    updated_by TEXT NOT NULL,
    updated_by_id TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
];

class TemplateExists extends Error {}

function categoryTemplate(row: Row) {
  return {
    id: text(row.id) ?? '',
    name: text(row.name) ?? '',
    match: objectValue(row.match),
    overrides: objectValue(row.overrides),
    active: row.active === true,
    revision: Number(row.revision),
    updatedBy: text(row.updated_by) ?? '',
    updatedAt: timestamp(row.updated_at),
  };
}

/** Category templates screen: content models per product type, versioned, with field-level history. */
export async function setupCategoryTemplateRoutes(appkit: AppKitWithLakebase) {
  const { name: schemaName, sql: S } = readAppSchema();
  const manifest = loadContentManifest();
  const { Body, Seed } = templateSchemas(manifest);
  const editors = readSettingsEditors();
  const canEdit = (user: Reviewer | undefined) =>
    user !== undefined && (editors.size === 0 || editors.has(user.email.toLowerCase()));
  // the settings lock: a template and a category override are read together by the job
  const lockKey = `${schemaName}.settings`;

  if (process.env.NODE_ENV !== 'development') {
    for (const statement of ddl(S)) await appkit.lakebase.query(statement);
    await loadSeed();
  }

  /**
   * Initial load: templates of CATEGORY_TEMPLATES_SEED (a JSON list in config/) are inserted once, by id. A restart
   * inserts nothing again, and a template edited in the app is never overwritten by the file.
   */
  async function loadSeed() {
    const file = seedFileName(process.env.CATEGORY_TEMPLATES_SEED);
    if (!file) return;
    const path = join(process.cwd(), 'config', file);
    if (!existsSync(path)) {
      console.warn(`CATEGORY_TEMPLATES_SEED ${file} not found in config/; no template loaded`);
      return;
    }
    const entries = z
      .array(Seed)
      .max(500)
      .parse(JSON.parse(readFileSync(path, 'utf8')));
    const loader: Reviewer = { email: `seed:${file}`, id: 'seed' };
    const inserted = await withLock(appkit.lakebase.pool, lockKey, async (client) => {
      let count = 0;
      for (const entry of entries) {
        const saved = await client.query(
          `INSERT INTO ${S}.category_template (id, name, match, overrides, active, revision, updated_by, updated_by_id)
           VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, 1, $6, $7) ON CONFLICT (id) DO NOTHING RETURNING id`,
          [
            entry.id,
            entry.name,
            JSON.stringify(entry.match),
            JSON.stringify(entry.overrides),
            entry.active,
            loader.email,
            loader.id,
          ]
        );
        if (!saved.rows.length) continue;
        count += 1;
        await recordChanges(
          client,
          S,
          'template',
          entry.id,
          changes({}, templateState(entry)),
          `Initial load from ${file}`,
          loader,
          1
        );
      }
      return count;
    });
    if (inserted) console.log(`Loaded ${inserted} category templates from ${file}`);
  }

  appkit.server.extend((app) => {
    app.get('/api/category-templates', async (req, res) => {
      try {
        const [templates, history] = await Promise.all([
          appkit.lakebase.query(`SELECT * FROM ${S}.category_template ORDER BY active DESC, name, id`),
          appkit.lakebase.query(
            `SELECT * FROM ${S}.settings_event WHERE scope = 'template' ORDER BY created_at DESC, id DESC LIMIT 100`
          ),
        ]);
        res.json({
          templates: templates.rows.map(categoryTemplate),
          manifest: templateManifest(manifest),
          canEdit: canEdit(reviewer(req)),
          history: history.rows.map(settingsEvent),
        });
      } catch (error) {
        console.error('Failed to load the category templates', error);
        sendError(res, 500, 'TEMPLATES_LOAD_FAILED');
      }
    });

    app.put('/api/category-templates/:id', async (req, res) => {
      const user = reviewer(req);
      if (!user) {
        sendError(res, 401, 'UNIDENTIFIED_USER');
        return;
      }
      if (!canEdit(user)) {
        sendError(res, 403, 'SETTINGS_FORBIDDEN');
        return;
      }
      const id = TemplateId.safeParse(req.params.id);
      const body = Body.safeParse(req.body);
      if (!id.success || !body.success) {
        sendError(
          res,
          400,
          'INVALID_TEMPLATE',
          (id.success ? undefined : id.error.issues[0]?.message) ??
            (body.success ? undefined : body.error.issues[0]?.message)
        );
        return;
      }
      const next = body.data;
      try {
        const row = await withLock(appkit.lakebase.pool, lockKey, async (client) => {
          const current = (await client.query(`SELECT * FROM ${S}.category_template WHERE id = $1`, [id.data])).rows[0];
          if (!current && next.expectedRevision !== 0) throw new VersionConflict();
          if (current && next.expectedRevision === 0) throw new TemplateExists();
          if (current && Number(current.revision) !== next.expectedRevision) throw new VersionConflict();
          const saved = await client.query(
            `INSERT INTO ${S}.category_template
               (id, name, match, overrides, active, revision, updated_by, updated_by_id, updated_at)
             VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, 1, $6, $7, NOW())
             ON CONFLICT (id) DO UPDATE SET
               name = EXCLUDED.name, match = EXCLUDED.match, overrides = EXCLUDED.overrides,
               active = EXCLUDED.active, revision = ${S}.category_template.revision + 1,
               updated_by = EXCLUDED.updated_by, updated_by_id = EXCLUDED.updated_by_id, updated_at = NOW()
             RETURNING *`,
            [
              id.data,
              next.name,
              JSON.stringify(next.match),
              JSON.stringify(next.overrides),
              next.active,
              user.email,
              user.id,
            ]
          );
          const before = current ? templateState(categoryTemplate(current)) : {};
          const revision = Number(saved.rows[0].revision);
          await recordChanges(
            client,
            S,
            'template',
            id.data,
            changes(before, templateState(next)),
            next.reason,
            user,
            revision
          );
          return saved.rows[0];
        });
        res.json(categoryTemplate(row));
      } catch (error) {
        if (error instanceof VersionConflict) {
          sendError(res, 409, 'TEMPLATE_VERSION_CONFLICT');
          return;
        }
        if (error instanceof TemplateExists) {
          sendError(res, 409, 'TEMPLATE_EXISTS');
          return;
        }
        console.error('Failed to save the category template', error);
        sendError(res, 500, 'TEMPLATE_SAVE_FAILED');
      }
    });
  });
}
