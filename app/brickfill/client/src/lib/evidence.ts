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
