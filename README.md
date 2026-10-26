<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="app/brickfill/client/public/brickfill-logo-dark.svg">
    <img src="app/brickfill/client/public/brickfill-logo.svg" alt="BrickFill" height="56">
  </picture>
</p>

<p align="center">
  <a href="https://github.com/pedrotramos/BrickFill/actions/workflows/ci.yml"><img src="https://github.com/pedrotramos/BrickFill/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License: Apache-2.0"></a>
  <img src="https://img.shields.io/badge/python-3.11%E2%80%933.12-blue.svg" alt="Python 3.11–3.12">
  <img src="https://img.shields.io/badge/node-22-green.svg" alt="Node.js 22">
  <img src="https://img.shields.io/badge/status-pre--1.0-orange.svg" alt="Status: pre-1.0">
</p>

# BrickFill — evidence-first catalog enrichment on Databricks

BrickFill fills the gaps in a retailer's product catalog — titles, descriptions, fact sheets, FAQs, images and
structured attributes — with content that is **traceable to a source page**. It is a solution accelerator: a
retailer maps its own product tables to a documented contract, chooses the language and editorial rules, and gets a
governed pipeline plus a review app on its own Databricks workspace.

- **Evidence or nothing.** Every published value cites a page that was actually extracted, with a screenshot and a
  crop of where the value appears. A value without evidence stays empty and is flagged for review.
- **Web research powered by [Firecrawl](https://firecrawl.dev).** Search discovers the manufacturer and retailer
  pages, scrape extracts them, and browser actions dismiss cookie banners, open accordions and tabs, take full-page
  screenshots and return the page's text map so the evidence crop is exact.
- **Deterministic guardrails.** GTIN check digits, packaging-level GTINs, exact vocabularies, source ranking,
  editorial lengths and banned terms are enforced by code, not by the model.
- **Human in the loop.** Reviewers approve, edit (always with their own evidence) and publish from a Databricks App,
  with a full audit trail. Only approved products reach the destination table.
- **Global by design.** The UI ships in English, Portuguese (Brazil) and Spanish. The enrichment language, editorial
  profile and market (regulators, search location, marketplaces to deprioritize) are configurable in the bundle and
  on the app's **Settings** screen, globally or per category.

## How it works

```
Retailer tables ──adapter──► v_products / v_attributes / v_attribute_options   (documented canonical views, contract v1)
                                   │                          │
                                   │                          └─► Lakebase synced table ──────────────┐
                                   ▼                                                                  │
            BrickFill · Enrichment (Lakeflow Jobs, serverless, daily batch sized by the review team)  │
              prepare ─► enrich: Firecrawl search + scrape + screenshots ─► Foundation Model ─► rules  │
                         │                                                                            │
                         ├─► Delta (immutable history) + UC Volume (screenshots, crops)              │
                         └─► load_lakebase ──────────────────────────────────────────────────► Lakebase Postgres
                                                                                                      │
            BrickFill app (Databricks Apps): review, edit with evidence, Settings, audit ◄────────────┘
                                                                                                      │
            Approved products Delta table ◄── BrickFill · Publish approved (Lakeflow Jobs) ◄──────────┘
```

The app's **How it works** dialog shows the same flow, with the Databricks SKU behind every step and the Firecrawl
capabilities used.

### Databricks SKUs in the solution

| SKU (`billing_origin_product`) | Used for | Cost driver |
| --- | --- | --- |
| Serverless Jobs (`JOBS`) | Source contract, prepare, enrich, load, publish, recapture | Runs and products per run |
| Foundation Model APIs, pay-per-token (`MODEL_SERVING`) | Structuring facts and writing the content | Model choice × tokens per product (the main variable cost) |
| Lakebase Postgres (`LAKEBASE`) | App serving layer, reviews, edits, settings, audit | Hours the compute is awake (scales to zero after 30 min idle) |
| Lakebase synced tables (`LAKEFLOW_CONNECT` / `DLT`) | Canonical products in Postgres | Snapshot refreshes |
| Databricks Apps (`APPS`) | Review app | Hours the app is running |
| Unity Catalog + Volumes | Governance, lineage, the Firecrawl secret, evidence files | Storage (~3–5 GB per 1,000 products) |

Firecrawl is billed separately in credits (5–10 per product, median 8). See [FinOps](docs/finops.md).

## Quickstart (development workspace)

Requirements: Databricks CLI ≥ 1.19, [`uv`](https://docs.astral.sh/uv/), a workspace with Unity Catalog, serverless,
Databricks Apps and Lakebase, a Foundation Model endpoint and a Firecrawl API key.

```bash
uv sync
# 1. Platform and jobs (creates the schema, Volumes, Lakebase project and jobs)
databricks bundle deploy -t dev --profile <PROFILE> --var catalog=<catalog>
# 2. Store the Firecrawl key as the Unity Catalog secret <catalog>.<schema>.firecrawl_api_key (setup guide)
# 3. Fictional ERP + mock adapter + contract checks
databricks bundle run brickfill_mock_source_data -t dev --profile <PROFILE> --var catalog=<catalog>
# 4. Review app
cd app/brickfill
databricks bundle deploy -t dev --profile <PROFILE> \
  --var catalog=<catalog> --var lakebase_project_id=brickfill-dev
databricks bundle run app -t dev --profile <PROFILE>
```

The mock catalog uses fictional brands and GS1 test GTINs, so web research finds nothing for it: it is there to
exercise the contract, the jobs and the app. To see real enrichment, map a few real products through an adapter and
run `databricks bundle run brickfill_enrichment --params 'ean=<GTIN1>;<GTIN2>'`.

For production, follow the [setup guide](docs/setup-guide.md).

## Development

Every check runs locally and in CI without a workspace:

```bash
uv sync && uv run ruff check . && uv run ruff format --check . && uv run pytest
cd app/brickfill && npm ci && npm run typecheck && npm run lint && npm run format && npm test && npm run build
```

[CONTRIBUTING.md](CONTRIBUTING.md) has the project rules, the files to regenerate after common changes and how
releases work. To change evidence capture without spending credits, replay a past run with
`scripts/replay_capture.py`.

## FAQ

- **Does it need a paid Firecrawl plan?** No. The free plan works for trials. Set `firecrawl_concurrency` to the
  plan's limit; the job never exceeds it.
- **Can I use another model?** Yes, any Foundation Model endpoint with tool calling (`model_endpoint`).
  [FinOps](docs/finops.md) compares the measured cost and quality of several.
- **Does the app read Delta tables or a SQL warehouse?** No. It reads only from Lakebase. The job loads its results
  there, and the products table is synced from the canonical view.
- **What happens to a value the agent could not prove?** It is not published. The candidate stays visible to the
  reviewer with the reason, and the reviewer can publish it with their own evidence.
- **Where does my catalog data go?** Product titles and GTINs go to Firecrawl searches and to the model endpoint you
  choose. Everything else stays in your workspace.

## Documentation

| Document | What for |
| --- | --- |
| [Setup guide](docs/setup-guide.md) | Provision production step by step and operate it (daily batches, reprocessing, recapture, troubleshooting) |
| [Data contract](docs/data-contract.md) | The three canonical views and how to write an adapter for your tables |
| [Configuration](docs/configuration.md) | Languages, editorial profiles, markets, the Settings screen, co-branding |
| [Architecture](docs/architecture.md) | Flow, tables, source policy and visual evidence |
| [FinOps](docs/finops.md) | Consumption per SKU, cost formulas and the queries that check real spend |
| [Roadmap](docs/roadmap.md) | What is planned next |

## Repository layout

| Path | Contents |
| --- | --- |
| `databricks.yml`, `resources/` | Platform bundle: schema, Volumes, Lakebase project, jobs. `dev_only.yml` holds the mock-data job |
| `adapters/` | `_template/` to start an adapter, `mock/` as a complete example, and the generated contract reference |
| `notebooks/` | One notebook per job task (`01_source_contract`, `10_prepare`, `11_enrich`, `12_load_lakebase`, `20_publish_approved`, `30_evidence_recapture`; `00_mock_source_data` in dev only) |
| `src/brickfill/` | Library used by the notebooks; `content/` holds the editorial profiles, locale packs and market packs |
| `app/brickfill/` | AppKit/React review app (its own bundle) |
| `scripts/` | App grants, contract doc and content manifest generators, offline replay of evidence crops |
| `tests/` | Unit tests that run without Spark (`uv run pytest`) |

## Project rules

- No secrets in the repository: the Firecrawl key lives in a Unity Catalog secret and only travels in the
  `Authorization` header.
- Every generated fact has evidence or is marked as missing; evidence excerpts are verbatim, in the page's language.
- The retailer's tables are read only through the canonical views; the bundle never creates catalogs.

## Contributing, security and license

- Contributions are welcome: read [CONTRIBUTING.md](CONTRIBUTING.md) and the [code of conduct](CODE_OF_CONDUCT.md).
- Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
- BrickFill is licensed under the [Apache License 2.0](LICENSE). Databricks and Firecrawl are trademarks of their
  owners, and this project is not endorsed by them.

[Leia em português](README.pt-BR.md)
