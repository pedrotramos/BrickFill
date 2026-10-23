-- Issue codes of the latest results, for the catalog filter (most frequent first).
-- @param refresh_token STRING
SELECT i.issue_code, MIN(i.severity) AS severity, COUNT(DISTINCT i.ean)::int AS product_count
FROM {{results}}.validation_issue i
JOIN {{results}}.product_enrichment e ON e.ean = i.ean AND e.run_id = i.run_id
WHERE i.issue_code IS NOT NULL AND LENGTH(:refresh_token::text) >= 0
GROUP BY i.issue_code
ORDER BY COUNT(DISTINCT i.ean) DESC, i.issue_code
