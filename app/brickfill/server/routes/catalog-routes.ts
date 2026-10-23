import type { Application, Request } from 'express';
import { z } from 'zod';
import { readAppSchema } from '../app-config';
import { ERROR_MESSAGES, isErrorCode, sendError } from '../http-errors';
import { reviewer } from '../identity';
import { type LockingPool, type Queryable, withLock } from '../lakebase-lock';
import { readResultsSchema } from '../lakebase-queries';
import {
  AttributeCode,
  MANUAL_EVIDENCE_VOLUME,
  MAX_SCREENSHOT_BYTES,
  ManualEvidenceBody,
  type ManualEvidenceInput,
  ProductEan,
  contentTypeOf,
  detectImage,
  manualScreenshotPath,
  parseManualScreenshotPath,
  sha256,
} from '../manual-evidence';
import { currentRun, decisionApplies, decisionProblem } from '../review-decision';

export interface VolumeHandle {
  upload(path: string, contents: Buffer, options?: { overwrite?: boolean }): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export interface ManualEvidenceStore {
  /** Absolute root of the manual evidence Volume; undefined disables screenshot uploads. */
  root?: string;
  volume(): VolumeHandle;
}

function isVolumeFactory(value: unknown): value is (volume: string) => unknown {
  return typeof value === 'function';
}

function isVolumeHandle(value: unknown): value is VolumeHandle {
  return Boolean(value) && typeof value === 'object' && value !== null && 'upload' in value && 'exists' in value;
}

/** The files plugin is registered with a dynamic name, so its accessor is narrowed at runtime. */
export function manualEvidenceStore(appkit: object, root: string | undefined): ManualEvidenceStore {
  const accessor = 'files' in appkit ? appkit.files : undefined;
  return {
    root,
    volume() {
      if (!isVolumeFactory(accessor)) throw new Error('Files plugin is not registered');
      const handle = accessor(MANUAL_EVIDENCE_VOLUME);
      if (!isVolumeHandle(handle)) throw new Error('Manual evidence Volume is not configured');
      return handle;
    },
  };
}

export type { LockingPool, PoolClient, Queryable } from '../lakebase-lock';
export { withLock } from '../lakebase-lock';
export { reviewer, type Reviewer } from '../identity';

interface AppKitWithLakebase {
  lakebase: Queryable & { pool: LockingPool };
  server: {
    extend(fn: (app: Application) => void): void;
  };
}

/** The enrichment run the page showed; null before the product has one. */
const RunId = z.string().max(100).nullable().optional().default(null);
const ReviewBody = z.object({
  status: z.enum(['PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED']),
  assignee: z.string().max(200).optional().default(''),
  notes: z.string().max(4000).optional().default(''),
  runId: RunId,
  /** Latest audit event the page showed (review-state lastEventId): a newer one means the product changed. */
  basedOnEventId: z
    .union([z.string().regex(/^\d{1,19}$/), z.number().int().nonnegative()])
    .nullable()
    .optional()
    .transform((value) => (value === null || value === undefined ? null : String(value))),
});
// Every human edit must carry its own evidence (AGENTS.md: no fact without evidence).
const AttributeOverrideBody = z.object({
  attributeCode: AttributeCode,
  attributeName: z.string().min(1).max(300),
  value: z.string().min(1).max(4000),
  reason: z.string().min(3).max(2000),
  evidence: ManualEvidenceBody,
});
const AttributeEvidenceBody = ManualEvidenceBody.and(
  z.object({ attributeName: z.string().min(1).max(300), runId: RunId })
);
const EvidenceId = z.coerce.number().int().positive();

/** Tables the app owns, created at startup in the app schema (LAKEBASE_APP_SCHEMA). */
const ddl = (S: string) => [
  `CREATE SCHEMA IF NOT EXISTS ${S}`,
  `CREATE TABLE IF NOT EXISTS ${S}.product_review (
    product_ean TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED')),
    assignee TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    updated_by TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS ${S}.attribute_override (
    id BIGSERIAL PRIMARY KEY,
    product_ean TEXT NOT NULL,
    attribute_code TEXT NOT NULL,
    attribute_name TEXT NOT NULL,
    value TEXT NOT NULL,
    reason TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS attribute_override_active_idx
    ON ${S}.attribute_override (product_ean, attribute_code, active, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS ${S}.audit_event (
    id BIGSERIAL PRIMARY KEY,
    product_ean TEXT NOT NULL,
    event_type TEXT NOT NULL,
    field_key TEXT,
    before_value TEXT,
    after_value TEXT,
    reason TEXT,
    actor TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS audit_event_product_idx
    ON ${S}.audit_event (product_ean, created_at DESC)`,
  // Manual evidence: linked to the human edit it supports, or to the AI value when override_id is NULL.
  `CREATE TABLE IF NOT EXISTS ${S}.attribute_evidence (
    id BIGSERIAL PRIMARY KEY,
    product_ean TEXT NOT NULL,
    attribute_code TEXT NOT NULL,
    attribute_name TEXT NOT NULL,
    override_id BIGINT REFERENCES ${S}.attribute_override (id),
    source_url TEXT,
    excerpt TEXT,
    note TEXT,
    screenshot_path TEXT,
    screenshot_sha256 TEXT,
    content_type TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    removed_by TEXT,
    removed_at TIMESTAMPTZ,
    CHECK (screenshot_path IS NOT NULL OR (source_url IS NOT NULL AND excerpt IS NOT NULL))
  )`,
  `CREATE INDEX IF NOT EXISTS attribute_evidence_active_idx
    ON ${S}.attribute_evidence (product_ean, attribute_code, active)`,
  // Stable identity of the actor (the Databricks user id), next to the e-mail kept in actor.
  `ALTER TABLE ${S}.audit_event ADD COLUMN IF NOT EXISTS actor_id TEXT`,
  // At most one active edit per product and attribute. Duplicates left by concurrent edits before this rule are
  // resolved first: the most recent edit stays active and the others are deactivated, with an audit event.
  `WITH ranked AS (
     SELECT id, ROW_NUMBER() OVER (
       PARTITION BY product_ean, attribute_code ORDER BY created_at DESC, id DESC
     ) AS position
     FROM ${S}.attribute_override WHERE active = TRUE
   ), superseded AS (
     UPDATE ${S}.attribute_override o SET active = FALSE
     FROM ranked r WHERE o.id = r.id AND r.position > 1
     RETURNING o.product_ean, o.attribute_code, o.value
   )
   INSERT INTO ${S}.audit_event
     (product_ean, event_type, field_key, before_value, after_value, reason, actor, actor_id)
   SELECT product_ean, 'ATTRIBUTE_OVERRIDE_SUPERSEDED', 'attribute.' || attribute_code, value, NULL,
          'Concurrent edit deactivated: the most recent edit wins.', 'system', 'system'
   FROM superseded`,
  `CREATE UNIQUE INDEX IF NOT EXISTS attribute_override_one_active_idx
    ON ${S}.attribute_override (product_ean, attribute_code) WHERE active`,
  // The enrichment run a decision was made on, and the run of the AI value a manual evidence supports (NULL on an
  // edit's evidence and on rows saved before this column): a new run needs a new decision and new evidence.
  `ALTER TABLE ${S}.product_review ADD COLUMN IF NOT EXISTS run_id TEXT`,
  `ALTER TABLE ${S}.attribute_evidence ADD COLUMN IF NOT EXISTS run_id TEXT`,
];

/** Columns of an evidence row, in the order of the positional parameters used by the INSERTs below. */
function evidenceParams(
  evidence: ManualEvidenceInput,
  screenshot: { sha256: string; contentType: string } | undefined
) {
  return [
    evidence.sourceUrl ?? null,
    evidence.excerpt ?? null,
    evidence.note ?? null,
    evidence.screenshotPath ?? null,
    screenshot?.sha256 ?? null,
    screenshot?.contentType ?? null,
  ];
}

async function readBody(req: Request, limit: number): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += part.length;
    if (total > limit) return undefined;
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}

/**
 * Every write of a product (decision, edits, evidence) runs under the product's lock, so an edit and an approval never
 * interleave: an edit reopens the approval in its own transaction, and an approval sees every edit committed before.
 */
const productKey = (schema: string, ean: string) => `${schema}.review:${ean}`;

/** An approval covers the content the reviewer saw: changing an edit or an evidence reopens it. */
async function reopenApproval(client: Queryable, S: string, ean: string, user: { email: string; id: string }) {
  await client.query(
    `WITH reopened AS (
       UPDATE ${S}.product_review SET status = 'IN_REVIEW', updated_by = $2, updated_at = NOW()
       WHERE product_ean = $1 AND status = 'APPROVED'
       RETURNING product_ean
     )
     INSERT INTO ${S}.audit_event
       (product_ean, event_type, field_key, before_value, after_value, reason, actor, actor_id)
     SELECT product_ean, 'REVIEW_REOPENED', 'review.status', 'APPROVED', 'IN_REVIEW',
            'Content changed after the approval.', $2, $3
     FROM reopened`,
    [ean, user.email, user.id]
  );
}

const lastEventQuery = (S: string) =>
  `SELECT MAX(id)::text AS last_event_id FROM ${S}.audit_event WHERE product_ean = $1`;
const lastEventOf = (rows: Record<string, unknown>[]) => {
  const value = rows[0]?.last_event_id;
  return typeof value === 'string' ? value : null;
};

/** Unique violation: another active edit of the same attribute exists (only possible outside withLock). */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

export async function setupCatalogRoutes(appkit: AppKitWithLakebase, manualEvidence: ManualEvidenceStore) {
  const { name: schemaName, sql: S } = readAppSchema();
  const results = readResultsSchema();
  const manualEvidenceRoot = manualEvidence.root;
  /** The screenshot must have been stored by this server for the same product/attribute and still exist. */
  async function verifiedScreenshot(evidence: ManualEvidenceInput, ean: string, attributeCode: string) {
    if (!evidence.screenshotPath) return { ok: true as const, screenshot: undefined };
    const parsed = parseManualScreenshotPath(manualEvidenceRoot, evidence.screenshotPath, ean, attributeCode);
    if (!parsed) return { ok: false as const };
    const exists = await manualEvidence.volume().exists(evidence.screenshotPath);
    return exists ? { ok: true as const, screenshot: parsed } : { ok: false as const };
  }

  /** Attribute codes are free-form in the contract, so only those of the product's latest result are accepted. */
  async function productHasAttribute(ean: string, attributeCode: string): Promise<boolean> {
    const table = `${results}.product_attribute`;
    const exists = await appkit.lakebase.query('SELECT to_regclass($1) IS NOT NULL AS exists', [table]);
    if (exists.rows[0]?.exists !== true) return false;
    const found = await appkit.lakebase.query(
      `SELECT 1 FROM ${table} a
       JOIN ${results}.product_enrichment e ON e.ean = a.ean AND e.run_id = a.run_id
       WHERE a.ean = $1 AND a.attribute_code = $2 LIMIT 1`,
      [ean, attributeCode]
    );
    return found.rows.length > 0;
  }

  if (process.env.NODE_ENV !== 'development') {
    for (const statement of ddl(S)) {
      await appkit.lakebase.query(statement);
    }
  }

  appkit.server.extend((app) => {
    app.get('/api/products/:ean/review-state', async (req, res) => {
      const ean = ProductEan.safeParse(req.params.ean);
      if (!ean.success) {
        sendError(res, 400, 'INVALID_EAN');
        return;
      }
      try {
        const current = await currentRun(appkit.lakebase, results, ean.data);
        const [review, overrides, events, evidence, lastEvent] = await Promise.all([
          appkit.lakebase.query(
            `SELECT product_ean, status, assignee, notes, updated_by, updated_at, run_id
             FROM ${S}.product_review WHERE product_ean = $1`,
            [ean.data]
          ),
          appkit.lakebase.query(
            `SELECT id, attribute_code, attribute_name, value, reason, created_by, created_at
             FROM ${S}.attribute_override
             WHERE product_ean = $1 AND active = TRUE ORDER BY created_at DESC`,
            [ean.data]
          ),
          appkit.lakebase.query(
            `SELECT id, event_type, field_key, before_value, after_value, reason, actor, created_at
             FROM ${S}.audit_event WHERE product_ean = $1 ORDER BY created_at DESC, id DESC LIMIT 100`,
            [ean.data]
          ),
          // Evidence of the current value of each attribute: the active edit's, or the AI value's when not edited
          // (only the evidence attached on the current run: a new run may have changed the value).
          appkit.lakebase.query(
            `SELECT e.id, e.attribute_code, e.attribute_name, e.override_id, e.source_url, e.excerpt, e.note,
                    e.screenshot_path, e.created_by, e.created_at
             FROM ${S}.attribute_evidence e
             LEFT JOIN ${S}.attribute_override o
               ON o.product_ean = e.product_ean AND o.attribute_code = e.attribute_code AND o.active = TRUE
             WHERE e.product_ean = $1 AND e.active = TRUE
               AND e.override_id IS NOT DISTINCT FROM o.id
               AND (e.override_id IS NOT NULL OR e.run_id = $2::text
                    OR (e.run_id IS NULL AND e.created_at >= $3::timestamptz))
             ORDER BY e.created_at DESC`,
            [ean.data, current?.runId ?? null, current?.createdAt ?? null]
          ),
          appkit.lakebase.query(lastEventQuery(S), [ean.data]),
        ]);
        const row = review.rows[0];
        const runId = typeof row?.run_id === 'string' ? row.run_id : null;
        const at = row?.updated_at instanceof Date || typeof row?.updated_at === 'string' ? row.updated_at : null;
        res.json({
          // applies: the decision was made on the result shown now (a re-enriched product needs a new one)
          review: row ? { ...row, applies: decisionApplies({ runId, at }, current) } : null,
          overrides: overrides.rows,
          events: events.rows,
          evidence: evidence.rows,
          currentRunId: current?.runId ?? null,
          lastEventId: lastEventOf(lastEvent.rows),
        });
      } catch (error) {
        console.error('Failed to load review state', error);
        sendError(res, 500, 'REVIEW_LOAD_FAILED');
      }
    });

    app.put('/api/products/:ean/review', async (req, res) => {
      const ean = ProductEan.safeParse(req.params.ean);
      const body = ReviewBody.safeParse(req.body);
      if (!ean.success || !body.success) {
        sendError(res, 400, 'INVALID_REVIEW');
        return;
      }
      const user = reviewer(req);
      if (!user) {
        sendError(res, 401, 'UNIDENTIFIED_USER');
        return;
      }
      try {
        const saved = await withLock(appkit.lakebase.pool, productKey(schemaName, ean.data), async (client) => {
          // A decision holds for the run and the edits the reviewer saw; checked under the product's lock.
          const run = await currentRun(client, results, ean.data);
          const lastEvent = await client.query(lastEventQuery(S), [ean.data]);
          const problem = decisionProblem(body.data, run, lastEventOf(lastEvent.rows));
          if (problem) return { problem };
          const current = await client.query(`SELECT status FROM ${S}.product_review WHERE product_ean = $1`, [
            ean.data,
          ]);
          const previousValue = current.rows[0]?.status;
          const previous = typeof previousValue === 'string' ? previousValue : null;
          const result = await client.query(
            `INSERT INTO ${S}.product_review
               (product_ean, status, assignee, notes, updated_by, updated_at, run_id)
             VALUES ($1, $2, $3, $4, $5, NOW(), $6)
             ON CONFLICT (product_ean) DO UPDATE SET
               status = EXCLUDED.status, assignee = EXCLUDED.assignee, notes = EXCLUDED.notes,
               updated_by = EXCLUDED.updated_by, updated_at = NOW(), run_id = EXCLUDED.run_id
             RETURNING product_ean, status, assignee, notes, updated_by, updated_at, run_id`,
            [ean.data, body.data.status, body.data.assignee, body.data.notes, user.email, run?.runId ?? null]
          );
          await client.query(
            `INSERT INTO ${S}.audit_event
               (product_ean, event_type, field_key, before_value, after_value, reason, actor, actor_id)
             VALUES ($1, 'REVIEW_UPDATED', 'review.status', $2, $3, $4, $5, $6)`,
            [ean.data, previous, body.data.status, body.data.notes, user.email, user.id]
          );
          return { row: result.rows[0] };
        });
        if (saved.problem) {
          sendError(res, 409, saved.problem);
          return;
        }
        res.json(saved.row);
      } catch (error) {
        console.error('Failed to update review', error);
        sendError(res, 500, 'REVIEW_SAVE_FAILED');
      }
    });

    app.post('/api/products/:ean/attribute-overrides', async (req, res) => {
      const ean = ProductEan.safeParse(req.params.ean);
      const body = AttributeOverrideBody.safeParse(req.body);
      if (!ean.success || !body.success) {
        sendError(res, 400, 'INVALID_ATTRIBUTE_OVERRIDE');
        return;
      }
      const user = reviewer(req);
      if (!user) {
        sendError(res, 401, 'UNIDENTIFIED_USER');
        return;
      }
      try {
        if (!(await productHasAttribute(ean.data, body.data.attributeCode))) {
          sendError(res, 400, 'INVALID_PRODUCT_OR_ATTRIBUTE');
          return;
        }
        const screenshot = await verifiedScreenshot(body.data.evidence, ean.data, body.data.attributeCode);
        if (!screenshot.ok) {
          sendError(res, 400, 'INVALID_SCREENSHOT');
          return;
        }
        // The edit replaces the active one, with its evidence and audit event, in one transaction under the
        // product's lock, and reopens an approval. Deactivating comes first, in its own statement: the sub-statements
        // of one WITH run in no guaranteed order, and the unique index allows a single active edit at any moment.
        const result = await withLock(appkit.lakebase.pool, productKey(schemaName, ean.data), async (client) => {
          const previous = await client.query(
            `UPDATE ${S}.attribute_override SET active = FALSE
             WHERE product_ean = $1 AND attribute_code = $2 AND active = TRUE
             RETURNING value`,
            [ean.data, body.data.attributeCode]
          );
          const saved = await client.query(
            `WITH inserted AS (
               INSERT INTO ${S}.attribute_override
                 (product_ean, attribute_code, attribute_name, value, reason, active, created_by)
               VALUES ($1, $2, $3, $4, $5, TRUE, $6)
               RETURNING id, attribute_code, attribute_name, value, reason, created_by, created_at
             ), evidence AS (
               INSERT INTO ${S}.attribute_evidence
                 (product_ean, attribute_code, attribute_name, override_id, source_url, excerpt, note,
                  screenshot_path, screenshot_sha256, content_type, created_by)
               SELECT $1, $2, $3, id, $7::text, $8::text, $9::text, $10::text, $11::text, $12::text, $6
               FROM inserted
               RETURNING id
             ), audit AS (
               INSERT INTO ${S}.audit_event
                 (product_ean, event_type, field_key, before_value, after_value, reason, actor, actor_id)
               VALUES ($1, 'ATTRIBUTE_OVERRIDDEN', 'attribute.' || $2::text, $14::text, $4, $5, $6, $13)
             )
             SELECT inserted.*, (SELECT id FROM evidence) AS evidence_id FROM inserted`,
            [
              ean.data,
              body.data.attributeCode,
              body.data.attributeName,
              body.data.value,
              body.data.reason,
              user.email,
              ...evidenceParams(body.data.evidence, screenshot.screenshot),
              user.id,
              previous.rows[0]?.value ?? null,
            ]
          );
          await reopenApproval(client, S, ean.data, user);
          return saved;
        });
        res.status(201).json(result.rows[0]);
      } catch (error) {
        if (isUniqueViolation(error)) {
          sendError(res, 409, 'OVERRIDE_CONFLICT');
          return;
        }
        console.error('Failed to create attribute override', error);
        sendError(res, 500, 'OVERRIDE_SAVE_FAILED');
      }
    });

    app.delete('/api/products/:ean/attribute-overrides/:attributeCode', async (req, res) => {
      const ean = ProductEan.safeParse(req.params.ean);
      const attributeCode = AttributeCode.safeParse(req.params.attributeCode);
      if (!ean.success || !attributeCode.success) {
        sendError(res, 400, 'INVALID_ATTRIBUTE');
        return;
      }
      const user = reviewer(req);
      if (!user) {
        sendError(res, 401, 'UNIDENTIFIED_USER');
        return;
      }
      try {
        const result = await withLock(appkit.lakebase.pool, productKey(schemaName, ean.data), async (client) => {
          const removed = await client.query(
            `WITH removed AS (
               UPDATE ${S}.attribute_override
               SET active = FALSE
               WHERE product_ean = $1 AND attribute_code = $2 AND active = TRUE
               RETURNING value
             ), audit AS (
               INSERT INTO ${S}.audit_event
                 (product_ean, event_type, field_key, before_value, after_value, reason, actor, actor_id)
               SELECT $1, 'ATTRIBUTE_OVERRIDE_REMOVED', $3, value, NULL, $4, $5, $6
               FROM removed
             )
             SELECT value AS removed_value FROM removed`,
            [
              ean.data,
              attributeCode.data,
              `attribute.${attributeCode.data}`,
              'Edit removed by the user; original AI value restored.',
              user.email,
              user.id,
            ]
          );
          if (removed.rows.length) await reopenApproval(client, S, ean.data, user);
          return removed;
        });
        if (!result.rows.length) {
          sendError(res, 404, 'NO_ACTIVE_OVERRIDE');
          return;
        }
        res.status(204).send();
      } catch (error) {
        console.error('Failed to remove attribute override', error);
        sendError(res, 500, 'OVERRIDE_RESTORE_FAILED');
      }
    });

    // Step 1 of attaching a screenshot: the raw image is validated by its bytes and stored at a server-generated,
    // content-addressed path. The returned path is then referenced by an evidence or an edit.
    app.post('/api/products/:ean/attributes/:attributeCode/evidence-files', async (req, res) => {
      const ean = ProductEan.safeParse(req.params.ean);
      const attributeCode = AttributeCode.safeParse(req.params.attributeCode);
      if (!ean.success || !attributeCode.success || !manualEvidenceRoot) {
        sendError(res, 400, 'INVALID_PRODUCT_OR_ATTRIBUTE');
        return;
      }
      if (!reviewer(req)) {
        sendError(res, 401, 'UNIDENTIFIED_USER');
        return;
      }
      try {
        if (!(await productHasAttribute(ean.data, attributeCode.data))) {
          sendError(res, 400, 'INVALID_PRODUCT_OR_ATTRIBUTE');
          return;
        }
        const content = await readBody(req, MAX_SCREENSHOT_BYTES);
        if (!content) {
          sendError(res, 413, 'SCREENSHOT_TOO_LARGE');
          return;
        }
        const extension = detectImage(content);
        if (!extension) {
          sendError(res, 415, 'UNSUPPORTED_IMAGE_TYPE');
          return;
        }
        const digest = sha256(content);
        const path = manualScreenshotPath(manualEvidenceRoot, ean.data, attributeCode.data, digest, extension);
        const volume = manualEvidence.volume();
        if (!(await volume.exists(path))) await volume.upload(path, content, { overwrite: false });
        res.status(201).json({ path, sha256: digest, contentType: contentTypeOf(extension) });
      } catch (error) {
        console.error('Failed to store manual evidence screenshot', error);
        sendError(res, 500, 'SCREENSHOT_SAVE_FAILED');
      }
    });

    // Attach manual evidence to the current value of an attribute (the active edit, or the AI value).
    app.post('/api/products/:ean/attributes/:attributeCode/evidence', async (req, res) => {
      const ean = ProductEan.safeParse(req.params.ean);
      const attributeCode = AttributeCode.safeParse(req.params.attributeCode);
      const body = AttributeEvidenceBody.safeParse(req.body);
      if (!ean.success || !attributeCode.success || !body.success) {
        if (body.success) {
          sendError(res, 400, 'INVALID_PRODUCT_OR_ATTRIBUTE');
          return;
        }
        // The evidence refinements carry an error code as their message (manual-evidence.ts).
        const issue = body.error.issues[0]?.message;
        if (isErrorCode(issue)) sendError(res, 400, issue);
        else sendError(res, 400, 'INVALID_EVIDENCE', issue ?? ERROR_MESSAGES.INVALID_EVIDENCE);
        return;
      }
      const user = reviewer(req);
      if (!user) {
        sendError(res, 401, 'UNIDENTIFIED_USER');
        return;
      }
      try {
        if (!(await productHasAttribute(ean.data, attributeCode.data))) {
          sendError(res, 400, 'INVALID_PRODUCT_OR_ATTRIBUTE');
          return;
        }
        const screenshot = await verifiedScreenshot(body.data, ean.data, attributeCode.data);
        if (!screenshot.ok) {
          sendError(res, 400, 'INVALID_SCREENSHOT');
          return;
        }
        // Under the product's lock, so the evidence is linked to the edit that is active when it is saved, or to the
        // AI value of the run the reviewer saw; it reopens an approval.
        const result = await withLock(appkit.lakebase.pool, productKey(schemaName, ean.data), async (client) => {
          const active = await client.query(
            `SELECT id FROM ${S}.attribute_override
             WHERE product_ean = $1 AND attribute_code = $2 AND active = TRUE
             ORDER BY created_at DESC LIMIT 1`,
            [ean.data, attributeCode.data]
          );
          const overrideId = active.rows[0]?.id ?? null;
          const run = overrideId === null ? await currentRun(client, results, ean.data) : undefined;
          // evidence of the AI value supports the value of the run the page showed
          if (overrideId === null && body.data.runId !== (run?.runId ?? null)) {
            return { problem: 'REVIEW_STALE' as const };
          }
          const inserted = await client.query(
            `WITH inserted AS (
             INSERT INTO ${S}.attribute_evidence
               (product_ean, attribute_code, attribute_name, override_id, source_url, excerpt, note,
                screenshot_path, screenshot_sha256, content_type, created_by, run_id)
             VALUES ($1, $2, $3, $12::bigint, $5::text, $6::text, $7::text, $8::text, $9::text, $10::text, $4,
                     $13::text)
             RETURNING id, attribute_code, attribute_name, override_id, source_url, excerpt, note, screenshot_path,
                       created_by, created_at
           ), audit AS (
             INSERT INTO ${S}.audit_event
               (product_ean, event_type, field_key, before_value, after_value, reason, actor, actor_id)
             SELECT $1, 'EVIDENCE_ADDED', 'attribute.' || $2::text, NULL,
                    COALESCE(screenshot_path, source_url), note, $4, $11
             FROM inserted
           )
           SELECT * FROM inserted`,
            [
              ean.data,
              attributeCode.data,
              body.data.attributeName,
              user.email,
              ...evidenceParams(body.data, screenshot.screenshot),
              user.id,
              overrideId,
              run?.runId ?? null,
            ]
          );
          await reopenApproval(client, S, ean.data, user);
          return { row: inserted.rows[0] };
        });
        if (result.problem) {
          sendError(res, 409, result.problem);
          return;
        }
        res.status(201).json(result.row);
      } catch (error) {
        console.error('Failed to add manual evidence', error);
        sendError(res, 500, 'EVIDENCE_SAVE_FAILED');
      }
    });

    // Remove (deactivate) manual evidence; the file and the row stay for the audit trail.
    app.delete('/api/products/:ean/attributes/:attributeCode/evidence/:evidenceId', async (req, res) => {
      const ean = ProductEan.safeParse(req.params.ean);
      const attributeCode = AttributeCode.safeParse(req.params.attributeCode);
      const evidenceId = EvidenceId.safeParse(req.params.evidenceId);
      if (!ean.success || !attributeCode.success || !evidenceId.success) {
        sendError(res, 400, 'INVALID_EVIDENCE');
        return;
      }
      const user = reviewer(req);
      if (!user) {
        sendError(res, 401, 'UNIDENTIFIED_USER');
        return;
      }
      try {
        // Under the product's lock: two removals at the same time cannot leave an edit without evidence.
        const result = await withLock(appkit.lakebase.pool, productKey(schemaName, ean.data), async (client) => {
          const removal = await client.query(
            `WITH target AS (
             SELECT e.id, e.override_id, COALESCE(e.screenshot_path, e.source_url) AS reference,
                    (o.id IS NOT NULL AND (
                       SELECT COUNT(*) FROM ${S}.attribute_evidence s
                       WHERE s.override_id = o.id AND s.active = TRUE
                     ) <= 1) AS last_of_edit
             FROM ${S}.attribute_evidence e
             LEFT JOIN ${S}.attribute_override o ON o.id = e.override_id AND o.active = TRUE
             WHERE e.id = $3 AND e.product_ean = $1 AND e.attribute_code = $2 AND e.active = TRUE
           ), removed AS (
             UPDATE ${S}.attribute_evidence e
             SET active = FALSE, removed_by = $4, removed_at = NOW()
             FROM target
             WHERE e.id = target.id AND NOT target.last_of_edit
             RETURNING e.id
           ), audit AS (
             INSERT INTO ${S}.audit_event
               (product_ean, event_type, field_key, before_value, after_value, reason, actor, actor_id)
             SELECT $1, 'EVIDENCE_REMOVED', 'attribute.' || $2::text, target.reference, NULL,
                    'Evidence removed by the user.', $4, $5
             FROM target JOIN removed ON removed.id = target.id
           )
           SELECT target.last_of_edit, (SELECT COUNT(*) FROM removed) AS removed FROM target`,
            [ean.data, attributeCode.data, evidenceId.data, user.email, user.id]
          );
          if (Number(removal.rows[0]?.removed ?? 0) > 0) await reopenApproval(client, S, ean.data, user);
          return removal;
        });
        const row = result.rows[0];
        if (!row) {
          sendError(res, 404, 'EVIDENCE_NOT_FOUND');
          return;
        }
        if (row.last_of_edit === true) {
          sendError(res, 409, 'LAST_EVIDENCE');
          return;
        }
        res.status(204).send();
      } catch (error) {
        console.error('Failed to remove manual evidence', error);
        sendError(res, 500, 'EVIDENCE_REMOVE_FAILED');
      }
    });
  });
}
