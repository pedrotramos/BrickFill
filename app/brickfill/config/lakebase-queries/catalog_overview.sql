-- @param refresh_token STRING
SELECT
  COUNT(*)::int AS product_count,
  COALESCE(SUM(CASE WHEN s.status = 'ENRICHED' THEN 1 ELSE 0 END), 0)::int AS enriched_count,
  COALESCE(SUM(CASE WHEN s.status = 'REVIEW_REQUIRED' THEN 1 ELSE 0 END), 0)::int AS review_count,
  COALESCE(SUM(CASE WHEN COALESCE(s.status, 'PENDING') = 'PENDING' THEN 1 ELSE 0 END), 0)::int AS pending_count,
  COUNT(s.ean)::int AS scored_count,
  -- Averages over the enriched products only (AVG skips NULL); NULL until the first one is enriched.
  ROUND((AVG(s.quality_score) * 100)::numeric, 1)::float8 AS average_quality,
  ROUND((AVG(s.required_coverage) * 100)::numeric, 1)::float8 AS average_coverage,
  MAX(s.created_at) AS last_updated_at
FROM ({{products_base}}) p
LEFT JOIN {{results}}.product_enrichment s ON s.ean = p.ean
WHERE LENGTH(:refresh_token::text) >= 0
