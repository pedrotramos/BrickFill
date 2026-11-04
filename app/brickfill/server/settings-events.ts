import type { Reviewer } from './identity';
import type { Queryable } from './lakebase-lock';

/**
 * Field-level history shared by the editing screens (Settings, Category templates, Attributes): every saved change
 * writes one settings_event row per field, with the value before and after, the author, the reason and, for
 * versioned records, the revision the change produced.
 */

export type Row = Record<string, unknown>;
export type JsonObject = Record<string, unknown>;

export const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
export const timestamp = (value: unknown): string | null =>
  value instanceof Date ? value.toISOString() : typeof value === 'string' ? value : null;
export const objectValue = (value: unknown): JsonObject =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {};
export const json = (value: unknown) => (value === null || value === undefined ? null : JSON.stringify(value));

/** Fields kept as nested objects in a record (overrides, match), compared key by key as "<field>.<key>". */
const NESTED = ['overrides', 'match'];

export interface FieldChange {
  key: string;
  before: unknown;
  after: unknown;
}

/** Field-level changes between two flat states; nested objects are compared key by key. */
export function changes(before: JsonObject, after: JsonObject): FieldChange[] {
  const flatten = (state: JsonObject) => {
    const flat: JsonObject = {};
    for (const [field, value] of Object.entries(state)) {
      if (NESTED.includes(field)) {
        for (const [key, item] of Object.entries(objectValue(value))) flat[`${field}.${key}`] = item;
      } else {
        flat[field] = value;
      }
    }
    return flat;
  };
  const left = flatten(before);
  const right = flatten(after);
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  return keys
    .filter((key) => JSON.stringify(left[key] ?? null) !== JSON.stringify(right[key] ?? null))
    .map((key) => ({ key, before: left[key] ?? null, after: right[key] ?? null }));
}

export async function recordChanges(
  client: Queryable,
  S: string,
  scope: string,
  scopeId: string,
  diff: FieldChange[],
  reason: string | undefined,
  user: Reviewer,
  revision: number | null = null
) {
  for (const change of diff) {
    await client.query(
      `INSERT INTO ${S}.settings_event
         (scope, scope_id, field_key, before_value, after_value, reason, actor, actor_id, revision)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9)`,
      [
        scope,
        scopeId,
        change.key,
        json(change.before),
        json(change.after),
        reason || null,
        user.email,
        user.id,
        revision,
      ]
    );
  }
}

export function settingsEvent(row: Row) {
  return {
    id: Number(row.id),
    scope: text(row.scope) ?? '',
    scopeId: text(row.scope_id) ?? '',
    fieldKey: text(row.field_key) ?? '',
    before: row.before_value ?? null,
    after: row.after_value ?? null,
    reason: text(row.reason),
    actor: text(row.actor) ?? '',
    revision: row.revision === null || row.revision === undefined ? null : Number(row.revision),
    createdAt: timestamp(row.created_at),
  };
}

/** The record changed since the client read it: the client reloads and tries again (HTTP 409). */
export class VersionConflict extends Error {}
export class NotFound extends Error {}
