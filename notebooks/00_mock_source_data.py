# Databricks notebook source
# MAGIC %md
# MAGIC # Mock source data (development only)
# MAGIC Writes a fictional retailer's ERP tables (`erp_item`, `erp_item_text`, `erp_department`, `erp_category`,
# MAGIC `erp_subcategory`, `erp_attribute`, `erp_attribute_scope`, `erp_attribute_option`). They are deliberately not in
# MAGIC the canonical shape: the `mock` adapter (`adapters/mock/`) maps them to the BrickFill contract, like a real
# MAGIC retailer's adapter would. Brands are fictional and GTINs use the GS1 restricted-circulation prefix 2.
# COMMAND ----------

# The job code lives in ../src (synced with the bundle); no wheel is built or installed.
import os
import sys

sys.path.insert(0, os.path.abspath("../src"))

# COMMAND ----------

dbutils.widgets.text("adapter_source_catalog", "")
dbutils.widgets.text("adapter_source_schema", "")
dbutils.widgets.text("product_count", "20000")

adapter_source_catalog = dbutils.widgets.get("adapter_source_catalog")
adapter_source_schema = dbutils.widgets.get("adapter_source_schema")
product_count = int(dbutils.widgets.get("product_count"))

# COMMAND ----------

# MAGIC %md
# MAGIC ## Generate and write the ERP tables
# MAGIC The generator is deterministic (fixed seed), so repeating the run rewrites the same data.

# COMMAND ----------

from brickfill.source_layer import write_mock_tables

write_mock_tables(adapter_source_catalog, adapter_source_schema, product_count)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Result

# COMMAND ----------

display(spark.sql(f"SHOW TABLES IN `{adapter_source_catalog}`.`{adapter_source_schema}`"))
