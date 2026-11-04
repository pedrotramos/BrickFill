import { useEffect, useState } from 'react';
import { ensureOk } from './api-errors';
import type { ContentManifest, Overrides, SettingsEvent } from './settings';
import type { MatchLike } from './category-tree';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function send<T>(url: string, method: string, body: unknown, fallbackKey: string): Promise<T> {
  const response = await fetch(url, { method, headers: JSON_HEADERS, body: JSON.stringify(body) });
  await ensureOk(response, fallbackKey);
  return (await response.json()) as T;
}

async function load<T>(url: string, fallbackKey: string, signal?: AbortSignal): Promise<T> {
  const response = await ensureOk(await fetch(url, { signal }), fallbackKey);
  return (await response.json()) as T;
}

// --- category templates --------------------------------------------------------------------------------------------

export type TemplateMatch = Required<MatchLike>;

export interface CategoryTemplate {
  id: string;
  name: string;
  match: Partial<TemplateMatch>;
  overrides: Overrides;
  active: boolean;
  revision: number;
  updatedBy: string;
  updatedAt: string | null;
}

export interface TemplatesState {
  templates: CategoryTemplate[];
  manifest: ContentManifest;
  canEdit: boolean;
  history: SettingsEvent[];
}

export interface TemplateBody {
  name: string;
  match: Partial<TemplateMatch>;
  overrides: Overrides;
  active: boolean;
  expectedRevision: number;
  reason?: string;
}

export const loadTemplates = (signal?: AbortSignal) =>
  load<TemplatesState>('/api/category-templates', 'errors:TEMPLATES_LOAD_FAILED', signal);

/** Matches of the active templates, so category pickers also find a category by its synonyms (best effort). */
export function useTemplateMatches(): MatchLike[] {
  const [matches, setMatches] = useState<MatchLike[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    loadTemplates(controller.signal)
      .then((state) => setMatches(state.templates.filter((item) => item.active).map((item) => item.match)))
      .catch(() => undefined); // without synonyms the pickers still search names and ids
    return () => controller.abort();
  }, []);
  return matches;
}

export const saveTemplate = (id: string, body: TemplateBody) =>
  send<CategoryTemplate>(
    `/api/category-templates/${encodeURIComponent(id)}`,
    'PUT',
    body,
    'errors:TEMPLATE_SAVE_FAILED'
  );

/** Identifier of a new template from its name: "Secador de Cabelo" -> "secador-de-cabelo". */
export function templateIdFrom(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/**
 * Example of a title built by the formula: each token shows its sample value, or its own name when the template uses
 * a token without a sample; tokens with an empty sample are left out, as the agent leaves out parts without a value.
 */
export function titleExample(order: readonly string[], samples: Readonly<Record<string, string>>): string {
  return order
    .map((token) => (token in samples ? samples[token] : token))
    .filter((part) => part.trim())
    .join(' ');
}

// --- attribute requirements ----------------------------------------------------------------------------------------

export interface AttributeRequirement {
  subcategoryId: string;
  attributeId: string;
  attributeName: string | null;
  sourceRequired: boolean | null;
  sourceEffectiveRequired: boolean | null;
  overrideRequired: boolean | null;
  effectiveRequired: boolean | null;
  revision: number;
  updatedBy: string | null;
  updatedAt: string | null;
  inSource: boolean;
  syncedAt: string | null;
}

export interface RequirementsState {
  attributes: AttributeRequirement[];
  canEdit: boolean;
  history: SettingsEvent[];
}

export const loadRequirements = (subcategoryId: string, signal?: AbortSignal) =>
  load<RequirementsState>(
    `/api/attribute-requirements/${encodeURIComponent(subcategoryId)}`,
    'errors:REQUIREMENTS_LOAD_FAILED',
    signal
  );

export const saveRequirement = (
  subcategoryId: string,
  attributeId: string,
  body: { required: boolean | null; expectedRevision: number; reason?: string }
) =>
  send<{ revision: number }>(
    `/api/attribute-requirements/${encodeURIComponent(subcategoryId)}/${encodeURIComponent(attributeId)}`,
    'PUT',
    body,
    'errors:REQUIREMENT_SAVE_FAILED'
  );

// --- agent instructions --------------------------------------------------------------------------------------------

export interface InstructionVersion {
  version: number;
  body: string;
  active: boolean;
  restoredFrom: number | null;
  reason: string | null;
  createdBy: string;
  createdAt: string | null;
}

export interface InstructionsState {
  active: InstructionVersion | null;
  versions: InstructionVersion[];
  canEdit: boolean;
  editorsConfigured: boolean;
  maxLength: number;
}

export const loadInstructions = (signal?: AbortSignal) =>
  load<InstructionsState>('/api/agent-instructions', 'errors:INSTRUCTIONS_LOAD_FAILED', signal);

export const saveInstructions = (body: { body: string; expectedVersion: number; reason?: string }) =>
  send<InstructionVersion>('/api/agent-instructions', 'PUT', body, 'errors:INSTRUCTIONS_SAVE_FAILED');

export const restoreInstructions = (version: number, body: { expectedVersion: number; reason?: string }) =>
  send<InstructionVersion>(
    `/api/agent-instructions/${version}/restore`,
    'POST',
    body,
    'errors:INSTRUCTIONS_SAVE_FAILED'
  );
