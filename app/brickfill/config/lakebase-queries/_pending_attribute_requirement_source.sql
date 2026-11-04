-- Empty stand-in for {{results}}.attribute_requirement_source until the load job first syncs the attribute
-- requirements. Same columns and types as lakebase_load.REQUIREMENT_COLUMNS (tests/test_lakebase_sql.py keeps them in
-- sync), plus synced_at.
SELECT
  NULL::text AS subcategory_id,
  NULL::text AS attribute_id,
  NULL::text AS attribute_name,
  NULL::text AS category_id,
  NULL::text AS subcategory,
  NULL::boolean AS source_required,
  NULL::boolean AS required,
  NULL::int AS sort_order,
  NULL::timestamptz AS synced_at
WHERE FALSE
