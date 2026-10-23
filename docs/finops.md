# FinOps — BrickFill

What BrickFill costs, how the model choice changes that cost, and how to check the real spend. The document is
cloud-agnostic: it gives the **consumption units** measured in tests (DBUs, tokens, Firecrawl credits, hours) and the
formulas to turn them into money with your own prices.

> **Estimates, not a quote.**
> - **Where the numbers come from:** consumption was measured in `system.billing.usage` and `research_trace` in
>   October 2026, on an AWS workspace (us-west-2), with 3 to 10 products per model, across product categories (pet,
>   building materials, tools).
> - **What sets the real value:** your products, category mix, cloud, region and contract. DBU and token prices
>   differ by cloud and region, and negotiated discounts apply on top.
> - **How to confirm:** check the first month with the queries in section 6 and adjust section 3.

Throughout this document:

```
cost = units consumed × your list price per unit × (1 − your discount)
```

Take list prices from `system.billing.list_prices` (section 6) or your cloud's Databricks pricing page. Take the
discount from your contract; it may differ per product (for example, models served through a partner may carry no
discount).

## 1. What drives cost

| Item | How it's billed (`billing_origin_product`) | Measured consumption | Varies with |
| --- | --- | --- | --- |
| Model (Foundation Model API, `model_endpoint`) | DBUs per input, cached-input and output token (`MODEL_SERVING`) | 75–215 k input and 6–19 k output tokens per product (section 2) | Model and number of products. **The largest share with Sonnet-class and GPT-class models** |
| Firecrawl | Credits of your Firecrawl plan (outside Databricks) | 5–10 credits per product (median 8) | Number of products |
| Serverless jobs | DBUs (`JOBS`, automated serverless compute) | ~0.41 DBU fixed per run + 0.020–0.028 DBU per product (`STANDARD`) | Number of runs and products |
| Databricks App | DBUs while the app is running (`APPS`) | 0.5 DBU per hour | Fixed: hours the app is on (~730 h/month if 24/7) |
| Lakebase | DBUs while the compute is awake (`LAKEBASE`, database serverless compute) | ~0.21 DBU per CU-hour, scaling between 0.5 and 16 CU with the load; suspends after 30 min without connections | Fixed: review hours plus job runs; reviewers at once and Lakebase loads raise the CU |
| Synced table | DBUs of the snapshot pipeline (`LAKEFLOW_CONNECT` / `DLT`) | Only when refreshed | Catalog refresh frequency |
| Evidence Volume | Cloud object storage | ~3–5 GB of screenshots per 1,000 products | Products enriched; cents per month |

**Source discovery.** `system.ai.web_search` is not available in every cloud. By default
(`use_native_web_search: "false"`), discovery uses Firecrawl search, already included in the credits above. With
`"true"`, discovery is billed as `MODEL_SERVING`.

**Where the cost is:**
- With Sonnet-class and GPT-class models, the variable cost per product is almost all model.
- With Haiku, the serverless job and Firecrawl weigh as much as the model.
- `model_endpoint` is the main cost decision of the project.

## 2. Cost per product, by model

- **Tokens:** from each result's `research_trace`, on real products.
- **Quality:** the share of required attributes that arrived filled and with evidence, in the same sample.

The sample is small: use the table as an order of magnitude.

| Model | `model_endpoint` | Tokens per product (input / output; % cached) | Required attributes filled |
| --- | --- | --- | --- |
| Claude Sonnet 4.6 (default) | `databricks-claude-sonnet-4-6` | 139–172 k / 17–19 k; 48–55% | ~71% |
| Claude Sonnet 5.5 | `databricks-claude-sonnet-5-5` | 215 k / 14.5 k; 27% | ~69% |
| GPT 6.1 Sol | `databricks-gpt-6-1-sol` | 153 k / 6.0 k; 69% | ~64% |
| Claude Haiku 5.5 | `databricks-claude-haiku-5-5` | 74–160 k / 14–18 k; 37–58% | ~64% |

For Sonnet 4.6, the token range runs from cost per product attempted to cost per product completed: failed products
also consume tokens.

**Illustrative model cost per product** at the AWS us-west-2 list prices billed in the tests (October 2026). This is
**not** your price: check your cloud, region and contract.

| Model | Price per million tokens (input / output / cached input) | Model cost per product | 1,000 products |
| --- | --- | --- | --- |
| Claude Sonnet 4.6 | US$ 3 / 15 / 0.30 | US$ 0.55–0.68 | US$ 550–680 |
| Claude Sonnet 5.5 | US$ 2 / 10 / 0.20 | US$ 0.57 | US$ 570 |
| GPT 6.1 Sol | US$ 2 / 10 / 0.10 | US$ 0.21 | US$ 210 |
| Claude Haiku 5.5 | US$ 0.10 / 0.50 / 0.01 | US$ 0.015–0.020 | US$ 15–20 |

How to estimate the model cost from tokens:

```
model cost = products × (uncached input × input price
                         + cache writes × 1.25 × input price      (Claude only)
                         + cached input × cached price
                         + output × output price) × (1 − discount)
```

where uncached input = input − cached input − cache writes.

- **Cache writes:** results enriched before October 2026 don't record them (`cache_write_input_tokens`). For those,
  billing ran 10–25% above the formula without that term, which is why the table above uses billing.
- **Repeated calls:** a truncated or invalid answer costs a repair, which regenerates the whole JSON. The repair is
  constrained to the schema when the endpoint supports it (`research_trace.structured_output`), so one repair is
  always enough.
- **Evidence follow-up:** when the answer leaves candidates without evidence, one short extra call asks for their
  facts (`research_trace.follow_up_facts`). It reads the prompt cache and calls no Firecrawl tool.

Query 6.3 is for tracking the daily trend.
- **Prices:** the per-million-token prices come from Databricks' DBU-per-token table times your price per DBU. Check
  both before changing models.

### Serverless jobs: standard and performance optimized

Each enrichment run has two cost parts:
- **fixed:** preparation, model check, writes and the Lakebase load;
- **per product.**

DBUs don't change across clouds; only the price per DBU does. Measured in the tests:

| | `STANDARD` (bundle default) | `PERFORMANCE_OPTIMIZED` |
| --- | --- | --- |
| Fixed DBUs per run | ~0.41 | ~0.61 |
| DBUs per product | 0.020–0.028 | ~1.5–2× standard |
| Wait before enriching starts | 10–15 min | ~1.5 min |

Job DBUs per product, by the number of products in the run:

| Products in the run | `STANDARD` | `PERFORMANCE_OPTIMIZED` |
| --- | --- | --- |
| 1 (reprocess by GTIN) | ~0.43 | ~0.48–0.79 |
| 10 | ~0.061–0.069 | ~0.09–0.11 |
| **25 (1 reviewer)** | **~0.036–0.044** | ~0.055–0.07 |
| 50 | ~0.028–0.036 | ~0.04–0.06 |

Multiply by your price per `JOBS` DBU.
- **Same work, half the cost.** With the same product, prompt and model, performance optimized used twice the DBUs
  of standard (0.78 against 0.39) and finished ~5 min earlier.
- **Full queue.** On days when the review queue is full, the run ends without calling the model and uses ~0.3 DBU in
  standard.

The jobs stay in `STANDARD`. For an urgent reprocess, switch the mode for that run only, without changing the bundle:

```bash
databricks jobs run-now --json '{"job_id": <job_id>, "performance_target": "PERFORMANCE_OPTIMIZED",
  "job_parameters": {"ean": "<GTIN>"}}' --profile <PROFILE>
```

### Total for 1,000 products

Standard jobs, batches of 25 products:

| Component | Units for 1,000 products |
| --- | --- |
| Model | Tokens from section 2 × 1,000 (illustrative: US$ 15–20 for Haiku 5.5 up to US$ 550–680 for Sonnet 4.6) |
| Serverless jobs | ~36–44 `JOBS` DBUs |
| Firecrawl | 5–10 k credits |
| Evidence storage | ~3–5 GB |

The app and Lakebase are fixed monthly costs, outside this count (section 3).

**Firecrawl credits per product:** 5–10, median 8, highest observed 13.
- 2 discovery searches, at 2 credits each;
- 1–6 scrapes and captures;
- sometimes one agent search, when the pages found aren't useful.

Size your Firecrawl plan from monthly products × ~8 credits, plus margin. Pay-as-you-go top-ups usually cost more per
credit than a plan.

## 3. Monthly cost by review-team size

The job enriches per day what the team can review. With 25 products per reviewer per day and 21 working days, each
reviewer receives **525 products per month**, in one run per working day.

| Reviewers | Products per month | Model tokens per month (Sonnet 4.6, input / output) | Job DBUs per month | Firecrawl credits per month |
| --- | --- | --- | --- | --- |
| 1 | 525 | ~73–90 M / ~9–10 M | ~19–23 | 2.6–5.3 k |
| 3 | 1,575 | ~219–271 M / ~27–30 M | ~40–54 | 7.9–16 k |
| 5 | 2,625 | ~365–452 M / ~45–50 M | ~62–82 | 13–26 k |
| 10 | 5,250 | ~730–903 M / ~89–100 M | ~113–155 | 26–53 k |

For other models, scale the token columns with section 2. The model cost per month is roughly the per-product cost
from section 2 × products per month.

Add the fixed costs to each row:
- **App:** 0.5 DBU per hour.
  - Running 24/7, that is ~365 `APPS` DBUs per month.
  - Running only 12 h per working day, it is ~126 DBUs (~65% less), with a scheduled job that runs
    `databricks apps stop` at night and `databricks apps start` in the morning. The app takes a few minutes to start,
    and the bundle doesn't automate this.
- **Lakebase:** ~0.21 DBU per CU-hour while awake.
  - The compute autoscales between `lakebase_min_cu` (0.5) and `lakebase_max_cu` (16): a few reviewers keep it near
    the minimum (~0.1 DBU per hour), and more reviewers at once or a large Lakebase load scale it up for as long as
    the load lasts. Lower `lakebase_max_cu` to cap the spend.
  - The bundle sets the compute to suspend after 30 min without connections (`suspend_timeout_duration: 1800s`).
  - It stays awake while the team reviews (up to ~12 h per working day) and during jobs, plus 30 min after:
    ~12–34 `LAKEBASE` DBUs per month at the minimum, more in the hours it scales up.
  - Awake 24/7 at the minimum it is ~77 DBUs per month. The theoretical ceiling, 16 CU around the clock, is ~2,450.
  - The app closes idle connections after 30 s, so a running app doesn't prevent suspension.

**Batch duration:**
- With 2 simultaneous Firecrawl requests (`firecrawl_concurrency=2`), the job does ~50 products per hour. For
  example, the batch for 5 reviewers (125 products) takes ~2.5 h.
- In standard, the job also waits 10–15 min to start.
- The 12 h timeout fits batches of up to ~500 products.
- Above that, use a Firecrawl plan that accepts more simultaneous requests and raise `firecrawl_concurrency`. This
  cuts the time without changing the model cost or the credits.

## 4. Choosing and changing the model

| Model | Choose it when |
| --- | --- |
| `databricks-claude-sonnet-4-6` (default) | You want the best share of required attributes filled in the tests |
| `databricks-gpt-6-1-sol` | Cost matters more: ~1/3 of the Sonnet 4.6 model cost per product, with fewer required attributes filled (~64% against ~71%). Check its availability and discount terms in your cloud |
| `databricks-claude-sonnet-5-5` | Its tokens cost 1/3 less than 4.6's, but the measured cost per product was similar, because 5.5 used more input and less cache |
| `databricks-claude-haiku-5-5` | Volume over coverage: ~1/35 of the Sonnet 4.6 model cost, with fewer attributes filled |

**Before changing the default,** compare quality in staging on products already approved in production (see
below). Suggested criteria against the current model:
- `quality_score` at most 3 points lower;
- at least 95% of the required attributes filled;
- no increase in `ERROR` issues;
- no value without evidence.

To change:
1. Give the jobs SP `CAN QUERY` on the new endpoint.
2. Set `model_endpoint: <endpoint>` in `targets.prod.variables` of `databricks.yml`.
3. Run `databricks bundle deploy -t prod`.

On the next run, the job checks the endpoint with a minimal call before spending Firecrawl credits. A model that
rejects the call format fails the run in seconds.

To compare two models without changing the default, use staging ([setup guide, 9.6](setup-guide.md#96-staging-environment)),
never production. Reprocessing a product in production creates a new result, and that result is what the app shows
and the publication uses. In staging:
1. Run the job with `--params model_endpoint=<endpoint>,ean=<GTIN1>;<GTIN2>;…` on products already approved in
   production.
2. Per product, compare:
   - the attributes against the values approved in production;
   - the `quality_score`;
   - the `validation_issue` issues;
   - the cost from 6.2 and 6.3.

## 5. Tags and budget policy

Every resource gets the same five tags:

| Tag | Source | Example |
| --- | --- | --- |
| `project` | Fixed | `brickfill` |
| `environment` | Bundle target | `prod` |
| `cost_center` | `tag_cost_center` | `CC-1234` |
| `owner` | `tag_owner` | `catalog-ecommerce` |
| `business_unit` | `tag_business_unit` | `retail` |

| Resource | Billing product (`billing_origin_product`) | How it's attributed |
| --- | --- | --- |
| Jobs (source contract, enrichment, recapture, Lakebase load, publication) | `JOBS` | Job tags (`presets.tags`) and `budget_policy_id` |
| Databricks App | `APPS` | `budget_policy_id` |
| Lakebase project | `LAKEBASE` | Project `custom_tags` and `budget_policy_id` |
| Synced-table pipeline | `LAKEFLOW_CONNECT` / `DLT` | `new_pipeline_spec.budget_policy_id` |
| Foundation Model | `MODEL_SERVING` | The calling identity: the jobs SP (`identity_metadata.run_as`) and the endpoint (`usage_metadata.endpoint_name`) |

On serverless, the tags that reach `system.billing.usage.custom_tags` come from the **budget policy**. So the policy
must carry the same tags and be referenced in `budget_policy_id`.

Creating the policy (admin):
1. **Settings → Compute → Serverless budget policies → Create**, named `brickfill-prod`.
2. Add the five tags above.
3. In **Permissions**, give *User* to the jobs SP, the CI SP and `admins_group`.
4. Copy the policy ID to `budget_policy_id` in both bundles and run `bundle deploy -t prod`.

## 6. Checking the cost

`system.billing.usage` arrives with a delay of a few hours (~3 h). Check a batch's cost the next day.

The queries start from list prices (`system.billing.list_prices`). The `discount` expression holds your contract
discount per SKU family (the first matching `WHEN` wins); leave it at `0.0` to see list cost.

In the first month:
- check the SKU names in your workspace with `SELECT DISTINCT sku_name FROM system.billing.usage`, and adjust the
  `RLIKE` patterns;
- compare the totals with your invoices. Usage billed by Databricks and usage billed through a cloud marketplace may
  arrive on separate invoices.

### 6.1 Monthly cost per billing product

```sql
WITH priced AS (
  SELECT u.*, p.pricing.effective_list.default AS list_price,
         CASE                                   -- your contract discount per SKU family
           WHEN u.sku_name RLIKE 'OPENAI|GEMINI' THEN 0.0
           ELSE 0.0
         END AS discount
  FROM system.billing.usage u
  JOIN system.billing.list_prices p
    ON u.sku_name = p.sku_name AND u.cloud = p.cloud
   AND u.usage_end_time >= p.price_start_time
   AND (p.price_end_time IS NULL OR u.usage_end_time < p.price_end_time)
  WHERE u.custom_tags['project'] = 'brickfill'
    AND u.custom_tags['environment'] = 'prod'
)
SELECT date_trunc('month', usage_date) AS month,
       billing_origin_product,
       ROUND(SUM(usage_quantity * list_price), 2) AS list_cost_usd,
       ROUND(SUM(usage_quantity * list_price * (1 - discount)), 2) AS net_cost_usd
FROM priced
GROUP BY ALL
ORDER BY month DESC, net_cost_usd DESC;
```

### 6.2 Model cost per endpoint

The Foundation Model is billed to the calling identity, not to the job, so filter by the jobs SP. The price per DBU of
each model comes from `list_prices`:

```sql
SELECT u.usage_date AS day,
       u.usage_metadata.endpoint_name AS endpoint,
       ROUND(SUM(u.usage_quantity * p.pricing.effective_list.default), 2) AS list_cost_usd,
       ROUND(SUM(u.usage_quantity * p.pricing.effective_list.default
                 * (1 - CASE                    -- same discount expression as 6.1
                          WHEN u.sku_name RLIKE 'OPENAI|GEMINI' THEN 0.0
                          ELSE 0.0
                        END)), 2) AS net_cost_usd
FROM system.billing.usage u
JOIN system.billing.list_prices p
  ON u.sku_name = p.sku_name AND u.cloud = p.cloud
 AND u.usage_end_time >= p.price_start_time
 AND (p.price_end_time IS NULL OR u.usage_end_time < p.price_end_time)
WHERE u.billing_origin_product = 'MODEL_SERVING'
  AND u.identity_metadata.run_as = '<jobs_sp_application_id>'
  AND u.usage_date >= current_date() - INTERVAL 30 DAYS
GROUP BY ALL
ORDER BY day DESC, net_cost_usd DESC;
```

### 6.3 Estimated cost per product, from the results

Each result stores in `result_json:research_trace`:
- the model and the number of calls;
- the input, cached, cache-write and output tokens;
- the Firecrawl credits.

The query below computes the cost per model and per day without waiting for billing. Keep the `prices` table at
**your** price per million tokens, and set `discount` for your contract.

```sql
WITH prices(endpoint, input, cached, output, discount) AS (
  VALUES ('databricks-claude-sonnet-4-6', 0.0, 0.0, 0.0, 0.0),   -- fill: US$ per million tokens
         ('databricks-claude-sonnet-5-5', 0.0, 0.0, 0.0, 0.0),
         ('databricks-claude-haiku-5-5', 0.0, 0.0, 0.0, 0.0),
         ('databricks-gpt-6-1-sol', 0.0, 0.0, 0.0, 0.0)
), products AS (
  SELECT date(created_at) AS day,
         result_json:research_trace.model_endpoint::string AS endpoint,
         result_json:research_trace.input_tokens::bigint AS input_tokens,
         result_json:research_trace.cached_input_tokens::bigint AS cached_tokens,
         COALESCE(result_json:research_trace.cache_write_input_tokens::bigint, 0) AS cache_writes,
         result_json:research_trace.output_tokens::bigint AS output_tokens,
         result_json:research_trace.firecrawl_credits::int AS credits
  FROM <catalog>.<schema>.product_enrichment
  WHERE result_json:research_trace.model_calls IS NOT NULL
)
SELECT p.day, p.endpoint, COUNT(*) AS products,
       ROUND(SUM(((p.input_tokens - p.cached_tokens - p.cache_writes) * c.input + p.cache_writes * 1.25 * c.input
                  + p.cached_tokens * c.cached + p.output_tokens * c.output) / 1e6 * (1 - c.discount)), 2)
         AS model_cost_usd,
       ROUND(SUM(((p.input_tokens - p.cached_tokens - p.cache_writes) * c.input + p.cache_writes * 1.25 * c.input
                  + p.cached_tokens * c.cached + p.output_tokens * c.output) / 1e6 * (1 - c.discount)) / COUNT(*), 3)
         AS usd_per_product,
       SUM(p.credits) AS firecrawl_credits
FROM products p LEFT JOIN prices c ON p.endpoint = c.endpoint
GROUP BY ALL
ORDER BY p.day DESC;
```

In the tests, this estimate came out 10–25% below 6.2, because Claude cache writes and repeated calls are not counted
here (section 2). A larger gap means the `prices` table is out of date.

### 6.4 Cost per job over the last 30 days

```sql
SELECT u.usage_metadata.job_id, j.name,
       ROUND(SUM(u.usage_quantity * p.pricing.effective_list.default), 2) AS list_cost_usd,
       ROUND(SUM(u.usage_quantity * p.pricing.effective_list.default) * (1 - <discount>), 2) AS net_cost_usd
FROM system.billing.usage u
JOIN system.billing.list_prices p
  ON u.sku_name = p.sku_name AND u.cloud = p.cloud
 AND u.usage_end_time >= p.price_start_time
 AND (p.price_end_time IS NULL OR u.usage_end_time < p.price_end_time)
LEFT JOIN (
  SELECT job_id, name FROM system.lakeflow.jobs
  QUALIFY ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY change_time DESC) = 1
) j ON j.job_id = u.usage_metadata.job_id
WHERE u.custom_tags['project'] = 'brickfill' AND u.usage_metadata.job_id IS NOT NULL
  AND u.usage_date >= current_date() - INTERVAL 30 DAYS
GROUP BY ALL
ORDER BY net_cost_usd DESC;
```

The next query gives the cost of each enrichment run, with its mode (`STANDARD` or `PERFORMANCE_OPTIMIZED`), duration
and cost per product. Use the `job_id` of `[prod] BrickFill · Enrichment`.

```sql
WITH runs AS (
  SELECT run_id AS job_run_id, MIN(period_start_time) AS started, MAX(period_end_time) AS ended
  FROM system.lakeflow.job_run_timeline
  WHERE job_id = '<enrichment_job_id>'
  GROUP BY run_id
), cost AS (
  SELECT u.usage_metadata.job_run_id AS job_run_id,
         u.product_features.performance_target AS mode,
         SUM(u.usage_quantity) AS dbus,
         SUM(u.usage_quantity * p.pricing.effective_list.default) AS list_cost_usd
  FROM system.billing.usage u
  JOIN system.billing.list_prices p
    ON u.sku_name = p.sku_name AND u.cloud = p.cloud
   AND u.usage_end_time >= p.price_start_time
   AND (p.price_end_time IS NULL OR u.usage_end_time < p.price_end_time)
  WHERE u.usage_metadata.job_id = '<enrichment_job_id>'
  GROUP BY ALL
)
SELECT r.started, c.mode,
       ROUND(timestampdiff(SECOND, r.started, r.ended) / 60, 1) AS minutes,
       e.product_count AS products,
       ROUND(c.dbus, 3) AS dbus,
       ROUND(c.list_cost_usd * (1 - <discount>), 3) AS net_cost_usd,
       ROUND(c.list_cost_usd * (1 - <discount>) / NULLIF(e.product_count, 0), 4) AS net_usd_per_product
FROM runs r
JOIN cost c USING (job_run_id)
LEFT JOIN <catalog>.<schema>.enrichment_run e ON e.started_at BETWEEN r.started AND r.ended
ORDER BY r.started DESC;
```

A run without `products` is a day with a full review queue, or a run that failed before researching.

### 6.5 Foundation Model tokens per day

```sql
SELECT date_trunc('day', request_time) AS day,
       SUM(input_token_count) AS input_tokens, SUM(output_token_count) AS output_tokens
FROM system.serving.endpoint_usage
WHERE requester = '<jobs_sp_application_id>'
  AND request_time >= current_date() - INTERVAL 30 DAYS
GROUP BY ALL
ORDER BY day DESC;
```

### 6.6 Untagged usage

This query should return nothing; a row here is a resource created outside the bundle.

```sql
SELECT u.billing_origin_product, u.usage_metadata.job_id, u.usage_metadata.app_name, SUM(u.usage_quantity) AS dbus
FROM system.billing.usage u
WHERE u.usage_date >= current_date() - INTERVAL 7 DAYS
  AND u.custom_tags['project'] IS NULL
  AND (u.usage_metadata.app_name = 'brickfill'
       OR u.usage_metadata.job_id IN (SELECT job_id FROM system.lakeflow.jobs WHERE name LIKE '%BrickFill%'))
GROUP BY ALL;
```

The job names start with `BrickFill ·` (in development mode, prefixed with `[dev <user>]`), hence `LIKE '%BrickFill%'`.

### 6.7 Firecrawl

- Credits per product and per day are in `firecrawl_credits` (6.3).
- The plan balance is in the Firecrawl dashboard (**Usage**).
- A product above ~20 credits is worth a look at its `research_trace`: too many pages extracted, or repeated
  searches.

## 7. Alerts

- **Budget:** in **Account console → Usage → Budgets**, create a monthly budget filtered by the tag
  `project = brickfill`, notifying the `alert_emails` addresses. Size it from the team-size row of section 3, plus the
  app, Lakebase and a 20% margin.
- **Duration:** the enrichment job warns by e-mail after 6 h and stops at 12 h.
- **Dashboard:** the queries of section 6 can feed an AI/BI dashboard.

## 8. Cost levers

| Lever | Effect |
| --- | --- |
| `model_endpoint` | The largest: from ~US$ 0.015 (Haiku) to ~US$ 0.68 (Sonnet 4.6) per product at the illustrative list prices (section 2) |
| `enrichment_reviewers` × `enrichment_products_per_reviewer` | Sets the daily volume. The review queue prevents enriching products nobody will review |
| `max_products` | Hard cap of products per run |
| `use_native_web_search: "false"` (default) | Discovery through Firecrawl search (~4 credits per product), the same path in every cloud |
| `firecrawl_concurrency` | Simultaneous Firecrawl requests (2 on the free plan). Changes only the duration |
| `performance_target: STANDARD` (already applied) | Half the DBUs of performance optimized, with 10–15 min more to start. Switch modes only for urgent reprocessing (section 2) |
| Lean prompt (already applied) | Pages in markdown capped at 30 k characters; only search and scrape tools; missing attributes filled by code; a system prompt that depends only on language, profile and market, so Claude prompt caching holds across a batch |
| Lakebase scale-to-zero (30 min, already applied) | The compute suspends after 30 min without connections, so cost follows review hours, not the clock (section 3) |
| Synced table in `SNAPSHOT` | Costs only when refreshed ([setup guide, 9.5](setup-guide.md#95-keeping-the-synced-table-current)) |
| Stopping the app at night | ~65% of the app's fixed cost (section 3) |
| Evidence recapture with `max_credits` | Caps Firecrawl credits per run |

**Why serverless and not a single-node cluster:**
- The enrichment job spends almost all its time waiting for the model and Firecrawl.
- It uses ~36–44 DBUs per 1,000 products. That is a small fraction of the total with Sonnet-class models, and about
  as much as the model with Haiku.
- A classic cluster would save at most a few dollars per 1,000 products.
- In exchange, it would bring:
  - 4 to 6 min of startup per run;
  - different `node_type_id`s per cloud;
  - a runtime to maintain;
  - the loss of budget-policy attribution.
