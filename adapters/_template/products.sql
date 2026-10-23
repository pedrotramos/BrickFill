-- BrickFill adapter template: canonical v_products. Copy adapters/_template to adapters/<your_adapter>/ and edit.
-- Return every canonical column, with these exact names (order does not matter; extra columns are dropped).
-- Placeholders: source (the quoted adapter_source_catalog.adapter_source_schema) and every key of adapter_params (JSON),
-- each written as a name between double braces.
-- Rules that a view cannot declare are checked by the contract job: see adapters/README.md.
SELECT
  CAST(NULL AS STRING)    AS product_id,         -- TODO NOT NULL. Stable internal item id (SKU). Primary key
  CAST(NULL AS STRING)    AS gtin,               -- TODO NOT NULL. GTIN-8/12/13/14, digits only, unique
  CAST(NULL AS STRING)    AS title,              -- TODO NOT NULL. Best title; resolve fallbacks here (COALESCE)
  CAST(NULL AS STRING)    AS title_alt,          -- optional. Secondary or long title
  CAST(NULL AS STRING)    AS brand,              -- optional. NULL: the agent discovers the brand
  CAST(NULL AS STRING)    AS supplier,           -- optional. Supplier or vendor name
  CAST(NULL AS STRING)    AS department_id,      -- optional. Top taxonomy level id
  CAST(NULL AS STRING)    AS department,         -- optional. Top taxonomy level name
  CAST(NULL AS STRING)    AS category_id,        -- TODO NOT NULL. Category id
  CAST(NULL AS STRING)    AS category,           -- TODO NOT NULL. Category name
  CAST(NULL AS STRING)    AS subcategory_id,     -- TODO NOT NULL. Leaf id (repeat the category with 2 levels)
  CAST(NULL AS STRING)    AS subcategory,        -- TODO NOT NULL. Leaf name
  CAST(NULL AS BOOLEAN)   AS is_active,          -- optional. FALSE excludes the item; NULL counts as TRUE
  CAST(NULL AS TIMESTAMP) AS source_updated_at   -- optional. Last change in the source
FROM {{source}}.your_items_table                 -- TODO
