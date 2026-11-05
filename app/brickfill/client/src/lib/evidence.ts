export function evidenceFileUrl(path: string): string {
  return `/api/files/evidence/raw?${new URLSearchParams({ path })}`;
}

/** Host of a source URL for display ("example.com"), or null when the stored URL does not parse. */
export function hostname(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * How well a value is backed, for the attribute list: a crop shows it on its source page (`captured`), a source
 * without a usable crop needs a look (`check`), sources without visual capture back it by text (`text`), a value
 * without any source is unsupported (`missing`), and an empty value has nothing to back (`none`).
 */
export type EvidenceState = 'captured' | 'check' | 'text' | 'missing' | 'none';

export function evidenceState({
  hasValue,
  references,
  manualCount,
  captureExpected,
}: {
  hasValue: boolean;
  references: readonly { capture_status?: string | null }[];
  manualCount: number;
  captureExpected: boolean;
}): EvidenceState {
  if (!hasValue) return 'none';
  if (references.some((item) => item.capture_status === 'COMPLETE') || manualCount > 0) return 'captured';
  if (!references.length) return 'missing';
  return captureExpected || references.some((item) => item.capture_status) ? 'check' : 'text';
}

/** Reputation of a source, most reputable first (the enrichment job ranks an attribute's sources the same way). */
const TIER_ORDER = ['official', 'authorized_distributor', 'recognized_retailer', 'other'];

interface RankedSource {
  source_tier?: string | null;
  source_rank?: number | null;
  capture_status?: string | null;
  is_reference?: boolean | null;
}

const tierPosition = (tier: string | null | undefined) => {
  const index = TIER_ORDER.indexOf(tier ?? '');
  return index < 0 ? TIER_ORDER.length : index;
};

/**
 * An attribute's sources in the order the job chose its reference capture: by reputation, a crop already taken first
 * within a tier. Runs that stored ``source_rank`` keep their own order; older runs are ranked here the same way.
 */
export function rankReferences<T extends RankedSource>(references: readonly T[]): T[] {
  if (references.length && references.every((item) => typeof item.source_rank === 'number')) {
    return [...references].sort((left, right) => (left.source_rank as number) - (right.source_rank as number));
  }
  return references
    .map((item, index) => ({ item, index }))
    .sort(
      (left, right) =>
        tierPosition(left.item.source_tier) - tierPosition(right.item.source_tier) ||
        Number(left.item.capture_status !== 'COMPLETE') - Number(right.item.capture_status !== 'COMPLETE') ||
        left.index - right.index
    )
    .map(({ item }) => item);
}

/**
 * The one capture shown for a value: the source the job marked (``is_reference``), or, in runs before that mark,
 * the most reputable source with a complete crop.
 */
export function referenceOf<T extends RankedSource>(references: readonly T[]): T | null {
  if (references.some((item) => typeof item.is_reference === 'boolean')) {
    return references.find((item) => item.is_reference) ?? null;
  }
  return rankReferences(references).find((item) => item.capture_status === 'COMPLETE') ?? null;
}

/**
 * The ranked sources without repeats: the job keeps one evidence per fact and source, so two facts quoting the same
 * passage of a page would list that page twice. The reference stands for its group when it is one of them.
 */
export function distinctSources<T extends { url: string; excerpt?: string | null; fact_value?: string | null }>(
  ranked: readonly T[],
  reference: T | null
): T[] {
  const groups = new Map<string, T>();
  for (const item of ranked) {
    const key = [item.url.replace(/\/+$/, ''), item.excerpt ?? '', item.fact_value ?? ''].join('\u0000');
    if (!groups.has(key) || item === reference) groups.set(key, item);
  }
  return Array.from(groups.values());
}

/** Reasons a source has no crop, by the job's capture_code; translated under product:audit.reason. */
const CAPTURE_REASONS = new Set([
  'PAGE_NOT_CAPTURED',
  'UNSUPPORTED',
  'NO_MATCH',
  'AMBIGUOUS',
  'UNSTABLE',
  'CROP_FAILED',
  'NOT_ON_PAGE',
  'HIDDEN',
  'STRUCTURED_DATA_ONLY',
  'BLOCKED',
  'PAGE_CHANGED',
  'FIRECRAWL_REJECTED',
  'OUT_OF_CREDITS',
  'BUDGET',
  'FOCUS_FAILED',
  'TOO_MANY',
]);

/** Runs before capture_code reported the reason only in English text: the messages the job wrote then. */
const LEGACY_REASONS: [RegExp, string][] = [
  [/blank screenshot/i, 'BLANK'],
  [/^Focused capture failed/i, 'FOCUS_FAILED'],
  [/Too many values on this page/i, 'TOO_MANY'],
  [/did not load the same content/i, 'BLOCKED'],
  [/in no displayed element/i, 'STRUCTURED_DATA_ONLY'],
  [/changed address/i, 'PAGE_CHANGED'],
  [/budget exhausted/i, 'BUDGET'],
  [/stayed hidden or covered/i, 'HIDDEN'],
  [/^PDF:/, 'PDF_FAILED'],
];

const STATUS_REASONS: Record<string, string> = {
  NO_MATCH: 'NO_MATCH',
  AMBIGUOUS: 'AMBIGUOUS',
  SCREENSHOT_ONLY: 'UNSTABLE',
  NOT_VISIBLE: 'HIDDEN',
  NOT_CAPTURED: 'PAGE_NOT_CAPTURED',
  UNSUPPORTED: 'UNSUPPORTED',
  FAILED: 'CROP_FAILED',
};

/** Key under product:audit.reason for why a source has no crop, in plain words; null when it has one. */
export function captureReasonKey(source: {
  capture_status?: string | null;
  capture_error?: string | null;
  capture_code?: string | null;
}): string | null {
  if (source.capture_status === 'COMPLETE') return null;
  if (source.capture_code && CAPTURE_REASONS.has(source.capture_code)) return source.capture_code;
  const error = source.capture_error ?? '';
  if (source.capture_status === 'UNSUPPORTED') return 'UNSUPPORTED';
  const legacy = LEGACY_REASONS.find(([pattern]) => pattern.test(error));
  if (legacy) return legacy[1];
  return STATUS_REASONS[source.capture_status ?? ''] ?? (source.capture_status ? 'CROP_FAILED' : 'TEXT_ONLY');
}

/** Validation issues of one attribute: the job writes their field as "attributes.<code>" (or "attribute.<code>"). */
export function attributeCodeOf(field: string | null | undefined): string | null {
  const match = /^attributes?\.(.+)$/.exec(field ?? '');
  return match ? match[1] : null;
}
