import { matchKey } from './search';

/** Row of config/lakebase-queries/category_tree.sql. */
export interface CategoryTreeRow {
  department_id: string | null;
  department: string | null;
  category_id: string | null;
  category: string | null;
  subcategory_id: string;
  subcategory: string | null;
  product_count: number;
}

export type CategoryLevel = 'department' | 'category' | 'subcategory';

/** One choice of a category picker: an id and its name at one level, with what else it may be searched by. */
export interface CategoryOption {
  level: CategoryLevel;
  id: string;
  name: string;
  /** Parent names ("Appliances › Hair care"), shown under the name. */
  path: string;
  /** Synonyms from the category templates that match this level. */
  synonyms: string[];
}

/** What a category template says about the categories it covers (its CategoryMatch). */
export interface MatchLike {
  department_ids?: string[];
  category_ids?: string[];
  subcategory_ids?: string[];
  department_names?: string[];
  category_names?: string[];
  subcategory_names?: string[];
  synonyms?: string[];
}

/**
 * Distinct options of one level of the catalog tree. Synonyms of the templates that cover an option (by id or name)
 * are attached to it, so the pickers also find a category by the names the sources use.
 */
export function categoryOptions(
  rows: readonly CategoryTreeRow[],
  level: CategoryLevel,
  templates: readonly MatchLike[] = []
): CategoryOption[] {
  const options = new Map<string, CategoryOption>();
  for (const row of rows) {
    const id = row[`${level}_id`];
    const name = row[level] ?? id;
    if (!id || !name) continue;
    const path =
      level === 'subcategory'
        ? [row.department, row.category].filter(Boolean).join(' › ')
        : level === 'category'
          ? (row.department ?? '')
          : '';
    if (!options.has(id)) options.set(id, { level, id, name, path, synonyms: [] });
  }
  for (const template of templates) {
    const ids = new Set(template[`${level}_ids`] ?? []);
    const names = new Set((template[`${level}_names`] ?? []).map(matchKey));
    for (const option of options.values()) {
      if (ids.has(option.id) || names.has(matchKey(option.name))) {
        option.synonyms = [...new Set([...option.synonyms, ...(template.synonyms ?? [])])];
      }
    }
  }
  return [...options.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
