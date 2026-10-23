-- @param ean STRING
-- @param refresh_token STRING
SELECT i.issue_code, i.severity, i.field, i.message, COALESCE(i.params_json, '{}') AS params_json
FROM {{results}}.validation_issue i
JOIN {{results}}.product_enrichment e ON e.ean = i.ean AND e.run_id = i.run_id
WHERE i.ean = :ean::text AND LENGTH(:refresh_token::text) >= 0
ORDER BY CASE i.severity WHEN 'ERROR' THEN 1 WHEN 'WARNING' THEN 2 ELSE 3 END, i.issue_code
