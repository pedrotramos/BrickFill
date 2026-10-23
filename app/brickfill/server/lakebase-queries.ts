import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { postgresSchema } from './app-config';

/** Postgres schema that receives the table synced from the canonical products view (v_products). */
export function readLakebaseSchema(env: NodeJS.ProcessEnv = process.env): string {
  return postgresSchema('LAKEBASE_SYNC_SCHEMA', env.LAKEBASE_SYNC_SCHEMA?.trim() || 'brickfill_serving').sql;
}

/** Postgres schema where the enrichment job loads the latest result of each product. */
export function readResultsSchema(env: NodeJS.ProcessEnv = process.env): string {
  return postgresSchema('LAKEBASE_RESULTS_SCHEMA', env.LAKEBASE_RESULTS_SCHEMA?.trim() || 'enrichment').sql;
}

export interface LakebaseQuery {
  text: string;
  /** Parameter names in $1..$n order. */
  parameters: string[];
  /**
   * What to run while the enrichment job hasn't created its results tables yet (a fresh install): the same statement
   * over empty stand-ins of the results tables it reads (config/lakebase-queries/_pending_<table>.sql), or null when
   * one of those tables has no stand-in (the query then has no rows yet: attributes, facts). Undefined when the query
   * doesn't read the results schema.
   */
  beforeFirstRun?: LakebaseQuery | null;
}

export interface LakebaseSchemas {
  serving: string;
  results: string;
  /** Schema the app owns (reviews, edits); its tables exist from the app's first start. */
  app: string;
}

/**
 * Turns "-- @param name TYPE" + ":name" placeholders into a positional-parameter Postgres statement.
 * {{products_base}} is replaced by the products fragment, {{serving}} by the schema of the synced table,
 * {{results}} by the schema where the enrichment job loads its results and {{app}} by the schema the app owns.
 */
export function compileLakebaseQuery(template: string, schemas: LakebaseSchemas, productsBase = ''): LakebaseQuery {
  const declared = new Set([...template.matchAll(/^--\s*@param\s+([a-z_][a-z0-9_]*)/gim)].map((match) => match[1]));
  const parameters: string[] = [];
  const body = template
    .replace(/\{\{products_base\}\}/g, productsBase)
    .replace(/\{\{serving\}\}/g, schemas.serving)
    .replace(/\{\{results\}\}/g, schemas.results)
    .replace(/\{\{app\}\}/g, schemas.app);
  // "(?<!:)" keeps ::casts out; names are only matched when declared in the header.
  const text = body.replace(/(?<![:\w]):([a-z_][a-z0-9_]*)/g, (_all: string, name: string) => {
    if (!declared.has(name)) throw new Error(`Lakebase query uses :${name} without a "-- @param ${name}" declaration`);
    let index = parameters.indexOf(name);
    if (index === -1) index = parameters.push(name) - 1;
    return `$${index + 1}`;
  });
  return { text, parameters };
}

const RESULTS_TABLE = /\{\{results\}\}\.(\w+)/g;

/** {@link LakebaseQuery.beforeFirstRun} of a template; `standIns` holds the empty stand-in of each results table. */
export function compileBeforeFirstRun(
  template: string,
  schemas: LakebaseSchemas,
  productsBase: string,
  standIns: ReadonlyMap<string, string>
): LakebaseQuery | null | undefined {
  const tables = new Set([...template.matchAll(RESULTS_TABLE)].map((match) => match[1]));
  if (!tables.size) return undefined;
  if ([...tables].some((table) => !standIns.has(table))) return null;
  const withoutResults = template.replace(RESULTS_TABLE, (_all: string, table: string) => `(${standIns.get(table)})`);
  return compileLakebaseQuery(withoutResults, schemas, productsBase);
}

export function loadLakebaseQueries(directory: string, schemas: LakebaseSchemas): Map<string, LakebaseQuery> {
  const fragment = (name: string) =>
    readFileSync(join(directory, name), 'utf8')
      .replace(/^--.*\n/gm, '')
      .trim();
  const productsBase = fragment('_products_base.sql');
  const files = readdirSync(directory);
  const standIns = new Map(
    files
      .filter((name) => /^_pending_\w+\.sql$/.test(name))
      .map((name) => [name.slice('_pending_'.length, -'.sql'.length), fragment(name)])
  );
  const queries = new Map<string, LakebaseQuery>();
  for (const file of files.filter((name) => name.endsWith('.sql') && !name.startsWith('_'))) {
    const template = readFileSync(join(directory, file), 'utf8');
    queries.set(file.replace(/\.sql$/, ''), {
      ...compileLakebaseQuery(template, schemas, productsBase),
      beforeFirstRun: compileBeforeFirstRun(template, schemas, productsBase, standIns),
    });
  }
  return queries;
}
