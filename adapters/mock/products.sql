-- BrickFill adapter "mock": canonical v_products over the mock ERP (src/brickfill/mock_data.py).
-- The source placeholder is the catalog.schema holding the erp_* tables (adapter_source_catalog / adapter_source_schema).
SELECT CAST(i.item_code AS STRING) AS product_id,
       i.gtin AS gtin,
       COALESCE(NULLIF(TRIM(t.short_title), ''), TRIM(t.long_title)) AS title,
       NULLIF(TRIM(t.long_title), '') AS title_alt,
       NULLIF(TRIM(i.brand_name), '') AS brand,
       NULLIF(TRIM(i.supplier_name), '') AS supplier,
       CAST(d.department_code AS STRING) AS department_id,
       d.department_name AS department,
       CAST(c.category_code AS STRING) AS category_id,
       c.category_name AS category,
       CAST(s.subcategory_code AS STRING) AS subcategory_id,
       s.subcategory_name AS subcategory,
       i.status <> 'INACTIVE' AS is_active,
       CAST(NULL AS TIMESTAMP) AS source_updated_at
FROM {{source}}.erp_item i
JOIN {{source}}.erp_item_text t ON t.item_code = i.item_code
JOIN {{source}}.erp_subcategory s ON s.subcategory_code = i.subcategory_code
JOIN {{source}}.erp_category c ON c.category_code = s.category_code
JOIN {{source}}.erp_department d ON d.department_code = c.department_code
-- the contract requires a title: items without any title stay out of the catalog
WHERE COALESCE(NULLIF(TRIM(t.short_title), ''), NULLIF(TRIM(t.long_title), '')) IS NOT NULL
