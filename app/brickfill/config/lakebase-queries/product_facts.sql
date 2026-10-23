-- @param ean STRING
-- @param refresh_token STRING
SELECT
  f.fact_name,
  f.fact_value,
  f.normalized_value,
  ROUND((f.confidence * 100)::numeric, 1)::float8 AS confidence,
  f.evidence_json
FROM {{results}}.product_fact f
JOIN {{results}}.product_enrichment e ON e.ean = f.ean AND e.run_id = f.run_id
WHERE f.ean = :ean::text AND LENGTH(:refresh_token::text) >= 0
ORDER BY f.fact_name
