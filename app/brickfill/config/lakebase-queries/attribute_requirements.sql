-- @param subcategory_id TEXT
-- Attributes of one subcategory: what the source says (synced by the load job) and the team's choice, if any. A
-- choice whose attribute left the source is still listed (in_source = false), so it can be reviewed or cleared.
SELECT COALESCE(s.subcategory_id, o.subcategory_id) AS subcategory_id,
       COALESCE(s.attribute_id, o.attribute_id) AS attribute_id,
       s.attribute_name,
       s.source_required,
       s.required AS source_effective_required,
       o.required AS override_required,
       COALESCE(o.revision, 0) AS revision,
       o.updated_by,
       o.updated_at,
       (s.attribute_id IS NOT NULL) AS in_source,
       s.sort_order,
       s.synced_at
FROM (SELECT * FROM {{results}}.attribute_requirement_source WHERE subcategory_id = :subcategory_id) s
FULL OUTER JOIN (
  SELECT * FROM {{app}}.attribute_requirement_override WHERE subcategory_id = :subcategory_id
) o ON s.attribute_id = o.attribute_id
ORDER BY in_source DESC, s.sort_order NULLS LAST, s.attribute_name, attribute_id
