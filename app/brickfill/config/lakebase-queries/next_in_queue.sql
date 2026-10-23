-- Next product of the review queue after :ean, in the catalog order (title, GTIN), wrapping around: enrichment results
-- (to review or enriched without errors) that no reviewer has approved or rejected yet. The same queue sizes the
-- enrichment batches (lakebase.pending_reviews). No row when the queue is empty.
-- @param ean STRING
-- @param refresh_token STRING
WITH products AS (
  SELECT p.ean, COALESCE(s.generated_title, p.source_title) AS display_title, s.run_id, r.status AS review_status
  FROM ({{products_base}}) p
  LEFT JOIN {{results}}.product_enrichment s ON s.ean = p.ean
  LEFT JOIN {{app}}.product_review r ON r.product_ean = p.ean
    -- a decision holds only for the run it was made on (review-decision.ts, decisionApplies)
    AND (r.run_id = s.run_id OR (r.run_id IS NULL AND r.updated_at >= s.created_at AT TIME ZONE 'UTC'))
),
queue AS (
  SELECT ean, display_title
  FROM products
  WHERE run_id IS NOT NULL AND COALESCE(review_status, 'PENDING') NOT IN ('APPROVED', 'REJECTED')
    AND ean <> :ean::text AND LENGTH(:refresh_token::text) >= 0
),
current AS (SELECT display_title, ean FROM products WHERE ean = :ean::text)
SELECT q.ean, q.display_title, (SELECT COUNT(*) FROM queue)::int AS remaining
FROM queue q
LEFT JOIN current c ON TRUE
ORDER BY (c.ean IS NOT NULL AND (q.display_title, q.ean) > (c.display_title, c.ean)) DESC, q.display_title, q.ean
LIMIT 1
