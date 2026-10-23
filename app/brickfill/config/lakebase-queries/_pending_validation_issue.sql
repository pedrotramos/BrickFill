-- Empty stand-in for {{results}}.validation_issue until the enrichment job creates its results schema (a fresh
-- install). Same columns and types as lakebase_load.ISSUE_COLUMNS (tests/test_lakebase_sql.py keeps them in sync).
SELECT
  NULL::text AS run_id,
  NULL::text AS ean,
  NULL::int AS row_id,
  NULL::text AS issue_code,
  NULL::text AS severity,
  NULL::text AS field,
  NULL::text AS message,
  NULL::timestamp AS created_at,
  NULL::text AS params_json
WHERE FALSE
