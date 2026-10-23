-- BrickFill adapter "mock": canonical v_attributes (one row per attribute and subcategory where it applies).
SELECT CAST(a.attribute_code AS STRING) AS attribute_id,
       a.attribute_name AS attribute_name,
       CAST(NULL AS STRING) AS attribute_description,
       CAST(l.subcategory_code AS STRING) AS subcategory_id,
       CAST(s.category_code AS STRING) AS category_id,
       s.subcategory_name AS subcategory,
       CASE l.mandatory_flag WHEN 'Y' THEN TRUE WHEN 'N' THEN FALSE END AS is_required,
       a.value_type AS value_type,
       a.unit AS unit,
       a.role AS attribute_role,
       FALSE AS allows_free_text,
       CAST(a.attribute_code AS INT) AS sort_order
FROM {{source}}.erp_attribute a
JOIN {{source}}.erp_attribute_scope l ON l.attribute_code = a.attribute_code
JOIN {{source}}.erp_subcategory s ON s.subcategory_code = l.subcategory_code
