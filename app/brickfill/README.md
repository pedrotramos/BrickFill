# BrickFill — review app

Databricks App (AppKit, React and Express) where the catalog team reviews what the BrickFill enrichment job produced:

- overview of quality and of the review queue;
- searchable catalog;
- product detail with every attribute, its evidence (URL, excerpt, screenshot and crop) and the validation issues;
- edits that always require evidence, manual evidence, approval and rejection, with a full audit trail;
- **Settings**: the language and content profile of the enrichment, globally and per category, read by the
  enrichment job at the start of every batch.

The app serves every screen from **Lakebase**: the canonical products view synced to Postgres plus the latest
enrichment results loaded by the job. It never queries a SQL warehouse or the Delta tables. Until the first enrichment
run creates the results schema, the catalog lists every product as pending
(the `_pending_<table>.sql` stand-ins in `config/lakebase-queries`). Reviews, edits, manual evidence, settings and audit are written
only to Lakebase, in the schema the app owns (`brickfill_app` by default). The app never writes Delta: the platform bundle's publish job moves approved products
to the destination table.

## Deploy

The app has its own bundle, with targets `dev` (development mode) and `prod`. Neither pins a workspace: pass
`--profile` and set the workspace-specific values with `--var` or in
`.databricks/bundle/<target>/variable-overrides.json` (gitignored):

```json
{ "catalog": "<catalog>", "lakebase_project_id": "<project_id>" }
```

```bash
databricks bundle validate --strict -t prod --profile <PROFILE>
databricks bundle deploy -t prod --profile <PROFILE>
databricks bundle run grant_access -t prod --profile <PROFILE>
databricks bundle run app -t prod --profile <PROFILE>
```

Databricks installs the `package-lock.json` dependencies and builds the app on `bundle run app`; Node.js is not needed
to deploy. The full walkthrough is in the [setup guide](../../docs/setup-guide.md).

## Configuration

| Bundle variable                         | Environment variable                        | What it sets                                                     |
| --------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------- |
| `lakebase_project_id`                   | `LAKEBASE_ENDPOINT`                         | Lakebase project shared with the platform bundle                 |
| `lakebase_results_schema`               | `LAKEBASE_RESULTS_SCHEMA`                   | Postgres schema loaded by the enrichment job (`enrichment`)      |
| `serving_schema`                        | `LAKEBASE_SYNC_SCHEMA`                      | Postgres schema of the synced products table (`brickfill_serving`) |
| `lakebase_app_schema`                   | `LAKEBASE_APP_SCHEMA`                       | Postgres schema the app owns (`brickfill_app`)                   |
| `content_language`, `catalog_language`, `content_profile`, `market` | `CONTENT_LANGUAGE_DEFAULT`, `CATALOG_LANGUAGE_DEFAULT`, `CONTENT_PROFILE_DEFAULT`, `MARKET_DEFAULT` | Defaults shown in Settings until app-level settings are saved |
| `settings_editors`                      | `SETTINGS_EDITORS`                          | E-mails allowed to change Settings; `none` = every app user      |
| `ui_default_language`                   | `UI_DEFAULT_LANGUAGE`                       | UI language when the browser's is not supported (`en`, `pt-BR`, `es`) |
| `brand_customer_name`, `brand_customer_logo_url`, `brand_accent_color` | `BRAND_CUSTOMER_NAME`, `BRAND_CUSTOMER_LOGO_URL`, `BRAND_ACCENT_COLOR` | Optional co-branding ("BrickFill · for <customer>") |

`config/content-manifest.json` lists the languages, content profiles, markets and overridable profile fields that
Settings offers. It is generated from the pipeline's content packs (`scripts/export_content_manifest.py` at the
repository root); without it the server uses a built-in copy of the neutral default profile.

## HTTP API

| Route | Purpose |
| --- | --- |
| `GET /api/config` | Default UI language and co-branding |
| `GET /api/lakebase-query/:key` | Catalog queries against Lakebase (`config/lakebase-queries`) |
| `GET /api/settings`, `PUT /api/settings`, `PUT`/`DELETE /api/settings/:scope/:scopeId` | Enrichment settings; writes use `expectedVersion` (409 on conflict) and are audited per field |
| `/api/products/:ean/...` | Review state, review decision, attribute edits and manual evidence |

Errors are `{ "code": "<CODE>", "error": "<English message>" }`; the client translates `errors.<CODE>`.

## Local development

```bash
npm install
# create .env with the variables below
npm run dev
```

`.env` needs at least `LAKEBASE_ENDPOINT` and `DATABRICKS_HOST`/profile settings, plus `LOCAL_REVIEWER_EMAIL` so writes are attributed to you. In development the
server does not create the Lakebase tables (`NODE_ENV=development` skips the DDL); deploy once, or point the app at a
database where they already exist.

The catalog queries live in `config/lakebase-queries`; their row types are in `client/src/lib/catalog-query.ts`, so
change both together.

**Dependencies.** Databricks Apps installs packages from its own npm mirror, which serves only part of the public
registry. It refused, for example, `i18next`, `react-i18next` and `void-elements`, so the UI translations use a
small in-app translator (`client/src/i18n/translator.ts`). Before adding a dependency, deploy once to a dev workspace
to confirm the mirror serves it and every transitive package.

## Structure

| Folder                        | Contents                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `client/src/pages`            | Overview, catalog, product and settings                                               |
| `client/src/components`       | Attribute audit, manual evidence, architecture ("How it works")                       |
| `server/`                     | Review, edit, evidence and settings routes; upload validation; evidence Volume reads  |
| `config/`                     | Lakebase catalog queries and the content manifest                                     |
| `resources/lakebase_sync.yml` | The products table synced to Lakebase                                                 |
