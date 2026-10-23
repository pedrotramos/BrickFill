# Databricks notebook source
# MAGIC %md
# MAGIC # 1. Prepare
# MAGIC Normalizes the three canonical views (`v_products`, `v_attributes`, `v_attribute_options`) into the working tables
# MAGIC (`product_input`, `attribute_definition`, `attribute_allowed_value`), initializes the output tables and
# MAGIC (re)creates the `product_catalog` and `enrichment_summary` views.
# COMMAND ----------

# The job code lives in ../src (synced with the bundle); no wheel is built or installed.
import os
import sys

sys.path.insert(0, os.path.abspath("../src"))

# COMMAND ----------

dbutils.widgets.text("catalog", "")
dbutils.widgets.text("schema", "")
dbutils.widgets.text("products_table", "")
dbutils.widgets.text("attributes_table", "")
dbutils.widgets.text("attribute_options_table", "")
dbutils.widgets.dropdown("attributes_required_default", "true", ["true", "false"])

catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
products_table = dbutils.widgets.get("products_table")
attributes_table = dbutils.widgets.get("attributes_table")
attribute_options_table = dbutils.widgets.get("attribute_options_table")
attributes_required_default = dbutils.widgets.get("attributes_required_default") == "true"

# COMMAND ----------

# MAGIC %md
# MAGIC ## Normalize and write the working tables
# MAGIC The views are checked against the BrickFill contract first (columns and types). `attributes_required_default`
# MAGIC applies to the attributes whose `is_required` is NULL.

# COMMAND ----------

from brickfill.prepare import run

run(
    catalog=catalog,
    schema=schema,
    products_table=products_table,
    attributes_table=attributes_table,
    attribute_options_table=attribute_options_table,
    attributes_required_default=attributes_required_default,
)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Result

# COMMAND ----------

namespace = f"`{catalog}`.`{schema}`"
display(spark.table(f"{namespace}.product_input").limit(20))
