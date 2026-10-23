export interface Reviewer {
  /** E-mail shown in the app and in the published data. */
  email: string;
  /** Databricks user id, stored next to the e-mail in the audit trail. */
  id: string;
}

/**
 * The person behind a request. Databricks Apps authenticates every request and sets x-forwarded-email and
 * x-forwarded-user before it reaches the app, which is only reachable through that proxy. Writes are refused when
 * either is missing: they are never attributed to the app's service principal. Local development has no proxy;
 * there the reviewer is LOCAL_REVIEWER_EMAIL.
 */
export function reviewer(
  req: { header(name: string): string | undefined },
  env: NodeJS.ProcessEnv = process.env
): Reviewer | undefined {
  const email = req.header('x-forwarded-email')?.trim();
  const id = req.header('x-forwarded-user')?.trim();
  if (email && id) return { email, id };
  const local = env.NODE_ENV === 'development' ? env.LOCAL_REVIEWER_EMAIL?.trim() : undefined;
  return local ? { email: local, id: `local:${local}` } : undefined;
}
