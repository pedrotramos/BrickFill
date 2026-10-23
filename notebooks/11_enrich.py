# Databricks notebook source
# MAGIC %md
# MAGIC # 2. Enrich
# MAGIC For each SKU: discovers sources (Firecrawl search, or `system.ai.web_search` when `use_native_web_search` is
# MAGIC `true`; it does not exist in Azure workspaces), extracts evidence with Firecrawl, asks the model for
# MAGIC attribute values, validates them deterministically and archives screenshots/crops in the evidence Volume.
# MAGIC Every value needs evidence or is stored as missing. The content language, profile and market come from the job
# MAGIC parameters, overridden by what the team saved on the app's Settings screen (globally or per category).
# COMMAND ----------

# The job code lives in ../src (synced with the bundle); no wheel is built or installed.
import os
import sys

sys.path.insert(0, os.path.abspath("../src"))

# COMMAND ----------

dbutils.widgets.text("catalog", "")
dbutils.widgets.text("schema", "")
dbutils.widgets.text("model_endpoint", "")
dbutils.widgets.text("secret_catalog", "")
dbutils.widgets.text("secret_schema", "")
dbutils.widgets.text("firecrawl_secret_key", "")
dbutils.widgets.text("firecrawl_mcp_url", "")
dbutils.widgets.text("use_native_web_search", "false")
dbutils.widgets.text("max_products", "0")
dbutils.widgets.text("concurrency", "2")
dbutils.widgets.text("firecrawl_concurrency", "2")
dbutils.widgets.text("ean", "")
dbutils.widgets.text("evidence_volume", "brickfill_evidence")
dbutils.widgets.text("reviewers", "0")
dbutils.widgets.text("products_per_reviewer", "0")
dbutils.widgets.text("lakebase_endpoint", "")
dbutils.widgets.text("lakebase_database", "databricks_postgres")
dbutils.widgets.text("lakebase_schema", "brickfill_app")
dbutils.widgets.text("content_language", "en")
dbutils.widgets.text("catalog_language", "")
dbutils.widgets.text("content_profile", "default")
dbutils.widgets.text("market", "")

catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
model_endpoint = dbutils.widgets.get("model_endpoint")
secret_catalog = dbutils.widgets.get("secret_catalog")
secret_schema = dbutils.widgets.get("secret_schema")
firecrawl_secret_key = dbutils.widgets.get("firecrawl_secret_key")
firecrawl_mcp_url = dbutils.widgets.get("firecrawl_mcp_url")
use_native_web_search = dbutils.widgets.get("use_native_web_search").strip().lower() == "true"
max_products = int(dbutils.widgets.get("max_products"))
concurrency = int(dbutils.widgets.get("concurrency"))
firecrawl_concurrency = int(dbutils.widgets.get("firecrawl_concurrency"))
ean = dbutils.widgets.get("ean").strip()
evidence_volume = dbutils.widgets.get("evidence_volume")
reviewers = int(dbutils.widgets.get("reviewers"))
products_per_reviewer = int(dbutils.widgets.get("products_per_reviewer"))
lakebase_endpoint = dbutils.widgets.get("lakebase_endpoint")
lakebase_database = dbutils.widgets.get("lakebase_database")
lakebase_schema = dbutils.widgets.get("lakebase_schema")
content_language = dbutils.widgets.get("content_language").strip() or "en"
catalog_language = dbutils.widgets.get("catalog_language").strip()
content_profile = dbutils.widgets.get("content_profile").strip() or "default"
market = dbutils.widgets.get("market").strip().upper()

namespace = f"`{catalog}`.`{schema}`"

# COMMAND ----------

# MAGIC %md
# MAGIC ## Select the products
# MAGIC - `ean` filled: exactly those EANs (one, or a list separated by `;` or `,`), enriched again even if they already were.
# MAGIC - Otherwise: the products never enriched, grouped by category and subcategory, as many as fit in the review
# MAGIC   queue: `reviewers` x `products_per_reviewer` minus the products not yet approved or rejected in the app, and
# MAGIC   at most `max_products` (0 = no cap). `reviewers` = 0 turns the queue limit off.
# MAGIC
# MAGIC When nothing fits, the notebook stops here: no model call, no Firecrawl credit. The same Lakebase read loads the
# MAGIC settings saved in the app; with an endpoint configured, a failed read fails the run.

# COMMAND ----------

from brickfill.enrich import select_products

# the load task reads this value; it stays empty when the run enriches nothing
dbutils.jobs.taskValues.set(key="run_id", value="")
batch = select_products(
    namespace,
    ean=ean,
    max_products=max_products,
    capacity=reviewers * products_per_reviewer,
    lakebase_endpoint=lakebase_endpoint,
    lakebase_database=lakebase_database,
    lakebase_schema=lakebase_schema,
)
seeds = batch.seeds
print(batch.summary())
display(spark.createDataFrame([seed.model_dump() for seed in seeds]) if seeds else spark.range(0))

# COMMAND ----------

if not seeds:
    dbutils.notebook.exit("No products to enrich: the review queue is full or every product is already enriched")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Settings of each product
# MAGIC Field by field: subcategory > category > department > app settings > job parameters. An unknown language,
# MAGIC profile or market fails here, before any paid request.

# COMMAND ----------

from brickfill.enrich import RulesResolver
from brickfill.settings import JobDefaults

resolver = RulesResolver(batch.settings, JobDefaults(content_language, catalog_language, content_profile, market))
for seed in seeds:
    resolver(seed)
print(f"Settings source: {batch.settings.source}")
display(
    spark.createDataFrame(
        [
            {"settings_hash": h, **{k: str(v) for k, v in entry.items()}}
            for h, entry in resolver.record()["resolved"].items()
        ]
    )
)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Research, validate and capture evidence
# MAGIC This is the step that calls the model and Firecrawl (credits). The Firecrawl key is read from the Unity Catalog secret.

# COMMAND ----------

import uuid
from datetime import datetime, timezone

from brickfill.enrich import research
from brickfill.secrets import firecrawl_api_key

firecrawl_key = firecrawl_api_key(dbutils, catalog=secret_catalog, schema=secret_schema, key=firecrawl_secret_key)
run_id = str(uuid.uuid4())
started_at = datetime.now(timezone.utc).replace(tzinfo=None)

outcomes = research(
    seeds,
    namespace=namespace,
    catalog=catalog,
    schema=schema,
    run_id=run_id,
    model_endpoint=model_endpoint,
    firecrawl_mcp_url=firecrawl_mcp_url,
    firecrawl_key=firecrawl_key,
    evidence_volume=evidence_volume,
    concurrency=concurrency,
    firecrawl_concurrency=firecrawl_concurrency,
    use_native_web_search=use_native_web_search,
    rules_for=resolver,
)
success_count = sum(1 for _seed, result, _issues, _error in outcomes if result)
print(f"Run {run_id}: {success_count}/{len(seeds)} products researched")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Build the rows
# MAGIC One list of rows per output table: facts, attributes, validation issues, visual evidence and the enrichment result.

# COMMAND ----------

from brickfill.enrich import build_rows

rows = build_rows(outcomes, run_id, resolver.by_ean)
print({table: len(table_rows) for table, table_rows in rows.items()})

# COMMAND ----------

# MAGIC %md
# MAGIC ## Write the Delta tables
# MAGIC `product_enrichment` is written last: it is the marker that publishes the run, so consumers never see a run before its details.

# COMMAND ----------

from brickfill.enrich import write_results

write_results(
    namespace,
    rows,
    run_id=run_id,
    started_at=started_at,
    model_endpoint=model_endpoint,
    product_count=len(seeds),
    success_count=success_count,
    settings=resolver.record(),
)
dbutils.jobs.taskValues.set(key="run_id", value=run_id)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Result

# COMMAND ----------

display(spark.table(f"{namespace}.enrichment_run").where(f"run_id = '{run_id}'"))
display(
    spark.table(f"{namespace}.product_enrichment")
    .where(f"run_id = '{run_id}'")
    .select("ean", "generated_title", "content_language", "status", "quality_score")
)
