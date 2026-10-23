-- @param ean STRING
-- @param refresh_token STRING
SELECT
  a.attribute_code,
  a.attribute_name,
  a.attribute_value,
  a.required,
  a.applicable,
  ROUND((a.confidence * 100)::numeric, 1)::float8 AS confidence,
  a.evidence_urls_json,
  a.observation,
  a.candidate_value,
  a.normalized_value,
  a.mapping_status,
  a.source_fact_names_json,
  a.rejection_reason,
  a.applicability_reason,
  a.rejection_code,
  a.applicability_code
FROM {{results}}.product_attribute a
JOIN {{results}}.product_enrichment e ON e.ean = a.ean AND e.run_id = a.run_id
WHERE a.ean = :ean::text AND LENGTH(:refresh_token::text) >= 0
ORDER BY a.required DESC, a.attribute_name
