-- @param search STRING
-- @param status STRING
-- @param category STRING
-- @param issue STRING
-- @param sort STRING
-- @param page_size STRING
-- @param page_offset STRING
-- @param refresh_token STRING
SELECT
  p.ean,
  p.product_id,
  COALESCE(s.generated_title, p.source_title) AS display_title,
  COALESCE(s.verified_brand, p.source_brand, '') AS brand,
  p.category,
  p.subcategory,
  COALESCE(s.status, 'PENDING') AS status,
  r.status AS review_status,
  ROUND((COALESCE(s.quality_score, 0) * 100)::numeric, 1)::float8 AS quality_score,
  ROUND((COALESCE(s.required_coverage, 0) * 100)::numeric, 1)::float8 AS required_coverage,
  COALESCE(s.error_count, 0)::int AS error_count,
  COALESCE(s.warning_count, 0)::int AS warning_count,
  s.created_at,
  COUNT(*) OVER ()::int AS total_count
FROM ({{products_base}}) p
LEFT JOIN {{results}}.product_enrichment s ON s.ean = p.ean
LEFT JOIN {{app}}.product_review r ON r.product_ean = p.ean
  -- a decision holds only for the run it was made on (review-decision.ts, decisionApplies)
  AND (r.run_id = s.run_id OR (r.run_id IS NULL AND r.updated_at >= s.created_at AT TIME ZONE 'UTC'))
WHERE (
  :search::text = '' OR
  LOWER(CONCAT_WS(' ', p.ean, p.product_id, p.source_title, p.source_brand, s.generated_title, s.verified_brand,
                  p.category, p.subcategory))
    LIKE CONCAT('%', LOWER(:search::text), '%')
)
AND (:status::text = '' OR COALESCE(s.status, 'PENDING') = :status::text)
AND (:category::text = '' OR p.category = :category::text)
AND (
  :issue::text = '' OR EXISTS (
    SELECT 1 FROM {{results}}.validation_issue i
    WHERE i.ean = p.ean AND i.run_id = s.run_id AND i.issue_code = :issue::text
  )
)
AND LENGTH(:refresh_token::text) >= 0
ORDER BY
  CASE WHEN :sort::text = 'quality_asc' THEN s.quality_score END ASC NULLS LAST,
  CASE WHEN :sort::text = 'quality_desc' THEN s.quality_score END DESC NULLS LAST,
  -- The review queue first: results no reviewer has approved or rejected yet (as next_in_queue).
  CASE
    WHEN s.run_id IS NOT NULL AND COALESCE(r.status, 'PENDING') NOT IN ('APPROVED', 'REJECTED') THEN 1
    WHEN COALESCE(s.status, 'PENDING') = 'PENDING' THEN 2
    ELSE 3
  END,
  display_title,
  p.ean
LIMIT :page_size::int OFFSET :page_offset::int
