# Databricks notebook source
# MAGIC %md
# MAGIC # Publish approved products
# MAGIC Reads the review decisions and human edits straight from Lakebase and merges the **APPROVED** products
# MAGIC (the approved AI result + active human edits) into the destination Delta table that feeds the e-commerce
# MAGIC channels. An approval holds for the enrichment run the reviewer approved, and edits reopen the review in the app.
# MAGIC Rejecting a product or setting it back to pending removes its row. An approved product without a publishable
# MAGIC result (enriched again after the approval, a failed run, no catalog row) and a reopened one (IN_REVIEW: changed
# MAGIC after the approval) keep their last published version, and the job refuses to empty the destination when it
# MAGIC reads no approval at all.
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
dbutils.widgets.text("lakebase_schema", "brickfill_app")
dbutils.widgets.text("destination_table", "")

catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
endpoint = dbutils.widgets.get("lakebase_endpoint")
database = dbutils.widgets.get("lakebase_database")
lakebase_schema = dbutils.widgets.get("lakebase_schema")
destination_table = dbutils.widgets.get("destination_table")

# COMMAND ----------

# MAGIC %md
# MAGIC ## MERGE statement
# MAGIC `approved_review`, `active_override` and `active_manual_evidence` are temporary views over the app's Lakebase
# MAGIC tables.

# COMMAND ----------

from brickfill.publish import merge_statement

print(merge_statement(f"`{catalog}`.`{schema}`", destination_table))

# COMMAND ----------

# MAGIC %md
# MAGIC ## Publish

# COMMAND ----------

from brickfill.publish import run

run(
    catalog=catalog,
    schema=schema,
    endpoint=endpoint,
    database=database,
    lakebase_schema=lakebase_schema,
    destination_table=destination_table,
)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Result

# COMMAND ----------

from brickfill.prepare import _qualified_table

display(spark.table(_qualified_table(destination_table)).drop("attributes_json"))
