-- BrickFill adapter template: canonical v_attribute_options (allowed values of each attribute).
SELECT
  CAST(NULL AS STRING)  AS attribute_id,  -- TODO NOT NULL. v_attributes.attribute_id
  CAST(NULL AS STRING)  AS option_id,     -- TODO NOT NULL. Option id
  CAST(NULL AS STRING)  AS option_value,  -- TODO NOT NULL. Value exactly as it must be published
  CAST(NULL AS INT)     AS sort_order,    -- optional
  CAST(NULL AS BOOLEAN) AS is_active      -- optional. FALSE retires the option; NULL counts as TRUE
FROM {{source}}.your_options_table        -- TODO
