import i18n from '../i18n';

/** Error returned by the app server: `{ code, error }`, where `error` is an English fallback. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** Localized message for a server error payload: `errors:<code>`, then the server text, then the fallback key. */
export function translateApiError(payload: { code?: unknown; error?: unknown }, fallbackKey: string): string {
  const code = typeof payload.code === 'string' ? payload.code : null;
  if (code && i18n.exists(`errors:${code}`)) return i18n.t(`errors:${code}`);
  if (typeof payload.error === 'string' && payload.error.trim()) return payload.error;
  return i18n.t(fallbackKey);
}

async function readPayload(response: Response): Promise<{ code?: unknown; error?: unknown }> {
  try {
    return (await response.json()) as { code?: unknown; error?: unknown };
  } catch {
    return {};
  }
}

/** Throws an `ApiError` with a localized message when the response is not 2xx. */
export async function ensureOk(response: Response, fallbackKey: string): Promise<Response> {
  if (response.ok) return response;
  const payload = await readPayload(response);
  throw new ApiError(
    translateApiError(payload, fallbackKey),
    response.status,
    typeof payload.code === 'string' ? payload.code : null
  );
}

/** `fetch` rejects with a TypeError when the request never got an answer (offline, DNS, connection reset). */
function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError;
}

/** Message of anything caught in a fetch path, localized when it is not already an Error. */
export function errorText(error: unknown, fallbackKey: string): string {
  if (isNetworkError(error)) return i18n.t('errors:NETWORK_ERROR');
  // Invalid JSON (e.g. an HTML error page from a proxy): the raw message means nothing to users.
  if (error instanceof SyntaxError) return i18n.t(fallbackKey);
  if (error instanceof Error && error.message) return error.message;
  return i18n.t(fallbackKey);
}

/** Localized error of a catalog query (`useCatalogQuery`): `errors:<errorCode>` when known, else the message. */
export function queryErrorText(query: { error: string | null; errorCode?: string | null }): string | null {
  if (!query.error && !query.errorCode) return null;
  if (query.errorCode && i18n.exists(`errors:${query.errorCode}`)) return i18n.t(`errors:${query.errorCode}`);
  return query.error ?? i18n.t('errors:INTERNAL_ERROR');
}
