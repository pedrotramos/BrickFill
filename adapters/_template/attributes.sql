-- BrickFill adapter template: canonical v_attributes (one row per attribute and subcategory where it applies).
SELECT
  CAST(NULL AS STRING)  AS attribute_id,          -- TODO NOT NULL. Attribute id
  CAST(NULL AS STRING)  AS attribute_name,        -- TODO NOT NULL. Display name, in the catalog language
  CAST(NULL AS STRING)  AS attribute_description, -- optional. Guidance for the model and the reviewers
  CAST(NULL AS STRING)  AS subcategory_id,        -- TODO NOT NULL. v_products.subcategory_id where it applies
  CAST(NULL AS STRING)  AS category_id,           -- optional (readability)
  CAST(NULL AS STRING)  AS subcategory,           -- optional (readability)
  CAST(NULL AS BOOLEAN) AS is_required,           -- optional. e.g. CASE flag WHEN 'Y' THEN TRUE WHEN 'N' THEN FALSE END
  CAST(NULL AS STRING)  AS value_type,            -- optional. text | number | boolean | date (NULL = text)
  CAST(NULL AS STRING)  AS unit,                  -- optional. Unit of numeric values (cm, g, W, in)
  CAST(NULL AS STRING)  AS attribute_role,        -- optional. brand | manufacturer | supplier | model | color | size | taxonomy | other
  CAST(NULL AS BOOLEAN) AS allows_free_text,      -- optional. TRUE: options are suggestions, not a closed list
  CAST(NULL AS INT)     AS sort_order             -- optional. Display order
FROM {{source}}.your_attributes_table             -- TODO
