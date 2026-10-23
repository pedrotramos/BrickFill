# Configuration

Everything that changes from one retailer to another is configuration, not code.

| What | Where | Who changes it |
| --- | --- | --- |
| Which tables feed the catalog | Adapter SQL (`adapters/<retailer>/`) | Data engineer, once ([data contract](data-contract.md)) |
| Enrichment language, profile, market | Bundle variables (defaults) + the app's **Settings** screen | Catalog lead, any time |
| Editorial rules | Content profiles (`src/brickfill/content/profiles/`) + overrides on the Settings screen | Catalog lead / solution team |
| Language-specific vocabulary | Locale packs (`src/brickfill/content/locales/`) | Solution team |
| Country-specific rules | Market packs (`src/brickfill/content/markets/`) | Solution team |
| UI language, co-branding | App bundle variables | Whoever deploys the app |

## Languages

Two languages drive the enrichment:

- **Content language** (`content_language`):
  - the language the model writes in;
  - covers titles, descriptions, fact-sheet sections, labels and values, FAQ and observations.
- **Catalog language** (`catalog_language`):
  - the language of the retailer's attribute names and vocabularies;
  - vocabulary values are copied exactly and never translated;
  - empty means the same as the content language.

Evidence excerpts are always **verbatim, in the language of the source page**. This is required, not a style choice:
the visual evidence step locates the excerpt on the page to crop the screenshot. A Spanish catalog can therefore be
enriched from English manufacturer pages, with English excerpts as evidence and Spanish content.

The shipped languages are `en`, `pt-BR` and `es`.
- **Matching** (aliases, generic values, packaging terms, unit names) uses the locale packs of both languages.
- **Promotional-term checks and fact-sheet section names** use the content language.

## Editorial profiles

A profile (`content/profiles/<id>.json`) holds the editorial policy. The shipped `default` profile is deliberately
neutral:

| Rule | `default` |
| --- | --- |
| Title | ≤ 150 characters, must contain the verified brand, order: product type, brand, model, key feature, secondary feature, color, variant, quantity |
| Short description | 120–300 characters, third person, no links, truncated at a word boundary |
| Meta description | 70–160 characters, **no required ending** (`required_suffixes: []`) |
| Fact sheet | Key features, additional features, dimensions and weight, package contents; must include the GTIN, brand and supplier |
| FAQ | 5–8 questions, official sources only |
| Images | ≥ 1000 × 1000 px, white background checked when the source allows |
| Units | metric |
| Other | No emojis; no promotional terms from the locale pack |

Profiles can also declare:

- **`category_rules`:** facts that must appear for some categories, matched by id or name. Labels are semantic keys
  translated by the locale packs:

  ```json
  "category_rules": [
    {"match": {"category_names": ["Appliances"]}, "required_fact_labels": ["warranty", "height", "width", "depth", "weight"]}
  ]
  ```

- **`meta_description.required_suffixes`:** a call to action the meta description must end with, e.g.
  `["Shop now!"]`. When set, it is enforced by the `META_SUFFIX` rule and added to the prompt.
- **`severity_overrides` / `disabled_rules`:** turn a validation rule into a warning, or off, by issue code.

To add a profile, create `content/profiles/<id>.json`, regenerate the app manifest
(`uv run python scripts/export_content_manifest.py`), run `uv run pytest` and redeploy both bundles.

## Markets

A market pack (`content/markets/<code>.json`) holds what depends on the country rather than the language. The
shipped markets are `BR`, `ES`, `MX` and `US`; `market` empty disables all market rules.

| Field | Effect |
| --- | --- |
| `regulatory_bodies` | Certifications the fact sheet should include when they apply (e.g. ANVISA/INMETRO/MAPA for `BR`). Added to the prompt only when present |
| `search_location`, `country`, `languages` | Passed to Firecrawl search/scrape when the tool exposes `location`/`country`, so results come from the retailer's market |
| `deprioritized_domains` | Marketplaces ranked lower when choosing pages to extract (they rarely carry citable specs) |
| `preferred_domains` | Domains ranked higher |
| `value_equivalences` | Groups of values that mean the same in this market, e.g. `[["110V", "127V"]]` in `BR` (nominal and measured voltage). A candidate then matches a vocabulary option or a fact of an equivalent value |

## The Settings screen

The app's **Settings** page (`/settings`) lets the catalog team change the enrichment without a deploy. Values are
stored in Lakebase (`brickfill_app.app_settings`, `brickfill_app.category_settings`), and every change is audited in
`brickfill_app.settings_event`.

- **Global:** content language, catalog language, profile, market, and overrides of the main profile rules: title and
  description lengths, meta-description suffixes, FAQ on/off, units, minimum image size.
- **Per category:** content language, profile and overrides for one category.

The enrichment job reads the settings once per batch and resolves each product field by field:

```
subcategory > category > department > global settings > job parameters > profile file
```

`market` and `catalog_language` are global only. What each product was enriched with is recorded:
- in `product_enrichment`: `content_language`, `content_profile` and `settings_hash`;
- in `enrichment_run.settings_json`: the snapshot and the provenance of every field.

The app shows the content language of each product as a badge.

- **Failure safety:**
  - If the Lakebase endpoint is configured but the settings cannot be read, the run fails rather than generate
    content in the wrong language.
  - If the settings tables don't exist yet (the app was never started), the job parameters apply.
- **Existing products:** changing the language does **not** re-enrich products already enriched. Reprocess them
  explicitly with the `ean` job parameter.
- **Who can edit:** `settings_editors` (app bundle) is a comma-separated allowlist of e-mails. When it is `none` (the default), every
  app user can edit, and each change is audited with the user's identity.

## Bundle variables

**Platform bundle** (`databricks.yml`): `content_language` (`en`), `catalog_language` (empty), `content_profile`
(`default`), `market` (empty) and `timezone_id` (`UTC`, used by the schedules). They are job parameters of
**BrickFill · Enrichment**, so a single run can override them in *Run now with different parameters*.

**App bundle** (`app/brickfill/databricks.yml`). Databricks Apps rejects an environment variable with an empty value, so
optional values use `none` for "not set":

| Variable | Env | Default | Effect |
| --- | --- | --- | --- |
| `content_language`, `catalog_language`, `content_profile`, `market` | `CONTENT_LANGUAGE_DEFAULT`, `CATALOG_LANGUAGE_DEFAULT`, `CONTENT_PROFILE_DEFAULT`, `MARKET_DEFAULT` | same as the platform bundle (`none` where the platform bundle is empty) | Shown on Settings when nothing was saved yet |
| `settings_editors` | `SETTINGS_EDITORS` | `none` | Who may edit Settings |
| `ui_default_language` | `UI_DEFAULT_LANGUAGE` | `en` | UI language when the browser matches none of the shipped languages |
| `brand_customer_name` | `BRAND_CUSTOMER_NAME` | `none` | Co-branding: the header reads "BrickFill · for &lt;name&gt;" |
| `brand_customer_logo_url` | `BRAND_CUSTOMER_LOGO_URL` | `none` | Customer logo next to the BrickFill mark (https or same-origin only) |
| `brand_accent_color` | `BRAND_ACCENT_COLOR` | `none` | `#RRGGBB` accent that replaces the BrickFill primary color, with readable text chosen automatically |

## UI languages

The app picks, in order:
1. the language the user chose in the header (remembered in the browser);
2. the browser language (`pt-PT` maps to `pt-BR`);
3. `ui_default_language`;
4. English.

Validation issues and server errors are stored as codes with parameters, so they are shown in the reader's language
whatever the language of the run.

To add a UI language:
1. Create `app/brickfill/client/src/i18n/locales/<code>/*.json` with the same files and keys as `en/`.
2. Register it in `resources.ts` and `languages.ts`.
3. Run `npm test`: the parity test fails until every key and placeholder exists.

To also enrich in that language:
1. Add `src/brickfill/content/locales/<code>.json`.
2. Regenerate the manifest.
3. Run `uv run pytest`.
