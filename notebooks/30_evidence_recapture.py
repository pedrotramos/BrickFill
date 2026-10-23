# Databricks notebook source
# MAGIC %md
# MAGIC # Evidence recapture
# MAGIC Recaptures source screenshots and attribute crops for **one explicit SKU** and up to three attributes of its
# MAGIC latest enrichment (for example after a source page changed, or when a crop came out incomplete).
# MAGIC It never re-runs the AI, never publishes and never processes the whole catalog; `max_credits` caps the Firecrawl
# MAGIC spend. The result opens in the app at `/catalog/<EAN>?evidence_run=<run_id>`.
# COMMAND ----------

# The job code lives in ../src (synced with the bundle); no wheel is built or installed.
import os
import sys

sys.path.insert(0, os.path.abspath("../src"))

# COMMAND ----------

dbutils.widgets.text("catalog", "")
dbutils.widgets.text("schema", "")
dbutils.widgets.text("evidence_volume", "brickfill_evidence")
dbutils.widgets.text("secret_catalog", "")
dbutils.widgets.text("secret_schema", "")
dbutils.widgets.text("firecrawl_secret_key", "")
dbutils.widgets.text("ean", "")
dbutils.widgets.text("attribute_codes", "")
dbutils.widgets.dropdown("max_credits", "3", ["1", "2", "3"])

catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
evidence_volume = dbutils.widgets.get("evidence_volume")
secret_catalog = dbutils.widgets.get("secret_catalog")
secret_schema = dbutils.widgets.get("secret_schema")
firecrawl_secret_key = dbutils.widgets.get("firecrawl_secret_key")
ean = dbutils.widgets.get("ean").strip()
attribute_codes = dbutils.widgets.get("attribute_codes")
max_credits = int(dbutils.widgets.get("max_credits"))

# COMMAND ----------

# MAGIC %md
# MAGIC ## Capture

# COMMAND ----------

from brickfill.evidence_recapture import run

summary = run(
    catalog=catalog,
    schema=schema,
    ean=ean,
    attribute_codes=attribute_codes,
    secret_catalog=secret_catalog,
    secret_schema=secret_schema,
    firecrawl_secret_key=firecrawl_secret_key,
    evidence_volume=evidence_volume,
    max_credits=max_credits,
)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Result
# MAGIC Open `audit_path` in the app to see the captures next to the attributes.

# COMMAND ----------

display(
    spark.createDataFrame(
        [(code, ", ".join(statuses)) for code, statuses in summary["statuses"].items()],
        "attribute_code string, capture_status string",
    )
)
