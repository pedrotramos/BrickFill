-- BrickFill adapter "mock": canonical v_attribute_options (the allowed values of each attribute).
SELECT CAST(attribute_code AS STRING) AS attribute_id,
       CAST(option_code AS STRING) AS option_id,
       option_text AS option_value,
       CAST(option_code AS INT) AS sort_order,
       TRUE AS is_active
FROM {{source}}.erp_attribute_option
