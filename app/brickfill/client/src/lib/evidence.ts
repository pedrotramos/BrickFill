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

/** Why a value has no crop (capture_status written by the enrichment job); translated under product:audit.capture. */
const CAPTURE_STATUSES = new Set([
  'NOT_VISIBLE',
  'NO_MATCH',
  'AMBIGUOUS',
  'SCREENSHOT_ONLY',
  'UNSUPPORTED',
  'NOT_CAPTURED',
  'FAILED',
]);

/**
 * Key under product:audit.capture for an evidence's capture outcome. A few failures the job reports by message
 * (a blank screenshot, a PDF crop) get their own label, so the reviewer knows the page was never rendered.
 */
export function captureLabelKey(
  status: string | null | undefined,
  error: string | null | undefined,
  captureExpected: boolean
): string {
  if (status === 'COMPLETE') return 'COMPLETE';
  if (!status && !captureExpected) return 'LEGACY';
  if (status === 'FAILED' && /blank screenshot/i.test(error ?? '')) return 'BLANK';
  // a PDF page was rendered but the value could not be cropped from it (messages prefixed "PDF:")
  if (status !== 'UNSUPPORTED' && CAPTURE_STATUSES.has(status ?? '') && /^PDF:/.test(error ?? '')) return 'PDF_FAILED';
  return CAPTURE_STATUSES.has(status ?? '') ? (status as string) : 'INCOMPLETE';
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

/** Validation issues of one attribute: the job writes their field as "attributes.<code>" (or "attribute.<code>"). */
export function attributeCodeOf(field: string | null | undefined): string | null {
  const match = /^attributes?\.(.+)$/.exec(field ?? '');
  return match ? match[1] : null;
}
