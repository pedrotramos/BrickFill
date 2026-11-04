import { z } from 'zod';
import { type ContentManifest, overrideKeys, overridesSchema } from './content-manifest';

/**
 * A category template: the content model of one product type (title formula, fact-sheet structure, required and
 * optional facts), matched to departments, categories and subcategories of the source by id, name or synonym. The
 * enrichment job applies the most specific active template of each product as a settings layer between the global
 * settings and the department/category/subcategory overrides (brickfill.settings.resolve).
 */

export const TemplateId = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, 'Use 1 to 64 lowercase letters, digits, "-" or "_"');

const Names = z.array(z.string().trim().min(1).max(200)).max(200).default([]);

/** Same fields as brickfill.content.models.CategoryMatch. */
export const TemplateMatch = z
  .object({
    department_ids: Names,
    category_ids: Names,
    subcategory_ids: Names,
    department_names: Names,
    category_names: Names,
    subcategory_names: Names,
    synonyms: Names,
  })
  .strict()
  .refine(
    (match) => Object.values(match).some((items) => items.length > 0),
    'Associate the template with at least one department, category, subcategory or synonym'
  );
export type TemplateMatch = z.infer<typeof TemplateMatch>;

/** The manifest restricted to the override keys a template may set. */
export function templateManifest(manifest: ContentManifest): ContentManifest {
  const keys = new Set(overrideKeys(manifest, 'template'));
  return {
    ...manifest,
    overrides: Object.fromEntries(Object.entries(manifest.overrides).filter(([key]) => keys.has(key))),
  };
}

export function templateSchemas(manifest: ContentManifest) {
  const Overrides = overridesSchema(templateManifest(manifest));
  const Fields = z.object({
    name: z.string().trim().min(1).max(120),
    match: TemplateMatch,
    overrides: Overrides,
    active: z.boolean().default(true),
  });
  return {
    /** PUT /api/category-templates/:id; expectedRevision 0 creates the template. */
    Body: Fields.extend({
      expectedRevision: z.number().int().min(0),
      reason: z.string().trim().max(2000).optional(),
    }),
    /** One entry of the initial load file (CATEGORY_TEMPLATES_SEED). */
    Seed: Fields.extend({ id: TemplateId }),
  };
}

/** The state of a template as the history compares it (nested match and overrides compared key by key). */
export function templateState(template: { name: string; active: boolean; match: object; overrides: object }) {
  return { name: template.name, active: template.active, match: template.match, overrides: template.overrides };
}

/** Initial-load file name: a plain JSON file name inside config/ (never a path). */
export function seedFileName(value: string | undefined): string | null {
  const name = value?.trim();
  if (!name || name.toLowerCase() === 'none') return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\.json$/.test(name) || name.includes('..')) {
    throw new Error(`CATEGORY_TEMPLATES_SEED must be a JSON file name in config/: ${name}`);
  }
  return name;
}
