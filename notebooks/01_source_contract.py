# Databricks notebook source
# MAGIC %md
# MAGIC # Source contract
# MAGIC Creates (or refreshes) the three canonical views the enrichment reads, `v_products`, `v_attributes` and
# MAGIC `v_attribute_options`, from an **adapter** (`adapters/<adapter>/*.sql`: one SELECT per view over the retailer's
# MAGIC own tables), then validates them against the BrickFill contract. Every column of the views carries its contract
# MAGIC comment, visible in Catalog Explorer. The Lakebase synced table of the app is created from `v_products`.
# MAGIC
# MAGIC `adapter = none` skips the views (built elsewhere, e.g. with dbt or a pipeline) and only validates them.
# COMMAND ----------

# The job code lives in ../src (synced with the bundle); no wheel is built or installed.
import os
import sys

sys.path.insert(0, os.path.abspath("../src"))
ADAPTERS_DIR = os.path.abspath("../adapters")

# COMMAND ----------

dbutils.widgets.text("adapter", "mock")
dbutils.widgets.text("adapter_source_catalog", "")
dbutils.widgets.text("adapter_source_schema", "")
dbutils.widgets.text("adapter_params", "{}")
dbutils.widgets.text("source_catalog", "")
dbutils.widgets.text("source_schema", "")
dbutils.widgets.dropdown("contract_fail_on", "error", ["error", "warning", "never"])

adapter = dbutils.widgets.get("adapter").strip()
adapter_source_catalog = dbutils.widgets.get("adapter_source_catalog")
adapter_source_schema = dbutils.widgets.get("adapter_source_schema")
adapter_params = dbutils.widgets.get("adapter_params")
source_catalog = dbutils.widgets.get("source_catalog")
source_schema = dbutils.widgets.get("source_schema")
contract_fail_on = dbutils.widgets.get("contract_fail_on")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Create the documented views
# MAGIC The statements printed below are exactly what runs: the adapter's SELECT wrapped with the contract's column
# MAGIC comments, view comment, `TBLPROPERTIES` and type casts.

# COMMAND ----------

from brickfill.source_layer import create_source_views

if adapter != "none":
    statements = create_source_views(
        ADAPTERS_DIR,
        adapter,
        adapter_source_catalog,
        adapter_source_schema,
        source_catalog,
        source_schema,
        adapter_params,
    )
    for statement in statements:
        print(statement, end="\n\n")
else:
    print("adapter=none: validating the existing views only")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Validate the contract
# MAGIC Schema (columns and types), then data: primary keys, NOT NULL columns, GTIN check digits and uniqueness, enums,
# MAGIC orphan options and coverage. Results are appended to `contract_check`; `contract_fail_on` decides when the task fails.

# COMMAND ----------

from brickfill.source_layer import check_contract

results = check_contract(source_catalog, source_schema, adapter, contract_fail_on)
display(spark.createDataFrame(results))
