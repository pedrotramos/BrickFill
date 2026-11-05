import type { SettingsEvent } from './settings';

/** One save: the field-level events a single change wrote (same record, author and revision). */
export interface ChangeGroup {
  id: string;
  scope: string;
  scopeId: string;
  actor: string;
  createdAt: string | null;
  revision: number | null;
  reason: string | null;
  events: SettingsEvent[];
}

const minute = (value: string | null) => (value ? value.slice(0, 16) : '');

/**
 * Groups the newest-first events into saves. Versioned records (templates, attribute requirements) group by revision;
 * the others by author and minute, which is how one Save writes them.
 */
export function groupEvents(events: readonly SettingsEvent[]): ChangeGroup[] {
  const groups: ChangeGroup[] = [];
  for (const event of events) {
    const revision = event.revision ?? null;
    const last = groups[groups.length - 1];
    const same =
      last &&
      last.scope === event.scope &&
      last.scopeId === event.scopeId &&
      last.actor === event.actor &&
      (revision !== null ? last.revision === revision : minute(last.createdAt) === minute(event.createdAt));
    if (same) {
      last.events.push(event);
      last.reason ??= event.reason;
    } else {
      groups.push({
        id: `${event.scope}:${event.scopeId}:${event.id}`,
        scope: event.scope,
        scopeId: event.scopeId,
        actor: event.actor,
        createdAt: event.createdAt,
        revision,
        reason: event.reason,
        events: [event],
      });
    }
  }
  return groups;
}

export type ListDiff = { value: string; change: 'added' | 'removed' | 'kept' }[];

const asList = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((item) => typeof item === 'string') ? (value as string[]) : null;

/** Item-level difference of two lists of text (null when either side is not a list of text). */
export function listDiff(before: unknown, after: unknown): ListDiff | null {
  const left = before === null || before === undefined ? [] : asList(before);
  const right = after === null || after === undefined ? [] : asList(after);
  if (!left || !right) return null;
  return [
    ...right.map((value) => ({ value, change: left.includes(value) ? ('kept' as const) : ('added' as const) })),
    ...left.filter((value) => !right.includes(value)).map((value) => ({ value, change: 'removed' as const })),
  ];
}

export const isEmpty = (value: unknown) =>
  value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length);

/** JSON with sorted keys, so the same value stored by Postgres (jsonb) and sent by the app compares equal. */
const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : item
  );

/** Whether an event changed anything (older rows recorded empty fields and key-order differences). */
export const isRealChange = (before: unknown, after: unknown) =>
  !(isEmpty(before) && isEmpty(after)) && stable(before ?? null) !== stable(after ?? null);
