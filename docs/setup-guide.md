# Setup guide — BrickFill (production)

This guide provisions BrickFill in a retailer's Databricks workspace. Follow the steps **in order**: each one depends
on the previous one and ends with a check.

When you are done you will have:
- three documented canonical views (`v_products`, `v_attributes`, `v_attribute_options`) built by an adapter over the
  retailer's own tables;
- the enrichment job, with web research by Firecrawl, screenshots and evidence crops;
- the review app, in English, Portuguese or Spanish, with manual evidence and a Settings screen for the enrichment
  language and editorial profile;
- scheduled publication of the approved products to a Delta table.

Everything is tagged for FinOps and runs as a service principal.

You don't edit any Python or TypeScript. What changes from one retailer or environment to another is:
- the variables of the two bundles;
- one adapter: three `SELECT` statements that map the retailer's tables to the contract.

The only secret, the Firecrawl API key, lives in a Unity Catalog secret.

| # | Step | Who | Time |
| --- | --- | --- | --- |
| 1 | [Prerequisites and admin preparation](#1-prerequisites-and-admin-preparation) | Workspace admin | 30 min |
| 2 | [Tools and authentication](#2-tools-and-authentication) | Deployer | 20 min |
| 3 | [Environment variables](#3-environment-variables) | Deployer | 15 min |
| 4 | [Deploy the platform and the jobs](#4-deploy-the-platform-and-the-jobs) | Deployer | 10 min |
| 5 | [Firecrawl key](#5-firecrawl-key) | Admin | 2 min |
| 6 | [Adapter and source contract](#6-adapter-and-source-contract) | Deployer + someone who knows the retailer's data model | 1–4 h |
| 7 | [Pilot and daily batches](#7-pilot-and-daily-batches) | Deployer + review lead | 30 min |
| 8 | [App](#8-app) | Deployer | 20 min |
| 9 | [Publication and operations](#9-publication-and-operations) | Operations | — |
| 10 | [Final check](#10-final-check) | Everyone | 10 min |

## How the pieces fit

```
retailer tables ──► adapter (adapters/<name>/*.sql) ──► Job "BrickFill · Source contract"
 (ERP / PIM, read-only)                                   v_products, v_attributes, v_attribute_options
                                                          (column COMMENTs, contract_check table)
                                                                  │
            ┌─────────────────────────────────────────────────────┤
            ▼                                                     ▼
 Job "BrickFill · Enrichment" (jobs SP, daily batch)    synced table brickfill_serving.products ──┐
  1. prepare                                                                                       │
  2. enrich: Firecrawl search + scrape + model ─► Delta + evidence Volume (screenshots, crops)     │
  3. load_lakebase ─────────────────────────────────────────────────────────► Lakebase (bundle project)
                                                                                                    │
            App "brickfill" (reviewers group) ◄─────────────────────────────────────────────────────┘
             reviews, edits, manual evidence, settings (brickfill_app) ─► manual evidence Volume
                                                                                                    │
 Delta table of approved products ◄── Job "BrickFill · Publish approved" (scheduled, jobs SP) ◄─────┘
  (value + source + evidence of each attribute)
```

## 1. Prerequisites and admin preparation

### 1.1 Workspace

The workspace needs Unity Catalog, serverless Jobs, Databricks Apps and Lakebase enabled, plus:

- **Foundation Model API endpoint** for `model_endpoint` (default `databricks-claude-sonnet-4-6`).
  - The model is most of the cost; compare the options in [docs/finops.md](finops.md#2-cost-per-product-by-model).
  - Outside the regions where the pay-per-token models are served, the account admin must enable **cross-geography
    processing**. Without it the pay-per-token models don't answer, and the job fails at the endpoint check.
- **Managed Web Search** (`system.ai.web_search`): only if you choose `use_native_web_search: "true"`. It is not
  available in every cloud; see the note below.
- **A Firecrawl account** with an API key, used in step 5.
  - The free plan is only good for the pilot.
  - For daily batches, use a plan with enough monthly credits ([FinOps, section 3](finops.md#3-monthly-cost-by-review-team-size)).

> **Source discovery.** By default (`use_native_web_search: "false"`), sources are discovered with Firecrawl's own
> search (`firecrawl_search`), with two queries per product (~4 credits):
> - the GTIN alone;
> - the title words with the GTIN.
>
> The agent can also search (2 credits per search, within its 3 rounds) when the pages it found are not useful. This
> path is the same on AWS, Azure and GCP.
>
> With `market` set, searches and scrapes are localized to that market's country and languages when the Firecrawl
> MCP tools accept those options.
>
> `system.ai.web_search` (`"true"`) is billed as Model Serving. Nothing else changes: extraction, screenshots and
> crops work the same, and only an extracted page becomes evidence.

### 1.2 Identities and groups

Create (or choose) in **Settings → Identity and access**:

| Identity | Purpose | Variable |
| --- | --- | --- |
| Jobs service principal | Runs every job (`run_as`); the only reader of the Firecrawl key | `job_service_principal` (Application ID) |
| Admins group | Manages jobs, app, schema (and the Firecrawl secret) and the Lakebase project | `admins_group` |
| Reviewers group | The only users with access to the app; can view the job runs | `reviewers_group` |
| (Recommended) CI service principal | Deploys from CI/CD instead of a person | — |

### 1.3 Permissions the bundle does not grant

The bundle creates and grants everything it owns: schema, Volumes, Lakebase project and jobs. The admin creates the
Firecrawl secret in step 5.

On objects that already exist in the workspace, the admin grants before the deploy:

```sql
-- Working catalog (existing; the bundle never creates catalogs)
GRANT USE CATALOG, CREATE SCHEMA ON CATALOG <catalog> TO `<deployer>`;
GRANT USE CATALOG ON CATALOG <catalog> TO `<jobs_sp_application_id>`;
-- The retailer's tables the adapter reads (read-only): adapter_source_catalog.adapter_source_schema
GRANT USE CATALOG ON CATALOG <adapter_source_catalog> TO `<jobs_sp_application_id>`;
GRANT USE SCHEMA, SELECT ON SCHEMA <adapter_source_catalog>.<adapter_source_schema> TO `<jobs_sp_application_id>`;
-- If the adapter reads other schemas through adapter_params ({{pim}} etc.), grant those too.
-- If the destination table lives outside the bundle schema:
GRANT USE CATALOG ON CATALOG <destination_catalog> TO `<jobs_sp_application_id>`;
GRANT USE SCHEMA, CREATE TABLE, MODIFY, SELECT ON SCHEMA <destination_catalog>.<destination_schema>
  TO `<jobs_sp_application_id>`;
```

The canonical views are owned by the jobs SP, which created them. Readers of a view, such as the app SP or the
synced-table pipeline, only need `SELECT` on the view, not on the retailer's tables.

The jobs SP also needs:
- `CAN QUERY` on the `model_endpoint` endpoint;
- access to Web Search (`system.ai.web_search`), only if `use_native_web_search: "true"`;
- the **Workspace access** entitlement.

The deployer needs:
- permission to create jobs, apps and Lakebase projects;
- the **Service principal: User** role on the jobs SP, to use `run_as`.

### 1.4 Cost policy (FinOps)

An admin creates a policy for the project in **Settings → Compute → Serverless budget policies**, with the tags
below. They grant its use to the jobs SP, the CI SP and the admins group. Details and cost queries are in
[docs/finops.md](finops.md).

| Tag | Suggested value |
| --- | --- |
| `project` | `brickfill` |
| `environment` | `prod` |
| `cost_center` | retailer's cost center |
| `owner` | owning team |
| `business_unit` | business unit |

Note the policy ID (`budget_policy_id`).

## 2. Tools and authentication

This step starts from a machine with nothing installed. The commands are for a **macOS** or **Linux** terminal
(bash/zsh). On **Windows**, install [WSL](https://learn.microsoft.com/windows/wsl/install): run `wsl --install` in an
administrator PowerShell and reboot. Then open the **Ubuntu** terminal and follow the Linux instructions.

| Tool | Purpose | Required |
| --- | --- | --- |
| Databricks CLI v1.19.0 or later | Authentication, bundle deploys and job runs | Yes |
| [`uv`](https://docs.astral.sh/uv/) | Runs the app grants script (`grant_access`, step 8) and the tests; installs Python itself | Yes |
| Node.js LTS + `npm` | Only to run the app tests or the app locally; Databricks builds the app | No |

### 2.1 Databricks CLI

```bash
# macOS
brew tap databricks/tap && brew install databricks
# Linux / WSL
curl -fsSL https://raw.githubusercontent.com/databricks/setup-cli/main/install.sh | sudo sh

databricks -v          # v1.19.0 or later
```

Both bundles require that minimum version (`databricks_cli_version`); `validate` warns about an older CLI.

### 2.2 uv (and Python)

```bash
# macOS
brew install uv
# Linux / WSL
curl -LsSf https://astral.sh/uv/install.sh | sh     # then open a new terminal

uv --version
```

You don't need to install Python: `uv` downloads a compatible version (3.10 to 3.12) the first time.

### 2.3 Project code

Clone the repository (or unpack the release) and enter the folder:

```bash
git clone <repository_url> brickfill && cd brickfill
uv sync                # installs Python and the uv.lock dependencies into .venv/
uv run pytest -q       # optional: the pipeline's unit tests run locally, without Spark
```

Every command below runs from this folder unless stated otherwise.

### 2.4 Workspace authentication

```bash
databricks auth login --host https://<workspace-host> --profile <PROFILE>
databricks current-user me --profile <PROFILE>
```

`auth login` opens the browser for the retailer's SSO and writes the profile `<PROFILE>` to `~/.databrickscfg`. There
is no token to copy. `current-user me` must show your user. Pass `--profile <PROFILE>` to every command.

In CI, authenticate the CI SP with OAuth M2M: `DATABRICKS_HOST`, `DATABRICKS_CLIENT_ID` and
`DATABRICKS_CLIENT_SECRET`, kept in the CI vault.

## 3. Environment variables

There are two bundles:
- **root bundle `brickfill`** (`databricks.yml`): platform (schema, Volumes, Lakebase project) and jobs;
- **app bundle `brickfill-app`** (`app/brickfill/databricks.yml`): the review app and the synced table.

Each has a `dev` and a `prod` target. Neither pins a workspace: the profile comes from `--profile`, and the values from
one of two places:
- `targets.prod.variables` in each file;
- `.databricks/bundle/<target>/variable-overrides.json`, which is gitignored and keeps retailer values out of the
  repository.

Use the same values in both bundles where the names match. The comments in each `prod` target list the required
variables, and a required variable without a value makes `validate` fail with its name.

**Root bundle** (`databricks.yml` → `targets.prod.variables`):

| Variable | Example / default | Note |
| --- | --- | --- |
| `catalog` | `retail_ai` | Existing catalog; the bundle creates the schema `schema` in it |
| `schema` | default `brickfill` | Created by the bundle. Holds the canonical views, enrichment tables and both Volumes |
| `adapter` | `acme_erp` (default `mock`) | Folder under `adapters/` with the three SQL files (step 6). `none` only validates views built elsewhere |
| `adapter_source_catalog`, `adapter_source_schema` | `erp`, `catalog_silver` (defaults: `catalog`, `brickfill_source`) | The retailer's tables, read-only; `{{source}}` in the adapter SQL |
| `adapter_params` | default `"{}"` | JSON of extra placeholders, e.g. `{"pim":"main.pim"}` |
| `contract_fail_on` | default `error` | When the contract check fails the job: `error`, `warning` or `never` |
| `source_catalog`, `source_schema` | defaults: `catalog`, `schema` | Where the source contract job creates the canonical views |
| `attributes_required_default` | default `"true"` | Applies to attributes whose `is_required` is NULL |
| `content_language` | default `en` | Language of the generated content: `en`, `pt-BR` or `es`. The app's Settings screen can override it |
| `catalog_language` | default empty (same as content) | Language of the retailer's attribute names and vocabularies |
| `content_profile` | default `default` | Editorial profile under `src/brickfill/content/profiles` ([configuration](configuration.md)) |
| `market` | `US` (default empty) | Market pack: `BR`, `ES`, `MX`, `US` or empty |
| `timezone_id` | `America/New_York` (default `UTC`) | Time zone of the enrichment and publish schedules |
| `destination_catalog`, `destination_schema`, `destination_table` | defaults: `catalog`, `schema`, `enriched_products_approved` | Table of approved products |
| `lakebase_project_id` | default `brickfill-<target>` | Lakebase project created by the bundle (`resources/lakebase.yml`) |
| `lakebase_min_cu`, `lakebase_max_cu` | defaults `0.5` and `16` | Autoscaling range of the endpoint (1 CU ≈ 2 GB of RAM); the maximum can be at most 16 above the minimum |
| `job_service_principal` | `1a2b3c4d-…` | Application ID (step 1.2) |
| `app_service_principal` | after the first app deploy (step 8) | The load step grants it read access to new tables |
| `admins_group`, `reviewers_group` | `catalog-admins`, `catalog-reviewers` | Step 1.2 |
| `alert_emails` | `[catalog-ops@example.com]` | List; receives failures and long runs |
| `budget_policy_id` | `a1b2…` | Step 1.4 |
| `tag_cost_center`, `tag_owner`, `tag_business_unit` | | Same values as the policy tags |
| `model_endpoint` | default `databricks-claude-sonnet-4-6` | [FinOps, section 4](finops.md#4-choosing-and-changing-the-model) |
| `use_native_web_search` | default `"false"` | `"false"` uses Firecrawl search; `"true"` uses `system.ai.web_search` (step 1.1) |
| `firecrawl_concurrency` | default `"2"` | Simultaneous Firecrawl requests in the whole run. The free plan accepts 2 |
| `secret_catalog`, `secret_schema`, `firecrawl_secret_key` | defaults: `catalog`, `schema`, `firecrawl_api_key` | Where the Firecrawl secret lives (step 5) |
| `publish_cron` | default `0 0 * * * ?` | Hourly publication, in `timezone_id` |

**App bundle** (`app/brickfill/databricks.yml` → `targets.prod.variables`):

| Variable | Note |
| --- | --- |
| `catalog`, `schema`, `source_catalog`, `source_schema`, `lakebase_project_id` | Same values as the root bundle |
| `admins_group`, `reviewers_group`, `budget_policy_id` | Same values as the root bundle |
| `lakebase_app_schema` | Default `brickfill_app`; must match the root bundle's `lakebase_schema` |
| `content_language`, `catalog_language`, `content_profile`, `market` | Defaults shown in Settings until the team saves app-level settings; keep them equal to the root bundle |
| `settings_editors` | Comma-separated e-mails allowed to change Settings; `none` (default) = every app user (always audited) |
| `ui_default_language` | UI language when the browser's is not supported: `en` (default), `pt-BR` or `es` |
| `brand_customer_name`, `brand_customer_logo_url`, `brand_accent_color` | Optional co-branding: "BrickFill · for &lt;customer&gt;", a logo (https URL or app path) and a `#RRGGBB` accent; `none` (default) = off |

Validate both bundles:

```bash
databricks bundle validate --strict -t prod --profile <PROFILE>
(cd app/brickfill && databricks bundle validate --strict -t prod --profile <PROFILE>)
```

## 4. Deploy the platform and the jobs

```bash
databricks bundle deploy -t prod --profile <PROFILE>
```

The deploy creates:

| Resource | Name | Detail |
| --- | --- | --- |
| Schema | `<catalog>.<schema>` | FinOps tags in `properties`; grants to the jobs SP |
| Volume | `brickfill_evidence` | Screenshots and crops captured by the jobs. Protected against `destroy` |
| Volume | `brickfill_manual_evidence` | Screenshots uploaded by reviewers. Protected against `destroy` |
| Lakebase project | `<lakebase_project_id>` | Created in every target (`resources/lakebase.yml`): branch `production`, endpoint `primary`, database `databricks_postgres`; tags and cost policy. Compute scales between `lakebase_min_cu` and `lakebase_max_cu` and suspends after 30 min without connections. Protected against `destroy` |
| Postgres role | jobs SP | Member of `databricks_superuser` in the project (prod only, `resources/prod_platform.yml`) |
| Jobs | See below | All with tags, cost policy, timeout and e-mail alerts; `run_as` = jobs SP |

| Job | Key (`bundle run`) | Schedule |
| --- | --- | --- |
| BrickFill · Source contract | `brickfill_source_contract` | On demand |
| BrickFill · Enrichment | `brickfill_enrichment` | `enrichment_cron`, paused until step 7.3 |
| BrickFill · Load results to Lakebase | `brickfill_load_lakebase` | On demand (repair) |
| BrickFill · Evidence recapture | `brickfill_evidence_recapture` | On demand |
| BrickFill · Publish approved | `brickfill_publish_approved` | `publish_cron` (active in prod) |

Check:

```bash
databricks bundle summary -t prod --profile <PROFILE>
databricks postgres get-project projects/<lakebase_project_id> --profile <PROFILE>   # status and custom_tags
databricks postgres get-endpoint projects/<lakebase_project_id>/branches/production/endpoints/primary \
  --profile <PROFILE>   # status: autoscaling_limit_min_cu 0.5, autoscaling_limit_max_cu 16, suspend_timeout_duration 1800s
```

The CU range is a default for endpoints the project creates. On a project created before the range existed, or after
changing `lakebase_min_cu`/`lakebase_max_cu`, resize the existing endpoint once:

```bash
databricks postgres update-endpoint projects/<lakebase_project_id>/branches/production/endpoints/primary \
  "spec.autoscaling_limit_min_cu,spec.autoscaling_limit_max_cu" \
  --json '{"spec": {"autoscaling_limit_min_cu": 0.5, "autoscaling_limit_max_cu": 16}}' --profile <PROFILE>
```

> The `IS_OWNER` role of the jobs belongs to the deployer. Always deploy prod with the same identity, ideally the CI
> SP: the bundle keeps its state in that identity's folder.

## 5. Firecrawl key

The key lives in a **Unity Catalog secret** that the admin creates once.
- **Where the jobs look:** by default, `<catalog>.<schema>.firecrawl_api_key`, in the working schema created in
  step 4.
- **Elsewhere:** set `secret_catalog`, `secret_schema` and `firecrawl_secret_key` in the `prod` target and deploy
  again.
- **Why it's manual:** the bundle doesn't create the secret, because that would require the value at deploy time.
  The read grant is manual too, because bundle grants don't accept `READ SECRET` yet.

Steps:
1. In **Catalog Explorer**, open `<catalog>` → `<schema>` and click **Create → Secret**.
2. Name it `firecrawl_api_key`, paste the key into **Value** and save.
   - Use the UI. With the CLI (`secrets-uc create-secret`), the value is an argument and stays in the shell history.
3. Open the secret → **Permissions → Grant** and give **`READ SECRET`** to the **jobs SP** only.
   - Don't grant it to the reviewers group, the app SP or users.
   - The jobs SP already has `USE CATALOG` (step 1.3) and `USE SCHEMA` (step 4).

```bash
databricks secrets-uc list-secrets --catalog-name <catalog> --schema-name <schema> --profile <PROFILE>   # names only, never the value
```

How the key is used:
- The jobs read it at run time with `dbutils.secrets.get(catalog=..., schema=..., key=...)`.
- It goes to Firecrawl only in the `Authorization` header. It never appears in URLs, logs, tables or job
  parameters.
- To rotate it, edit the secret's value in Catalog Explorer.

The app uses no secret: it authenticates as its own service principal.

## 6. Adapter and source contract

BrickFill never reads the retailer's ERP or PIM tables directly. It reads three canonical views with documented
columns, built by an **adapter**:

| View | One row per | Key |
| --- | --- | --- |
| `v_products` | sellable item | `product_id` (`gtin` unique) |
| `v_attributes` | attribute × subcategory where it applies | `attribute_id, subcategory_id` |
| `v_attribute_options` | allowed value of an attribute | `attribute_id, option_id` |

Every column, its type, whether it is nullable and what it means are in the generated
[adapters/README.md](../adapters/README.md). [docs/data-contract.md](data-contract.md) gives an overview.

### 6.1 Write the adapter

1. Copy the template: `cp -r adapters/_template adapters/<your_adapter>` (letters, digits and `_`).
2. In `products.sql`, `attributes.sql` and `attribute_options.sql`, write one `SELECT` each that returns the
   canonical column names.
   - Use `{{source}}` for `adapter_source_catalog`.`adapter_source_schema`, and `{{key}}` for each key of
     `adapter_params`.
   - Resolve in SQL:
     - title fallbacks: `COALESCE(NULLIF(TRIM(erp_title), ''), web_title) AS title`;
     - yes/no flags: `CASE flag WHEN 'Y' THEN TRUE WHEN 'N' THEN FALSE END AS is_required`;
     - code-to-text lookups;
     - inactive items: `is_active`.
3. Filter out items without a GTIN or a title. Those columns are `NOT NULL` in the contract, and a NULL fails the
   check.
4. Set `adapter: <your_adapter>` and `adapter_source_*` in the `prod` target, then deploy.

`adapters/mock/` is a complete example, mapping the fictional ERP of the development mock-data job. If you already
build the three views with dbt or a pipeline, set `adapter: none`: the job then only validates them.

### 6.2 Build and validate the views

```bash
databricks bundle run brickfill_source_contract -t prod --profile <PROFILE>
```

The job:
- wraps each `SELECT` in a view with one `COMMENT` per column, a view comment and `TBLPROPERTIES` (contract version
  and adapter name), plus a `CAST` that pins every type;
- prints the exact statements it ran;
- validates schema and data: primary keys, NOT NULL columns, GTIN check digit and uniqueness, enums, orphan options
  and coverage.

Results are appended to `<source_catalog>.<source_schema>.contract_check`. With `contract_fail_on: error`, any ERROR
fails the job.

Check:

```sql
SELECT COUNT(*) FROM <catalog>.<schema>.v_products;     -- active items with GTIN and title
SELECT COUNT(*) FROM <catalog>.<schema>.v_attributes;
SELECT view, code, severity, failing_rows FROM <catalog>.<schema>.contract_check
WHERE checked_at = (SELECT MAX(checked_at) FROM <catalog>.<schema>.contract_check) AND failing_rows > 0;
```

In Catalog Explorer, the columns of the views show the contract comments.

How the enrichment reads the views:
- `is_active = FALSE` excludes an item;
- a repeated GTIN keeps the first row (the contract check flags it);
- attributes apply per `subcategory_id`;
- an attribute is required when `is_required` is TRUE, or when it is NULL and `attributes_required_default` is
  `"true"`;
- an attribute has a closed vocabulary when it has active options, unless `allows_free_text` is TRUE;
- a NULL `brand` is discovered by the agent, with evidence.

Run the source contract job again whenever the adapter or the retailer's tables change shape.

## 7. Pilot and daily batches

### 7.1 Pilot

Run a few chosen products. Each product spends Firecrawl credits and model tokens.

```bash
databricks bundle run brickfill_enrichment -t prod --profile <PROFILE> --params 'ean=<GTIN1>;<GTIN2>;<GTIN3>'
```

`ean` takes one GTIN or a list.
- Separate the GTINs with `;` in the CLI `--params`, because commas separate parameters.
- With `ean`, the job enriches exactly those products (again, if they were already enriched) and ignores the review
  queue.

The job has three tasks:
1. **`prepare`:** checks the canonical views' schema, normalizes them (`product_input`, `attribute_definition`,
   `attribute_allowed_value`) and creates the app views.
2. **`enrich`:**
   - reads the enrichment settings: Lakebase Settings over the job parameters (see
     [configuration](configuration.md));
   - picks the products, researches them, captures evidence and validates;
   - writes the immutable history to Delta and, to the evidence Volume, the screenshot of every page and the crop of
     every attribute.
   
   It has no retry, because a retry would spend credits again.
3. **`load_lakebase`:** copies the just-enriched products to Lakebase. It retries, because it is idempotent.

Open the run in the workspace: each task is a notebook (`notebooks/`) with the code and output of every step.

Check:

```sql
SELECT ean, status, quality_score, content_language, content_profile
FROM <catalog>.<schema>.product_enrichment ORDER BY created_at DESC LIMIT 5;
SELECT capture_status, COUNT(*) FROM <catalog>.<schema>.product_attribute_evidence GROUP BY 1;
SELECT settings_json FROM <catalog>.<schema>.enrichment_run ORDER BY started_at DESC LIMIT 1;
```

### 7.2 Batch size: how many products per reviewer

The team doesn't review the whole catalog in a day, so the job doesn't enrich everything at once. Each run **tops up
the review queue**:

```
batch = reviewers × products per reviewer − products still awaiting review
```

- **Awaiting review** means enriched products whose latest result is not yet approved or rejected in the app,
  including the ones nobody opened and the ones enriched again after a decision. It is the queue of the app's
  **Next to review** button.
  - When the team falls behind, the next batch is smaller, or zero.
  - The queue never exceeds a day of work, and nothing is spent on products nobody will look at.
- **No product is ever repeated.** Only products never enriched, successfully or not, are selected. To reprocess, use
  `ean` (7.1).
- **Similar batches.** Products come grouped by category and subcategory, so a reviewer goes through products with
  the same attributes in sequence.

**Suggestion: start with 25 products per reviewer per day.** Per product:

| Review part | Attributes | Time |
| --- | --- | --- |
| Check in the crop the values that arrive with evidence | ~9–10 of 14 required | ~20–30 s each, ~4 min |
| Research and attach evidence for empty or candidate values | ~4–5 | ~2 min each, ~8–10 min |
| Title, descriptions and approval | — | ~1 min |
| **Total** | | **~13 min per product** |

With ~5.5 productive review hours a day, that is ~25 products. After two weeks, recalibrate with the real throughput:
products approved or rejected per reviewer per day, in Lakebase (`databricks psql`, or the Lakebase SQL editor).

```sql
SELECT date_trunc('day', created_at AT TIME ZONE '<timezone_id>') AS day, actor AS reviewer,
       COUNT(DISTINCT product_ean) AS products_closed
FROM brickfill_app.audit_event
WHERE event_type = 'REVIEW_UPDATED' AND after_value IN ('APPROVED', 'REJECTED')
  AND created_at >= NOW() - INTERVAL '14 days'
GROUP BY 1, 2
ORDER BY 1 DESC, 3 DESC;
```

Use the median per reviewer as `enrichment_products_per_reviewer`. Queue status:

```sql
-- a decision counts only for the run it was made on
SELECT COALESCE(r.status, 'PENDING') AS status, COUNT(*) AS products
FROM enrichment.product_enrichment e
LEFT JOIN brickfill_app.product_review r ON r.product_ean = e.ean
  AND (r.run_id = e.run_id OR (r.run_id IS NULL AND r.updated_at >= e.created_at AT TIME ZONE 'UTC'))
GROUP BY 1;
```

### 7.3 Turn on the daily batches

Do this after step 8, because the queue is read from the app's reviews. In `targets.prod.variables` of
`databricks.yml`:

| Variable | Default | What it is |
| --- | --- | --- |
| `enrichment_reviewers` | `"1"` | Available reviewers. Update it when the team changes (vacations, reinforcements) |
| `enrichment_products_per_reviewer` | `"25"` | Products one reviewer closes per day (7.2) |
| `enrichment_cron` | `0 0 2 ? * MON-FRI` | 02:00 on weekdays in `timezone_id`: the batch is ready in the morning |
| `enrichment_schedule_status` | `PAUSED` | Set `UNPAUSED` to turn the schedule on |

```bash
databricks bundle deploy -t prod --profile <PROFILE>
```

The schedule ships paused because this is the only job that spends tokens and credits on its own.
- **Logs:** each run writes the capacity, the products awaiting review and the batch size to the `enrich` task log.
- **Full queue:** the run ends in seconds without calling the model or Firecrawl.

For a one-off run with other values:

```bash
databricks bundle run brickfill_enrichment -t prod --profile <PROFILE> --params reviewers=4,products_per_reviewer=25
```

- **Initial backfill without a queue:** `reviewers=0` turns the queue limit off and enriches every product not yet
  enriched.
- **Hard cap:** `max_products` limits the new products of a run (`0` = no cap).
- **Firecrawl free plan:** the job does ~50 products per hour and times out at 12 h, so batches of up to ~500
  products (~20 reviewers).
- **Parallelism:**
  - `concurrency` is how many products are researched at the same time. A product spends most of its time waiting
    for the model, so 10 in parallel don't overload the job.
  - `firecrawl_concurrency` is how many Firecrawl requests stay open across the whole run. Use your plan's limit (2
    on free, more on paid plans). Above it, Firecrawl answers 429, and the job waits and retries.

Monthly cost by team size is in [docs/finops.md](finops.md#3-monthly-cost-by-review-team-size).

### 7.4 How the screenshot shows the value

Before the full-page screenshot, the capture scripts act like a visitor:
1. decline the cookie banner (never accept);
2. open `<details>`, `aria-expanded` accordions and "show more" buttons, in English, Portuguese and Spanish;
3. scroll to the end, to load lazy content.

Menus, links that leave the page, cart, login and tabs are not touched.

If a value is on the page but not in the crop, **focused capture** takes over. Typical causes are a collapsed section
or tab, or a page that changed height during the capture. Focused capture:
- runs a second extraction of the same page: one per page, covering all of its values;
- clicks the page's own control that opens the section (accordion header, tab or `<summary>`), centers the value and
  takes a screenshot of the visible area;
- keeps the window size unchanged, so the text map and the image describe the same layout;
- points the evidence at that screenshot, and records in `coordinates.json` what was clicked (`revealedBy`).

Values that are not in the page text get no focused capture. Pages that answer with an HTTP error (404, 500) are
never cited or captured.

**Capture status:**

| Status | Meaning |
| --- | --- |
| `COMPLETE` | A readable, unambiguous crop of the value (from the full page or the focused capture). |
| `NOT_VISIBLE` | The value is in the page code but not shown to a visitor: only in structured data, a section that doesn't open, or covered content. The reason is in `capture_error`. |
| `NO_MATCH` | The value was not found in the visible text, e.g. the source says "24 months" and the value is "2 years". |
| `AMBIGUOUS` | The value appears in more than one place and the excerpt doesn't identify which. |
| `SCREENSHOT_ONLY` | The page moved during the capture (carousel, banner). |
| `UNSUPPORTED` | The source is a PDF: only the extracted text exists. |

In every case except `COMPLETE`, the reviewer checks the value in the page screenshot or attaches manual evidence
(step 8).

## 8. App

```bash
cd app/brickfill
databricks bundle validate --strict -t prod --profile <PROFILE>
databricks bundle deploy -t prod --profile <PROFILE>          # creates the app, the app SP and the synced table
databricks bundle run grant_access -t prod --profile <PROFILE> # grants the app SP read access to the data (idempotent)
databricks bundle run app -t prod --profile <PROFILE>         # build and start; creates the brickfill_app schema in Lakebase
```

You don't need Node.js: Databricks installs the `package-lock.json` dependencies and builds the app on `bundle run app`.

The deploy creates:
- the app `brickfill`, with `CAN_USE` only for `reviewers_group`;
- `READ_VOLUME` on the jobs' evidence Volume, and `WRITE_VOLUME` only on the manual evidence Volume;
- `CAN_CONNECT_AND_CREATE` on Lakebase;
- the Unity Catalog schema `brickfill_serving` and the synced table `products`, a snapshot of `v_products` in the
  Postgres schema of the same name.

The synced table requires the views from step 6. Follow it until `ONLINE`:

```bash
databricks postgres get-synced-table synced_tables/<catalog>.brickfill_serving.products --profile <PROFILE>
```

The `grant_access` script (`scripts/grant_app_access.py`) gives the app SP read access only: `USAGE` and `SELECT`
on the Lakebase schemas `enrichment` and `brickfill_serving`. The app reads no Unity Catalog table; its Volume access
comes from the app's resources.

If it warns that a Lakebase schema doesn't exist yet, run the job (step 7) or wait for the sync, then repeat the
command. The tables the app writes (`brickfill_app`) need no grant: the app creates and owns them.

Record the app's service principal in the root bundle, so the Lakebase load also grants read access to new tables:

```bash
databricks apps get brickfill --profile <PROFILE>     # field service_principal_client_id
```

Set `app_service_principal: <service_principal_client_id>` in `targets.prod.variables` of `databricks.yml` and run
`databricks bundle deploy -t prod` at the root.

Check: open the app URL (`databricks apps get brickfill` → `url`) as a member of the reviewers group. The catalog
must list the products, and the pilot product's detail must show attributes, evidence and crops.

### 8.1 Languages and co-branding

- **UI languages:** English, Portuguese (Brazil) and Spanish.
  - The app follows the browser language, and each user can switch in the header (the choice is remembered).
  - `ui_default_language` sets the language used when the browser's is not supported.
- **Co-branding:** `brand_customer_name`, `brand_customer_logo_url` and `brand_accent_color` show "BrickFill · for
  &lt;customer&gt;" with the customer's logo and accent color. Leave them empty for plain BrickFill.

### 8.2 Settings

The **Settings** screen sets what the next batches generate:
- the **content language**;
- the catalog language;
- the editorial **profile** and the **market**;
- profile overrides (title and description lengths, required meta description suffixes, FAQ on/off, units, minimum
  image size);
- **per-category overrides** of language and profile.

How changes behave:
- **Effect:** the enrichment job reads the settings once at the start of each batch. Already-enriched products keep
  their language until they are reprocessed with `ean`. The product page shows the language each product was
  enriched in.
- **Concurrency:** saves use optimistic concurrency. If someone else saved first, the app asks to reload.
- **Audit:** every changed field is recorded with its author in the history.
- **Who can edit:** `settings_editors` restricts editing; `none` (the default) means every app user.

Precedence and the full list of fields: [docs/configuration.md](configuration.md).

### 8.3 Manual evidence

In **View audit** on any attribute, the reviewer can **Add evidence**:
- the source URL with the excerpt that proves the value;
- and/or a screenshot (file or Ctrl+V; PNG, JPEG or WebP, up to 10 MB).

Rules:
- **Every value edit needs its own evidence.** Without it, Save stays disabled.
- **The image is validated by its content** and stored with its SHA-256 hash in the name
  (`manual/<GTIN>/<attribute>/<sha256>.<ext>`). Only the app server writes, and nothing is deleted.
- **Removing evidence deactivates it** and records who and when in the audit. An edit's last evidence can only be
  removed after adding another, or by restoring the AI value.

## 9. Publication and operations

### 9.1 Publishing approved products

The `brickfill_publish_approved` job runs hourly (`publish_cron`). It keeps in the destination table the products
**approved** in the app, and only those. To run it now:

```bash
databricks bundle run brickfill_publish_approved -t prod --profile <PROFILE>
```

Each row of `enriched_products_approved` carries:
- `product_id` and `gtin`, department, category and subcategory;
- title, descriptions, brand, model and supplier;
- `content_language`;
- approver, date and review notes;
- `attributes_json`, a list of `{code, name, value, source, evidence}`.

| Field | Values |
| --- | --- |
| `source` | `AI`; `HUMAN` (edited in the app, with evidence); `HUMAN_NO_EVIDENCE` (an edit from before evidence was mandatory; the job log warns); `MISSING` (no proven value) |
| `evidence` | List of `{origin, url, excerpt, screenshot_path, crop_path}`. `origin` is `AI` (enrichment sources and captures) or `HUMAN` (manual evidence) |

Publication rules:
- **Only products rejected or set back to pending leave**, on the run after the status change.
- **Changes wait for a new approval.** An edit or evidence saved after the approval reopens the review
  (`IN_REVIEW`), and a product enriched again needs its new result approved. Meanwhile the last approved version stays
  published. The job log says how many.
- **A source failure deletes nothing.** An approved product without a current result keeps its last published
  version, for example while the views are being refreshed or when the product is missing from `product_input` for a
  day. The job log says how many.
- **An empty read deletes nothing.** If the job finds no approved product in Lakebase while the destination has rows,
  it fails without changing anything (`refusing to delete them`). This guards against a wrong `lakebase_schema` or a
  recreated app schema.
- The table belongs to the job; don't write to it manually.

### 9.2 Evidence recapture

When a source page changes, or a crop comes out incomplete, recapture without redoing the AI research:

```bash
databricks bundle run brickfill_evidence_recapture -t prod --profile <PROFILE> \
  --params 'ean=<GTIN>,attribute_codes=<CODE1>;<CODE2>;<CODE3>,max_credits=3'
```

The log shows `/catalog/<GTIN>?evidence_run=<run_id>`, to check in the app without replacing the published result.

### 9.3 Day-to-day tasks

| Task | What to do |
| --- | --- |
| New products in the catalog | They enter the next daily batches on their own; refresh the synced table (9.5) so the app lists them |
| The number of reviewers changed | Adjust `enrichment_reviewers` (7.3) and deploy |
| Review queue full for days | The job enriches nothing until the team approves or rejects products; check the queue (7.2) |
| Reprocess a product | `bundle run brickfill_enrichment --params ean=<GTIN>`; the new result replaces the old one in the app |
| Switch a category to another language | Settings → category override, then reprocess its products with `ean` if they were already enriched |
| The Lakebase load failed | `bundle run brickfill_load_lakebase` (idempotent) |
| The retailer's tables changed | Update the adapter, deploy and run `brickfill_source_contract`; then refresh the synced table (9.5) |
| Change the destination table | Change `destination_*`, `bundle deploy` and run the publication (the old table is kept) |
| Rotate the Firecrawl key | Step 5 |
| Update the code | `git pull`, `bundle deploy -t prod` in both bundles and `bundle run app -t prod` |

### 9.4 How the app reads data

The app serves every screen from Lakebase: the synced `brickfill_serving.products` and the `enrichment` schema that
the enrichment job loads after every batch. It also writes reviews, edits, evidence and settings there. It never
queries a SQL warehouse or the Delta tables. Until the first enrichment run creates the `enrichment` schema, the
catalog lists every product as pending.

### 9.5 Keeping the synced table current

The synced table uses **snapshot** mode, the only one supported when the source is a view. Refresh it after catalog
changes:

```bash
databricks postgres get-synced-table synced_tables/<catalog>.brickfill_serving.products --profile <PROFILE>
databricks pipelines start-update <status.pipeline_id> --profile <PROFILE>
```

The enrichment job updates the `enrichment` schema itself.

### 9.6 Staging environment

For staging, copy the `prod:` block under another name (e.g. `staging:`) in three places:
- `databricks.yml`;
- `resources/prod_platform.yml`;
- `app/brickfill/databricks.yml`.

Use another `lakebase_project_id` (the default `brickfill-<target>` already differs per target) and another
`schema`.

### 9.7 Cost

What it costs and how to check it is in [docs/finops.md](finops.md). Suggested routine:

| When | What to check | Where |
| --- | --- | --- |
| The day after each model or team change | Model cost per product and Firecrawl credits | [FinOps, 6.3](finops.md#63-estimated-cost-per-product-from-the-results) |
| Weekly | Model cost per endpoint | [FinOps, 6.2](finops.md#62-model-cost-per-endpoint) |
| Monthly | Total cost per billing product and untagged usage | [FinOps, 6.1 and 6.6](finops.md#6-checking-the-cost) |
| Always | Monthly budget with e-mail alert | [FinOps, 7](finops.md#7-alerts) |

## 10. Final check

- [ ] `databricks bundle validate --strict -t prod` passes in both bundles.
- [ ] `databricks jobs list --profile <PROFILE>` shows the 5 BrickFill jobs. In each, **Tags** has `project`,
      `environment`, `cost_center`, `owner` and `business_unit`, and **Run as** is the jobs SP.
- [ ] `databricks postgres get-project projects/<lakebase_project_id>` shows `custom_tags` and `budget_policy_id`,
      and the `primary` endpoint shows `suspend_timeout_duration: 1800s`.
- [ ] The source contract job has no ERROR in `contract_check`; the three views return rows and show column
      comments in Catalog Explorer; the synced table is `ONLINE`.
- [ ] The pilot wrote `product_enrichment`, in the expected `content_language`, with evidence in
      `product_attribute_evidence`.
- [ ] With the schedule on (7.3), the next run logs capacity, queue and batch, and doesn't repeat enriched products.
- [ ] The app opens for a reviewer and is denied to a user outside the group, in each UI language.
- [ ] Settings saves, shows the change in the history, and the next run records it in `enrichment_run.settings_json`.
- [ ] Adding manual evidence (with a screenshot) to one attribute and editing another attribute with evidence both
      work.
- [ ] Approving the product and running `brickfill_publish_approved` writes the row to the destination, with
      `evidence` in `attributes_json`.
- [ ] The next day, query 6.3 of [FinOps](finops.md#63-estimated-cost-per-product-from-the-results) shows the cost
      per product. Within a week, the tagged costs appear in queries 6.1 and 6.6.

## Troubleshooting

| Symptom | Likely cause | Action |
| --- | --- | --- |
| `validate`: `no value assigned to required variable` | A required variable has no value | Step 3 |
| Source contract fails with `MISSING_COLUMN` / `WRONG_TYPE` | The adapter doesn't return a canonical column, or returns it with another name | Fix the adapter's `SELECT` (6.1) |
| Source contract fails with `NULL_IN_NOT_NULL` or `GTIN_INVALID` | Items without GTIN or title, or GTINs with a wrong check digit | Filter them in the adapter, or fix them at the source; `contract_check` lists sample keys |
| Source contract fails with `PK_DUPLICATE` / `GTIN_DUPLICATE` | The adapter's joins multiply rows | Review the joins; the key must be unique |
| Source contract: `Invalid SQL identifier` / placeholder error | `adapter_params` contains something other than identifiers, or the adapter uses an unknown `{{key}}` | Use identifiers or dotted paths only (6.1) |
| `prepare` fails before reading products | The views drifted from the contract (an adapter change wasn't re-run) | Run `brickfill_source_contract` |
| `No usable products (gtin, title and subcategory_id)` | Empty views, or an adapter filtering everything | Step 6 |
| A scheduled run ends in seconds with "No products to enrich" | The review queue is full (batch 0), or everything is already enriched | Expected. Check the queue (7.2); for a temporary boost, run with a higher `reviewers=<n>` |
| A scheduled run doesn't happen | `enrichment_schedule_status` is still `PAUSED` | Step 7.3 |
| `enrich` fails reading the review queue or the settings | The jobs SP can't connect to Lakebase | Check `postgres_roles` (step 4) and `lakebase_project_id`. With an endpoint set, the run fails rather than writing in the wrong language |
| `lakebase_endpoint is required to size the batch by the review queue` | `reviewers > 0` without a Lakebase endpoint | Set `lakebase_endpoint` (the default derives it) or run with `reviewers=0` |
| `Unknown content_language` / `content_profile` / `market` in the enrichment settings | A job parameter or a saved setting names a pack that doesn't exist | Use `en`, `pt-BR`, `es` and a profile/market from `src/brickfill/content/`; correct it in Settings |
| `Unknown setting override` / override out of range | A saved override no longer matches the profile fields | Edit the override in Settings |
| `deploy`: `run_as` not allowed | The deployer lacks **Service principal: User** on the jobs SP | Step 1.3 |
| `research_trace.discovery_error` mentioning `system.ai.web_search`, few sources per product | Workspace without Web Search and `use_native_web_search: "true"` | Go back to `"false"` and deploy (step 1.1) |
| Slow run, logs with Firecrawl `429` | `firecrawl_concurrency` above the plan limit | Use the plan limit (2 on free); the job retries the 429 but waits every time |
| `enrich` fails in seconds with the model's `BadRequestError`, no products written | The `model_endpoint` endpoint rejects the call format. The initial check stops the run before spending Firecrawl credits | Go back to the default `model_endpoint` or open a ticket with the error |
| `AGENT_FAILURE`: `Model response was truncated` | The answer exceeded `max_output_tokens` (32,000) twice; the agent already asked once for a shorter answer | Reprocess the GTIN; if it repeats, open a ticket with the GTIN |
| The source contract job can't read the retailer's tables | The jobs SP lacks `SELECT` on `adapter_source_schema` | Step 1.3 |
| The job can't read the secret | The secret is not in `secret_catalog`.`secret_schema`, has another name than `firecrawl_secret_key`, or the jobs SP lacks `READ SECRET` | Step 5 |
| Many `SCREENSHOT_ONLY` | The page changes during capture (carousels, banners) | Human review on the screenshot, manual evidence or recapture (9.2) |
| `NOT_VISIBLE` | The value only exists in structured data, or the section doesn't open | Check `capture_error`; the reviewer uses the page screenshot or attaches manual evidence |
| `capture_error` with "did not load the same content" | The site blocked focused capture (anti-bot) | Recapture (9.2) later, or manual evidence |
| `load_lakebase` fails to connect | The jobs SP's Postgres role doesn't exist | Check `postgres_roles` in the step 4 deploy |
| The app opens empty or with a query error | The app SP's grants are missing | `bundle run grant_access` (step 8) |
| App: `permission denied for schema enrichment` | Missing Lakebase grant | `bundle run grant_access` |
| A screenshot upload fails with 415 or 413 | The file isn't PNG/JPEG/WebP, or exceeds 10 MB | Capture it again |
| The app deploy fails to create the synced table | The views don't exist yet | Step 6 before step 8 |
| App: "user not identified" when saving | The request didn't go through Databricks Apps, which identifies the user. Locally, `LOCAL_REVIEWER_EMAIL` is missing | Open the app through its Databricks Apps URL; locally, set `LOCAL_REVIEWER_EMAIL` in `.env` |
| App: another edit of this attribute was saved at the same time | Two edits of the same attribute arrived together | Reload the product and check the active value |
| Settings: "someone else saved these settings" (409) | Two people saved the same settings | Reload, check the history and save again |
| Settings is read-only | Your e-mail isn't in `settings_editors` | Ask an admin to add it, or set the variable to `none` |
| Publication fails with `refusing to delete them` | No approved product read from Lakebase while the destination has rows | Check `lakebase_schema` and `brickfill_app.product_review` (9.1) |

## Security

- **Secrets:**
  - The Firecrawl key exists only in the Unity Catalog secret, read only by the jobs SP.
  - Recommendation: also run a scanner such as `gitleaks` in CI.
- **Least privilege:**
  - The jobs run as their own SP, the only reader of the Firecrawl key and of the retailer's tables.
  - Reviewers only view the jobs.
  - The app only reads the catalog, and only writes to the manual evidence Volume and its own Lakebase schema.
  - The destination is written only by the publication job.
- **Web content:**
  - The agent treats external pages as untrusted data and ignores instructions inside them.
  - Every fact needs a citation of a page that was actually extracted, quoted verbatim in the page's language.
  - Values without evidence are marked missing.
- **Uploads:**
  - Files are validated by their bytes, with a 10 MB limit.
  - The path is generated by the server, with the hash in the name.
  - Nothing is overwritten or deleted.
- **Reviewer identity:**
  - Databricks Apps authenticates every request and tells the app the user's e-mail and ID (`X-Forwarded-Email`,
    `X-Forwarded-User`). The app is only reachable this way.
  - Without that identity, the app refuses every write (HTTP 401). No change is attributed to the app's service
    principal.
- **Audit:**
  - Every human change is recorded with the e-mail (`actor`), the Databricks user ID (`actor_id`), the date and the
    reason:
    - reviews, edits and evidence in `brickfill_app.audit_event`;
    - settings, per field, in `brickfill_app.settings_event`.
  - Writes to the same product, attribute or settings scope are serialized in a transaction. Two simultaneous edits
    never leave two active values, and each event records the value it replaced.
  - A unique index guarantees a single active edit per product and attribute.
- **Retention:** the Volumes and the Lakebase project are protected against `bundle destroy` (`prevent_destroy`).

## Upgrading an installation from before BrickFill

Installations from before the BrickFill rename don't upgrade in place. What changed:
- the bundle and resource names (bundle `brickfill`, jobs `brickfill_*`, Volumes `brickfill_evidence` /
  `brickfill_manual_evidence`, app `brickfill`, default schema `brickfill`);
- the source layer (canonical views instead of client-specific views);
- the app schema (`brickfill_app`).

A deploy therefore creates **new** jobs, Volumes, an app and an app service principal, and leaves the old ones in
place. Plan the move:

1. **Jobs:** pause the old schedules, and run `bundle destroy` on the old bundles. The old Volumes and the Lakebase
   project are `prevent_destroy` and stay.
2. **Source:** write an adapter for the retailer's tables (step 6). `product_input`, `attribute_definition` and the
   result tables now use the canonical columns (`product_id`, `gtin`, `category_id`, `subcategory_id`, …), and
   `prepare` adds the new columns to existing Delta tables.
3. **Evidence:** copy the old evidence Volumes into `brickfill_evidence` / `brickfill_manual_evidence` with the same
   relative paths, or point `evidence_volume` / `manual_evidence_volume` at the old Volumes.
4. **App data:** the new app SP doesn't own the old app schema's tables. Either:
   - keep the reviews by copying them into `brickfill_app`, or by transferring the old tables' ownership to the new
     app's Postgres role and setting `lakebase_schema` / `lakebase_app_schema` to the old schema name;
   - or start a fresh `brickfill_app`.
5. **Synced table:** the old synced tables used other keys. Delete them; the app bundle creates
   `brickfill_serving.products` keyed on `product_id`, and a key change always means recreating the table.
6. **Rules:** the default content language is English, and the default profile is neutral (no required meta
   suffix, no category-specific facts). Reproduce any previous editorial rules with a profile
   ([configuration](configuration.md)).
7. **Results:** run `brickfill_load_lakebase` to reload the existing results into Lakebase, then publish.

## Appendix: development environment

The `dev` target pins no workspace. Use `--profile` and put the values in
`.databricks/bundle/dev/variable-overrides.json` (gitignored) for each bundle:
- root bundle: at least `catalog`;
- app bundle: at least `catalog` and `lakebase_project_id` (`brickfill-dev` by default at the root).

The dev-only job `brickfill_mock_source_data` writes a fictional retailer's ERP to `adapter_source_schema` (default
`brickfill_source`). It then builds the canonical views with the mock adapter and validates the contract:

```bash
databricks bundle deploy -t dev --profile <PROFILE>
databricks bundle run brickfill_mock_source_data -t dev --profile <PROFILE>
```

This job **exists only in the `dev` target** and is never deployed to `prod`.

> **Mock data can't be researched on the web.** The mock items use fictional brands and GTINs from the GS1
> restricted-circulation prefix `2`, so the enrichment finds no real pages for them. They are good for exercising the
> contract, the app and the review flow. For a live demo, enrich a few real, publicly sold products: map them with an
> adapter over a small table of real GTINs, or run `brickfill_enrichment` with `ean=` on real items of a catalog you
> are allowed to use.
