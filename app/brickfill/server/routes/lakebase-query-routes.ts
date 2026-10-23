import { join } from 'node:path';
import type { Application } from 'express';
import { type LakebaseQuery, loadLakebaseQueries, readLakebaseSchema, readResultsSchema } from '../lakebase-queries';
import { readAppSchema } from '../app-config';
import { sendError } from '../http-errors';

interface AppKitWithLakebase {
  lakebase: {
    query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  };
  server: {
    extend(fn: (app: Application) => void): void;
  };
}

const UNDEFINED_TABLE = '42P01';

/**
 * Runs a catalog query. Until the first enrichment run creates the results schema, the queries that read it fall back
 * to {@link LakebaseQuery.beforeFirstRun}, so a fresh install already lists the synced catalog. A missing synced table
 * still fails, because the fallback reads it too.
 */
export async function runLakebaseQuery(
  lakebase: AppKitWithLakebase['lakebase'],
  query: LakebaseQuery,
  values: unknown[]
): Promise<Record<string, unknown>[]> {
  try {
    return (await lakebase.query(query.text, values)).rows;
  } catch (error) {
    const fallback = query.beforeFirstRun;
    if ((error as { code?: unknown }).code !== UNDEFINED_TABLE || fallback === undefined) throw error;
    if (fallback === null) return [];
    const byName = new Map(query.parameters.map((name, index) => [name, values[index]]));
    return (
      await lakebase.query(
        fallback.text,
        fallback.parameters.map((name) => byName.get(name))
      )
    ).rows;
  }
}

/**
 * Serves the catalog queries (config/lakebase-queries). The app reads every catalog screen from Lakebase: the table
 * synced from the canonical products view plus the latest enrichment of each product, which the enrichment job loads
 * into its own schema.
 */
export function setupLakebaseQueryRoutes(appkit: AppKitWithLakebase) {
  const queries = loadLakebaseQueries(join(process.cwd(), 'config', 'lakebase-queries'), {
    serving: readLakebaseSchema(),
    results: readResultsSchema(),
    app: readAppSchema().sql,
  });

  appkit.server.extend((app) => {
    app.get('/api/lakebase-query/:key', async (req, res) => {
      const query = queries.get(req.params.key);
      if (!query) {
        sendError(res, 404, 'LAKEBASE_QUERY_UNAVAILABLE');
        return;
      }
      const values: unknown[] = [];
      for (const name of query.parameters) {
        const value = req.query[name];
        if (typeof value !== 'string') {
          sendError(res, 400, 'MISSING_QUERY_PARAMETER', `Missing query parameter: ${name}`);
          return;
        }
        values.push(value);
      }
      try {
        res.json({ rows: await runLakebaseQuery(appkit.lakebase, query, values) });
      } catch (error) {
        console.error(`Lakebase read ${req.params.key} failed`, error);
        sendError(res, 500, 'LAKEBASE_QUERY_FAILED');
      }
    });
  });
}
