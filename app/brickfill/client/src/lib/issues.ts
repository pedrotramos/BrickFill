import i18n from '../i18n';

/** One row of the product_issues query. `params_json` carries the values the localized message interpolates. */
export interface IssueRow {
  issue_code: string;
  field?: string | null;
  message?: string | null;
  severity?: string | null;
  params_json?: unknown;
}

type Params = Record<string, string | number>;

export function parseParams(value: unknown): Params {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    if (!value.trim()) return {};
    try {
      parsed = JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const params: Params = {};
  for (const [name, item] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof item === 'string' || typeof item === 'number') params[name] = item;
    else if (Array.isArray(item)) params[name] = item.join(' / ');
    else if (typeof item === 'boolean') params[name] = String(item);
  }
  return params;
}

/** Untranslated template of a key in the active language (or English), before interpolation. */
function rawTemplate(namespace: string, path: string): string {
  for (const language of [i18n.resolvedLanguage, 'en']) {
    if (!language) continue;
    const value: unknown = i18n.getResource(language, namespace, path);
    if (typeof value === 'string') return value;
  }
  return '';
}

function placeholders(template: string): string[] {
  return Array.from(template.matchAll(/{{\s*(\w+)\s*}}/g), (match) => match[1]);
}

/** Readable name of the field an issue points at ("fact.Weight" → "Fact “Weight”"). */
export function fieldLabel(field: string | null | undefined): string {
  if (!field) return '';
  const [prefix, ...rest] = field.split('.');
  const name = rest.join('.');
  if (name && (prefix === 'fact' || prefix === 'attribute' || prefix === 'attributes')) {
    return i18n.t(`issues:fields.${prefix === 'fact' ? 'fact' : 'attribute'}`, { name });
  }
  return i18n.exists(`issues:fields.${field}`) ? i18n.t(`issues:fields.${field}`) : field;
}

export function issueTitle(code: string): string {
  return i18n.exists(`issues:codes.${code}.title`) ? i18n.t(`issues:codes.${code}.title`) : code;
}

/**
 * Localized message of a validation issue. Falls back to the stored message (English, or the language of the
 * run for historical rows) when the code is unknown or the row lacks a parameter the translation needs.
 */
export function issueMessage(issue: IssueRow): string {
  const key = `issues:codes.${issue.issue_code}.message`;
  const stored = issue.message?.trim() ?? '';
  if (!i18n.exists(key)) return stored || issue.issue_code;
  const params: Params = { ...parseParams(issue.params_json), field: fieldLabel(issue.field) };
  const template = rawTemplate('issues', `codes.${issue.issue_code}.message`);
  const missing = placeholders(template).filter((name) => params[name] === undefined || params[name] === '');
  if (missing.length && stored) return stored;
  return i18n.t(key, params);
}

export function severityLabel(severity: string | null | undefined): string {
  if (!severity) return '';
  return i18n.exists(`issues:severity.${severity}`) ? i18n.t(`issues:severity.${severity}`) : severity;
}

/** Translated reason of an attribute state (`rejection_code` / `applicability_code`), else the stored English text. */
export function attributeReason(
  kind: 'rejection' | 'applicability',
  code: string | null | undefined,
  fallback: string | null | undefined
): string | null {
  if (code && i18n.exists(`product:attributes.${kind}.${code}`)) return i18n.t(`product:attributes.${kind}.${code}`);
  return fallback?.trim() || null;
}
