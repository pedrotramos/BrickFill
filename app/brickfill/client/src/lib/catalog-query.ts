import { useEffect, useState } from 'react';

/**
 * Row of each catalog query in config/lakebase-queries, as the server returns it from Lakebase. Columns read from the
 * enrichment results are null for a product that has not been enriched yet; timestamps arrive as ISO strings. Names and
 * codes that the enrichment job always writes are typed as present.
 */
export interface CatalogQueries {
  catalog_overview: {
    product_count: number;
    enriched_count: number;
    review_count: number;
    pending_count: number;
    /** Products with an enrichment result, the base of both averages. */
    scored_count: number;
    average_quality: number | null;
    average_coverage: number | null;
    last_updated_at: string | null;
  };
  categories: { category_id: string; category: string };
  issue_codes: { issue_code: string; severity: string | null; product_count: number };
  next_in_queue: { ean: string; display_title: string; remaining: number };
  product_attributes: {
    attribute_code: string;
    attribute_name: string;
    attribute_value: string | null;
    required: boolean | null;
    applicable: boolean | null;
    confidence: number | null;
    evidence_urls_json: string | null;
    observation: string | null;
    candidate_value: string | null;
    normalized_value: string | null;
    mapping_status: string | null;
    source_fact_names_json: string | null;
    rejection_reason: string | null;
    applicability_reason: string | null;
    rejection_code: string | null;
    applicability_code: string | null;
  };
  product_detail: {
    ean: string;
    product_id: string;
    source_title: string;
    source_brand: string | null;
    department: string | null;
    category: string | null;
    subcategory: string | null;
    run_id: string | null;
    generated_title: string | null;
    short_description: string | null;
    meta_description: string | null;
    verified_brand: string | null;
    model: string | null;
    supplier: string | null;
    quality_score: number;
    required_coverage: number;
    status: string;
    result_json: string | null;
    error_count: number;
    warning_count: number;
    created_at: string | null;
    content_language: string | null;
    content_profile: string | null;
  };
  product_facts: {
    fact_name: string;
    fact_value: string | null;
    normalized_value: string | null;
    confidence: number | null;
    evidence_json: string | null;
  };
  product_issues: {
    issue_code: string;
    severity: string | null;
    field: string | null;
    message: string | null;
    params_json: string;
  };
  product_list: {
    ean: string;
    product_id: string;
    display_title: string;
    brand: string;
    category: string | null;
    subcategory: string | null;
    status: string;
    /** Decision recorded in the app (product_review) for the current result; null while no reviewer saved one, or
     * when it was made on an older result (the product was enriched again). */
    review_status: string | null;
    quality_score: number;
    required_coverage: number;
    error_count: number;
    warning_count: number;
    created_at: string | null;
    total_count: number;
  };
}

export type CatalogQueryKey = keyof CatalogQueries;
export type CatalogRows<K extends CatalogQueryKey> = CatalogQueries[K][];

interface QueryState<Rows> {
  data: Rows | null;
  loading: boolean;
  /** English message (fallback); translate `errors.<errorCode>` when the code is set. */
  error: string | null;
  /** Server error code of a failed query (e.g. LAKEBASE_QUERY_FAILED). */
  errorCode: string | null;
}

class QueryError extends Error {
  readonly code: string | null;

  constructor(message: string, code: string | null) {
    super(message);
    this.code = code;
  }
}

/**
 * Reads one catalog query from Lakebase through the server (`/api/lakebase-query/<key>`). Parameters are strings.
 * With `keepPrevious`, a reload (e.g. a new refresh token) keeps the rows of the previous request while `loading`, so
 * the page keeps what it shows (open tab, forms) instead of falling back to its skeleton.
 */
export function useCatalogQuery<K extends CatalogQueryKey>(
  key: K,
  parameters: Record<string, string>,
  { keepPrevious = false }: { keepPrevious?: boolean } = {}
): QueryState<CatalogRows<K>> {
  const serialized = JSON.stringify(parameters);
  const requestId = `${key}|${serialized}`;
  const [result, setResult] = useState<{
    id: string;
    data: CatalogRows<K> | null;
    error: string | null;
    errorCode: string | null;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const search = new URLSearchParams(JSON.parse(serialized) as Record<string, string>);
    fetch(`/api/lakebase-query/${key}?${search.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        // A proxy or crash page answers with HTML; report it as a failed query, not a JSON parse error.
        const body = (await response.json().catch(() => ({}))) as {
          rows?: CatalogRows<K>;
          code?: string;
          error?: string;
        };
        if (!response.ok || !body.rows) {
          throw new QueryError(
            body.error ?? 'Could not query the Lakebase tables.',
            body.code ?? 'LAKEBASE_QUERY_FAILED'
          );
        }
        setResult({ id: requestId, data: body.rows, error: null, errorCode: null });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setResult({
          id: requestId,
          data: null,
          error: error instanceof Error ? error.message : String(error),
          // fetch itself failed (offline, connection reset): no server answer to report
          errorCode: error instanceof QueryError ? error.code : error instanceof TypeError ? 'NETWORK_ERROR' : null,
        });
      });
    return () => controller.abort();
  }, [key, requestId, serialized]);

  const current = result?.id === requestId ? result : null;
  return {
    data: current ? current.data : keepPrevious ? (result?.data ?? null) : null,
    loading: !current,
    error: current?.error ?? null,
    errorCode: current?.errorCode ?? null,
  };
}
