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
 * (a blank screenshot) get their own label, so the reviewer knows the page was never rendered.
 */
export function captureLabelKey(
  status: string | null | undefined,
  error: string | null | undefined,
  captureExpected: boolean
): string {
  if (status === 'COMPLETE') return 'COMPLETE';
  if (!status && !captureExpected) return 'LEGACY';
  if (status === 'FAILED' && /blank screenshot/i.test(error ?? '')) return 'BLANK';
  return CAPTURE_STATUSES.has(status ?? '') ? (status as string) : 'INCOMPLETE';
}
