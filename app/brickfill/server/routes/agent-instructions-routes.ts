import type { Application, Request, Response } from 'express';
import { z } from 'zod';
import { readAppSchema, readInstructionEditors } from '../app-config';
import { sendError } from '../http-errors';
import { reviewer, type Reviewer } from '../identity';
import { type LockingPool, type Queryable, withLock } from '../lakebase-lock';
import { NotFound, type Row, text, timestamp, VersionConflict } from '../settings-events';

interface AppKitWithLakebase {
  lakebase: Queryable & { pool: LockingPool };
  server: {
    extend(fn: (app: Application) => void): void;
  };
}

/** Longest additional instructions the agent receives (characters). */
export const MAX_INSTRUCTIONS_LENGTH = 4000;

/**
 * The catalog team's additional instructions to the agent (style and emphasis), versioned: every save and every
 * restore creates a new version, and exactly one version is active. The enrichment job reads the active one at the
 * start of each batch and places it after the fixed rules of the prompt, which it cannot change; each result records
 * the version it was generated with (product_enrichment.instructions_version).
 */
const ddl = (S: string) => [
  `CREATE TABLE IF NOT EXISTS ${S}.agent_instruction_version (
    version SERIAL PRIMARY KEY,
    body TEXT NOT NULL CHECK (char_length(body) <= ${MAX_INSTRUCTIONS_LENGTH}),
    active BOOLEAN NOT NULL DEFAULT FALSE,
    restored_from INT,
    reason TEXT,
    created_by TEXT NOT NULL,
    created_by_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS agent_instruction_version_active_idx
     ON ${S}.agent_instruction_version (active) WHERE active`,
];

export const InstructionsBody = z.object({
  body: z.string().max(MAX_INSTRUCTIONS_LENGTH),
  /** Version the client read as active; 0 when none existed. */
  expectedVersion: z.number().int().min(0),
  reason: z.string().trim().max(2000).optional(),
});
const RestoreBody = InstructionsBody.omit({ body: true });

function instructionVersion(row: Row) {
  return {
    version: Number(row.version),
    body: text(row.body) ?? '',
    active: row.active === true,
    restoredFrom: row.restored_from === null || row.restored_from === undefined ? null : Number(row.restored_from),
    reason: text(row.reason),
    createdBy: text(row.created_by) ?? '',
    createdAt: timestamp(row.created_at),
  };
}

export async function setupAgentInstructionsRoutes(appkit: AppKitWithLakebase) {
  const { name: schemaName, sql: S } = readAppSchema();
  const editors = readInstructionEditors();
  const canEdit = (user: Reviewer | undefined) => user !== undefined && editors.has(user.email.toLowerCase());
  const lockKey = `${schemaName}.agent_instructions`;

  if (process.env.NODE_ENV !== 'development') {
    for (const statement of ddl(S)) await appkit.lakebase.query(statement);
  }

  /** Replace the active version by a new one with `body`; `expectedVersion` guards against concurrent saves. */
  async function saveVersion(
    client: Queryable,
    user: Reviewer,
    body: string,
    expectedVersion: number,
    reason: string | undefined,
    restoredFrom: number | null
  ) {
    const active = (await client.query(`SELECT version FROM ${S}.agent_instruction_version WHERE active FOR UPDATE`))
      .rows[0];
    if (Number(active?.version ?? 0) !== expectedVersion) throw new VersionConflict();
    await client.query(`UPDATE ${S}.agent_instruction_version SET active = FALSE WHERE active`);
    const saved = await client.query(
      `INSERT INTO ${S}.agent_instruction_version (body, active, restored_from, reason, created_by, created_by_id)
       VALUES ($1, TRUE, $2, $3, $4, $5) RETURNING *`,
      [body.trim(), restoredFrom, reason || null, user.email, user.id]
    );
    return saved.rows[0];
  }

  const guard = (req: Request, res: Response) => {
    const user = reviewer(req);
    if (!user) {
      sendError(res, 401, 'UNIDENTIFIED_USER');
      return undefined;
    }
    if (!canEdit(user)) {
      sendError(res, 403, 'INSTRUCTIONS_FORBIDDEN');
      return undefined;
    }
    return user;
  };

  const failed = (res: Response, error: unknown) => {
    if (error instanceof VersionConflict) return sendError(res, 409, 'INSTRUCTIONS_VERSION_CONFLICT');
    if (error instanceof NotFound) return sendError(res, 404, 'NOT_FOUND');
    console.error('Failed to save the agent instructions', error);
    return sendError(res, 500, 'INSTRUCTIONS_SAVE_FAILED');
  };

  appkit.server.extend((app) => {
    app.get('/api/agent-instructions', async (req, res) => {
      try {
        const versions = await appkit.lakebase.query(
          `SELECT * FROM ${S}.agent_instruction_version ORDER BY version DESC LIMIT 50`
        );
        const rows = versions.rows.map(instructionVersion);
        res.json({
          active: rows.find((item) => item.active) ?? null,
          versions: rows,
          canEdit: canEdit(reviewer(req)),
          editorsConfigured: editors.size > 0,
          maxLength: MAX_INSTRUCTIONS_LENGTH,
        });
      } catch (error) {
        console.error('Failed to load the agent instructions', error);
        sendError(res, 500, 'INSTRUCTIONS_LOAD_FAILED');
      }
    });

    app.put('/api/agent-instructions', async (req, res) => {
      const user = guard(req, res);
      if (!user) return;
      const body = InstructionsBody.safeParse(req.body);
      if (!body.success) {
        sendError(res, 400, 'INVALID_INSTRUCTIONS', body.error.issues[0]?.message);
        return;
      }
      try {
        const row = await withLock(appkit.lakebase.pool, lockKey, (client) =>
          saveVersion(client, user, body.data.body, body.data.expectedVersion, body.data.reason, null)
        );
        res.json(instructionVersion(row));
      } catch (error) {
        failed(res, error);
      }
    });

    app.post('/api/agent-instructions/:version/restore', async (req, res) => {
      const user = guard(req, res);
      if (!user) return;
      const version = z.coerce.number().int().min(1).safeParse(req.params.version);
      const body = RestoreBody.safeParse(req.body);
      if (!version.success || !body.success) {
        sendError(res, 400, 'INVALID_INSTRUCTIONS');
        return;
      }
      try {
        const row = await withLock(appkit.lakebase.pool, lockKey, async (client) => {
          const source = (
            await client.query(`SELECT body FROM ${S}.agent_instruction_version WHERE version = $1`, [version.data])
          ).rows[0];
          if (!source) throw new NotFound();
          // restoring never rewrites history: the old text becomes a new version
          return saveVersion(
            client,
            user,
            text(source.body) ?? '',
            body.data.expectedVersion,
            body.data.reason,
            version.data
          );
        });
        res.json(instructionVersion(row));
      } catch (error) {
        failed(res, error);
      }
    });
  });
}
