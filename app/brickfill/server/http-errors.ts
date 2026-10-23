import type { Response } from 'express';

/**
 * Every error response is `{ code, error }`: the client translates `errors.<code>` and falls back to the English
 * `error` text when it has no translation.
 */
export const ERROR_MESSAGES = {
  UNIDENTIFIED_USER: 'User not identified. Open the app through its Databricks Apps URL.',
  INVALID_EAN: 'Invalid GTIN.',
  REVIEW_LOAD_FAILED: 'Could not load the review.',
  INVALID_REVIEW: 'Invalid review data.',
  REVIEW_SAVE_FAILED: 'Could not save the review.',
  REVIEW_STALE: 'This product changed since you opened it (a new enrichment, an edit or an evidence). Check it again.',
  NOTHING_TO_APPROVE:
    'The enrichment of this product failed: there is no content to approve. Reject it or enrich it again.',
  INVALID_ATTRIBUTE_OVERRIDE: 'Invalid attribute edit.',
  INVALID_SCREENSHOT: 'Invalid screenshot; upload the image again.',
  OVERRIDE_CONFLICT: 'Another edit of this attribute was saved at the same time. Reload the product.',
  OVERRIDE_SAVE_FAILED: 'Could not save the attribute edit.',
  INVALID_ATTRIBUTE: 'Invalid attribute.',
  NO_ACTIVE_OVERRIDE: 'This attribute has no active edit.',
  OVERRIDE_RESTORE_FAILED: 'Could not restore the original AI value of the attribute.',
  INVALID_PRODUCT_OR_ATTRIBUTE: 'Invalid product or attribute.',
  SCREENSHOT_TOO_LARGE: 'The screenshot must be at most 10 MB.',
  UNSUPPORTED_IMAGE_TYPE: 'Upload a PNG, JPEG or WebP image.',
  SCREENSHOT_SAVE_FAILED: 'Could not save the screenshot.',
  EVIDENCE_SAVE_FAILED: 'Could not save the evidence.',
  INVALID_EVIDENCE: 'Invalid evidence.',
  EVIDENCE_URL_NOT_HTTPS: 'The source URL must start with https://.',
  EVIDENCE_MISSING: 'Provide a screenshot, or the source URL with the excerpt that proves the value.',
  EVIDENCE_NOT_FOUND: 'Evidence not found.',
  LAST_EVIDENCE: 'This is the only evidence of the edit. Add another one before removing it, or restore the AI value.',
  EVIDENCE_REMOVE_FAILED: 'Could not remove the evidence.',
  LAKEBASE_QUERY_UNAVAILABLE: 'This Lakebase query is not available.',
  MISSING_QUERY_PARAMETER: 'A required query parameter is missing.',
  LAKEBASE_QUERY_FAILED: 'Could not query the Lakebase tables.',
  SETTINGS_LOAD_FAILED: 'Could not load the settings.',
  SETTINGS_SAVE_FAILED: 'Could not save the settings.',
  SETTINGS_VERSION_CONFLICT: 'Someone else changed these settings. Reload and try again.',
  SETTINGS_FORBIDDEN: 'You are not allowed to change the settings.',
  INVALID_SETTINGS: 'Invalid settings.',
  NOT_FOUND: 'Not found.',
  INTERNAL_ERROR: 'Unexpected error.',
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && value in ERROR_MESSAGES;
}

export function sendError(res: Response, status: number, code: ErrorCode, error: string = ERROR_MESSAGES[code]) {
  res.status(status).json({ code, error });
}
