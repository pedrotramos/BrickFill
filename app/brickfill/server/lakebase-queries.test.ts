import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadLakebaseQueries } from './lakebase-queries';
import { runLakebaseQuery } from './routes/lakebase-query-routes';

const queries = loadLakebaseQueries(join(__dirname, '..', 'config', 'lakebase-queries'), {
  serving: '"brickfill_serving"',
  results: '"enrichment"',
  app: '"brickfill_app"',
});

function missingTable(relation: string) {
  return Object.assign(new Error(`relation "${relation}" does not exist`), { code: '42P01' });
}

describe('Lakebase queries before the first enrichment run', () => {
  it('reads the synced catalog without the results schema', () => {
    for (const key of ['catalog_overview', 'product_list', 'product_detail', 'next_in_queue']) {
      const fallback = queries.get(key)?.beforeFirstRun;
      expect(fallback?.text, key).not.toContain('"enrichment".');
      expect(fallback?.text, key).toContain('"brickfill_serving".products');
      expect(fallback?.text, key).not.toMatch(/stand-in|\{\{/);
    }
    expect(queries.get('categories')?.beforeFirstRun).toBeUndefined();
    for (const key of ['product_attributes', 'product_facts']) {
      expect(queries.get(key)?.beforeFirstRun, key).toBeNull();
    }
    expect(queries.get('issue_codes')?.beforeFirstRun?.text).not.toContain('"enrichment".');
    // the issue filter of the catalog reads the stand-in of validation_issue too
    expect(queries.get('product_list')?.beforeFirstRun?.text).toContain('WHERE FALSE');
    expect(queries.get('product_list')?.text).toContain('"brickfill_app".product_review');
  });

  it('falls back only when a table is missing', async () => {
    const list = queries.get('product_list')!;
    const calls: { text: string; values: unknown[] }[] = [];
    const lakebase = {
      async query(text: string, values: unknown[] = []) {
        calls.push({ text, values });
        if (text.includes('"enrichment".')) throw missingTable('enrichment.product_enrichment');
        return { rows: [{ ean: '1' }] };
      },
    };
    const values = list.parameters.map((name) => `${name}-value`);
    await expect(runLakebaseQuery(lakebase, list, values)).resolves.toEqual([{ ean: '1' }]);
    expect(calls[1].values).toEqual(list.beforeFirstRun!.parameters.map((name) => `${name}-value`));

    await expect(runLakebaseQuery(lakebase, queries.get('product_facts')!, ['e', 't'])).resolves.toEqual([]);

    const denied = { query: () => Promise.reject(Object.assign(new Error('permission denied'), { code: '42501' })) };
    await expect(runLakebaseQuery(denied, list, values)).rejects.toThrow('permission denied');
    const noCatalog = { query: () => Promise.reject(missingTable('brickfill_serving.products')) };
    await expect(runLakebaseQuery(noCatalog, list, values)).rejects.toThrow('brickfill_serving.products');
  });
});

describe('Review queue', () => {
  const decisionRule = "r.run_id = s.run_id OR (r.run_id IS NULL AND r.updated_at >= s.created_at AT TIME ZONE 'UTC')";

  it('holds a decision only for the run it was made on, in the queue and in the list', () => {
    for (const key of ['next_in_queue', 'product_list']) {
      expect(queries.get(key)?.text, key).toContain(decisionRule);
    }
  });

  it('queues every enrichment result without a decision, with or without errors (as the batch capacity)', () => {
    const queue = queries.get('next_in_queue')!.text;
    expect(queue).toContain('WHERE run_id IS NOT NULL AND');
    expect(queue).not.toContain("'REVIEW_REQUIRED'");
    expect(queries.get('product_list')!.text).not.toContain("WHEN s.status = 'REVIEW_REQUIRED'");
  });
});
