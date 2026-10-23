import { ensureOk } from './api-errors';

/** Evidence a reviewer attaches to an attribute value (stored in Lakebase; screenshots in the manual Volume). */
export interface ManualEvidence {
  id: number;
  attribute_code: string;
  attribute_name: string;
  override_id: number | null;
  source_url: string | null;
  excerpt: string | null;
  note: string | null;
  screenshot_path: string | null;
  created_by: string;
  created_at: string;
}

export interface ManualEvidenceDraft {
  sourceUrl: string;
  excerpt: string;
  note: string;
  file: File | null;
}

export const emptyDraft: ManualEvidenceDraft = { sourceUrl: '', excerpt: '', note: '', file: null };

export const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export function manualEvidenceFileUrl(path: string): string {
  return `/api/files/manual_evidence/raw?${new URLSearchParams({ path })}`;
}

/**
 * Same rule as the server: a screenshot, or an https source together with the excerpt that proves the value.
 * Returns the i18n key of the problem (translate with `t`), or null when the draft is valid.
 */
export function draftProblem(draft: ManualEvidenceDraft): string | null {
  const url = draft.sourceUrl.trim();
  if (draft.file) {
    if (!ACCEPTED_IMAGE_TYPES.includes(draft.file.type)) return 'product:evidenceForm.problems.imageType';
    if (draft.file.size > MAX_SCREENSHOT_BYTES) return 'product:evidenceForm.problems.imageSize';
  }
  if (url && !/^https:\/\/\S+$/.test(url)) return 'product:evidenceForm.problems.https';
  if (!draft.file && !(url && draft.excerpt.trim())) return 'product:evidenceForm.problems.missing';
  return null;
}

/** Upload the screenshot (validated again by the server) and build the evidence body the API expects. */
export async function evidencePayload(ean: string, attributeCode: string, draft: ManualEvidenceDraft) {
  let screenshotPath: string | undefined;
  if (draft.file) {
    const response = await fetch(
      `/api/products/${ean}/attributes/${encodeURIComponent(attributeCode)}/evidence-files`,
      { method: 'POST', headers: { 'Content-Type': draft.file.type }, body: draft.file }
    );
    await ensureOk(response, 'errors:SCREENSHOT_SAVE_FAILED');
    screenshotPath = ((await response.json()) as { path: string }).path;
  }
  return {
    sourceUrl: draft.sourceUrl.trim() || undefined,
    excerpt: draft.excerpt.trim() || undefined,
    note: draft.note.trim() || undefined,
    screenshotPath,
  };
}

export async function addManualEvidence(
  ean: string,
  attributeCode: string,
  attributeName: string,
  draft: ManualEvidenceDraft,
  /** Run of the result shown: evidence of an AI value supports that run's value only. */
  runId: string | null
): Promise<void> {
  const body = await evidencePayload(ean, attributeCode, draft);
  const response = await fetch(`/api/products/${ean}/attributes/${encodeURIComponent(attributeCode)}/evidence`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, attributeName, runId }),
  });
  await ensureOk(response, 'errors:EVIDENCE_SAVE_FAILED');
}

export async function removeManualEvidence(ean: string, attributeCode: string, id: number): Promise<void> {
  const response = await fetch(`/api/products/${ean}/attributes/${encodeURIComponent(attributeCode)}/evidence/${id}`, {
    method: 'DELETE',
  });
  await ensureOk(response, 'errors:EVIDENCE_REMOVE_FAILED');
}
