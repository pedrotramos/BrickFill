# Databricks notebook source
# MAGIC %md
# MAGIC # 3. Load the results into Lakebase
# MAGIC Copies the latest run of each product from Delta to the Lakebase schema the app reads. Delta keeps the history;
# MAGIC the load is idempotent, so it can be repeated or used as a backfill/repair.
# MAGIC
# MAGIC `load_scope`: `run` (the enrichment job) copies only the products of `run_id`, the run that has just been
# MAGIC written, and nothing when that run enriched no product; `all` (the repair job) copies every enriched product.
# COMMAND ----------

# The job code lives in ../src (synced with the bundle); no wheel is built or installed.
import os
import sys

sys.path.insert(0, os.path.abspath("../src"))

# COMMAND ----------

dbutils.widgets.text("catalog", "")
dbutils.widgets.text("schema", "")
dbutils.widgets.text("lakebase_endpoint", "")
dbutils.widgets.text("lakebase_database", "databricks_postgres")
dbutils.widgets.text("lakebase_results_schema", "enrichment")
dbutils.widgets.text("app_service_principal", "")
dbutils.widgets.dropdown("load_scope", "all", ["all", "run"])
dbutils.widgets.text("run_id", "")

catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
endpoint = dbutils.widgets.get("lakebase_endpoint")
database = dbutils.widgets.get("lakebase_database")
results_schema_name = dbutils.widgets.get("lakebase_results_schema")
app_role = dbutils.widgets.get("app_service_principal")
scope = dbutils.widgets.get("load_scope")
run_id = dbutils.widgets.get("run_id").strip()

# COMMAND ----------

# MAGIC %md
# MAGIC ## Load
# MAGIC Order: create the schema/tables, load the children (attributes, facts, issues), upsert the `product_enrichment`
# MAGIC marker, remove superseded runs, then grant read access to the app role (if it already exists).

# COMMAND ----------

from brickfill.lakebase_load import run

counts = run(
    catalog=catalog,
    schema=schema,
    endpoint=endpoint,
    database=database,
    results_schema_name=results_schema_name,
    app_role=app_role,
    scope=scope,
    run_id=run_id,
)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Result

# COMMAND ----------

display(spark.createDataFrame([(table, count) for table, count in counts.items()], "table string, rows long"))
