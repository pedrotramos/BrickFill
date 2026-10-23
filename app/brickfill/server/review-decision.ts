import type { Queryable } from './lakebase-lock';

export type ReviewStatus = 'PENDING' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED';

/** The enrichment result the app shows for a product: its latest run in the results schema. */
export interface CurrentRun {
  runId: string;
  createdAt: Date;
  /** False for a failed enrichment: the run left no generated content to approve. */
  hasContent: boolean;
}

/** A saved review decision or manual evidence, with the run it was made on (NULL before the app recorded it). */
export interface Decision {
  runId: string | null;
  at: Date | string | null;
}

export interface DecisionRequest {
  status: ReviewStatus;
  runId: string | null;
  basedOnEventId: string | null;
}

/**
 * The latest run of a product, or undefined before it has one (or before the first enrichment run creates the
 * results table). `created_at` is a UTC TIMESTAMP in Lakebase, read as an instant.
 */
export async function currentRun(client: Queryable, results: string, ean: string): Promise<CurrentRun | undefined> {
  const table = `${results}.product_enrichment`;
  const exists = await client.query('SELECT to_regclass($1) IS NOT NULL AS exists', [table]);
  if (exists.rows[0]?.exists !== true) return undefined;
  const result = await client.query(
    `SELECT run_id, created_at AT TIME ZONE 'UTC' AS created_at, result_json IS NOT NULL AS has_content
     FROM ${table} WHERE ean = $1`,
    [ean]
  );
  const row = result.rows[0];
  if (!row || typeof row.run_id !== 'string') return undefined;
  return { runId: row.run_id, createdAt: new Date(String(row.created_at)), hasContent: row.has_content === true };
}

/**
 * Whether a decision holds for the current result: a decision is made on one run, and a new run (the product was
 * enriched again) needs a new decision. Rows saved before the app recorded the run hold when they are not older than
 * the result. The queries (next_in_queue, product_list), the job's capacity (lakebase.decision_applies) and the
 * publication apply the same rule.
 */
export function decisionApplies(decision: Decision, current: CurrentRun | undefined): boolean {
  if (!current) return false;
  if (decision.runId !== null) return decision.runId === current.runId;
  if (decision.at === null) return false;
  return new Date(decision.at).getTime() >= current.createdAt.getTime();
}

/**
 * Why an approval or a rejection cannot be saved, as an error code (http-errors.ts), or undefined when it can.
 * The reviewer decides on what the page showed: the run (`runId`) and the last change of edits and evidence
 * (`basedOnEventId`, the latest audit event). Either one being outdated means someone changed the product meanwhile.
 */
export function decisionProblem(
  request: DecisionRequest,
  current: CurrentRun | undefined,
  lastEventId: string | null
): 'REVIEW_STALE' | 'NOTHING_TO_APPROVE' | undefined {
  if (request.status !== 'APPROVED' && request.status !== 'REJECTED') return undefined;
  if (request.runId !== (current?.runId ?? null) || request.basedOnEventId !== lastEventId) return 'REVIEW_STALE';
  if (request.status === 'APPROVED' && !current?.hasContent) return 'NOTHING_TO_APPROVE';
  return undefined;
}
