-- Per subcategory: how many attributes the source lists, how many are required after the team's choices, and how
-- many choices the team made (Attributes screen tree).
SELECT s.subcategory_id,
       COUNT(*)::int AS attribute_count,
       COUNT(*) FILTER (WHERE COALESCE(o.required, s.required))::int AS required_count,
       COUNT(o.required)::int AS override_count
FROM {{results}}.attribute_requirement_source s
LEFT JOIN {{app}}.attribute_requirement_override o
  ON o.subcategory_id = s.subcategory_id AND o.attribute_id = s.attribute_id
GROUP BY s.subcategory_id
