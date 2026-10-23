-- @param ean STRING
-- @param refresh_token STRING
SELECT
  p.ean,
  p.product_id,
  p.source_title,
  p.source_brand,
  p.department,
  p.category,
  p.subcategory,
  s.run_id,
  s.generated_title,
  s.short_description,
  s.meta_description,
  s.verified_brand,
  s.model,
  s.supplier,
  ROUND((COALESCE(s.quality_score, 0) * 100)::numeric, 1)::float8 AS quality_score,
  ROUND((COALESCE(s.required_coverage, 0) * 100)::numeric, 1)::float8 AS required_coverage,
  COALESCE(s.status, 'PENDING') AS status,
  s.result_json,
  COALESCE(s.error_count, 0)::int AS error_count,
  COALESCE(s.warning_count, 0)::int AS warning_count,
  s.created_at,
  s.content_language,
  s.content_profile
FROM ({{products_base}}) p
LEFT JOIN {{results}}.product_enrichment s ON s.ean = p.ean
WHERE p.ean = :ean::text AND LENGTH(:refresh_token::text) >= 0
LIMIT 1
