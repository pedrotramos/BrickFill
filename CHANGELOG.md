# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). `CONTRACT_VERSION` in `src/brickfill/contract.py`
versions the canonical data contract separately.

## [Unreleased]

### Added

- Searchable category pickers: the catalog filter, the Settings scopes, the category templates and the Attributes
  screen find a category by name, identifier or synonym (from the category templates), ignoring accents and case.
- `dismiss_overlays` job parameter (off by default): before the screenshots, also answer the notices beyond the
  cookie banner (welcome tours, location or region prompts, newsletters, notification requests, stacked dialogs),
  from a closed list of labels and never accepting anything, with safeguards so the page itself is never hidden.
  Checked on synthetic pages at window heights 1080 and 100000 (`tests/test_overlays.py`, with Chrome and
  `BRICKFILL_BROWSER_TESTS=1`). Its passes take room under Firecrawl's limit of 50 actions per scrape, so a focused
  capture shows at most 5 values of a page with it (6 without).
- Every scrape stays within Firecrawl's 50 actions: actions the agent asks for beyond the room the capture leaves are
  dropped instead of failing the scrape with HTTP 400.

- **Category templates** screen: the content model of each product type (title formula with a live example,
  fact-sheet sections and fields, facts always shown, required and optional), matched to departments, categories and
  subcategories by id, name or synonym. Templates are one more settings layer (between the global settings and the
  per-category overrides), appear in each product's provenance with their revision and change `settings_hash`. Saves
  are versioned (409 on a concurrent change), the history keeps every field before and after, and an optional JSON
  file loads templates once at the first start (`category_templates_seed`).
- **Attributes** screen: mark each attribute of a subcategory as required or optional. The load job syncs the source's
  `is_required` to Lakebase; the team's choice lives in the app's own table, so syncs never overwrite it. Effective
  requirement = choice, then source, then `attributes_required_default`, used in the agent's definitions and in
  `MISSING_REQUIRED_ATTRIBUTE`; `product_attribute.required_origin` records where it came from.
- **Agent instructions** screen: additional style and emphasis instructions (up to 4,000 characters), versioned with
  restore, editable only by `agent_instructions_editors`. The prompt places them after the fixed rules, which they
  cannot change; each result records `instructions_version` and `prompt_version`.
- Profiles and templates accept `synonyms` in category matches, `required_fact_labels`, `optional_fact_labels` and an
  exact `fact_sheet.layout`; the validator flags a hyphen used between words of the title (`TITLE_HYPHEN_SEPARATOR`)
  and fact-sheet sections outside a template (`FACT_SHEET_EXTRA_SECTION`).

- PDF sources are visual evidence. PDFs cited by the agent are downloaded directly (HTTPS only, public hosts only,
  redirects checked at every hop, 30 MB and 250 pages at most, encrypted files refused), without Firecrawl credits.
  PDFium (`pypdfium2`) gives the agent the text and each page a text map, so values are cropped from the right page,
  with table rows as one piece. Without a match the rendered page stays as the capture, and the app labels PDF crop
  failures apart. PDFs are no longer excluded from the credit-limited recapture.
- `pdf_ocr` and `pdf_ocr_max_pages` job parameters: scanned PDFs (no text layer) can be read with `ai_parse_document`
  (billed per page). Off by default.

### Fixed

- Full-page crops work again with Firecrawl's tall rendering window (1920×100000). The crop used to require the image
  height to match the document height, so every web crop failed and every page paid for a focused capture. One scale
  from the width is used now, and only blocks inside the part of the layout that the image shows are cropped.
- The focused capture takes a full-page screenshot. In the tall window the page never scrolls and a screenshot of the
  visible window came back cut to its first 1080 px, so values below them were left as `SCREENSHOT_ONLY`.
- A blank (single-color) screenshot is no longer shown as the page capture: the page fails with "blank screenshot",
  the image stays archived for the audit, and the app shows its own label.
- A page whose text map is missing after the screenshot now fails (`FAILED`, with the reason) instead of being labeled
  `SCREENSHOT_ONLY`.
- Pages that add a fragment, a variant or tracking parameters to their address during the capture are no longer
  rejected as "changed address"; a change of path still is.
- Error messages are no longer garbled when no secret is configured.

### Changed

- Titles separate their parts with spaces: the prompt no longer asks for a hyphen as separator, and leaves out
  the parts of the title formula without a verified value.
- `scripts/replay_capture.py` also crops the archived screenshot with the current code and prints the window height
  of the text map, so crop regressions are caught without spending credits.

## [0.2.1] - 2026-10-27

### Changed

- Python 3.11 is the minimum version (3.11–3.12). Pillow 13 no longer supports Python 3.10, which reaches end of life
  in October 2026. The serverless jobs already run Python 3.12.

### Security

- Review app dependencies upgraded past known vulnerabilities: react-router 7.18.4, zod 4.6.7, and in development
  sharp 0.35.5 and vitest 4.1.12. Transitive packages that AppKit pins (OpenTelemetry, dompurify, echarts, js-yaml,
  qs, uuid, ws) are lifted to patched versions with npm `overrides`.
- Pillow 13.0.0 (also in the jobs' `job_dependencies`) and certifi 2026.10.23, past known vulnerabilities; pytest 9
  for development.

## [0.2.0] - 2026-10-23

### Changed

- Review app redesigned in the Databricks workspace's own product language, so it reads as part of the workspace it
  runs in: white and cool-gray surfaces, the action blue only for the primary action, selection and focus, a left
  sidebar, 32px controls with a mouse (44px on touch), 4px status tags, underline tabs and gray table headers. The
  overview shows one summary panel, the catalog filters are a toolbar above the table, the product name is the row's
  link, numbers are right-aligned and products never enriched show "—" instead of 0%.
- The product page shows the same status as the catalog (the enrichment status, plus the review decision once there is
  one).
- A plain `vX.Y.Z` tag is published as the latest release; only a suffixed tag (`v1.0.0-rc.1`) is a pre-release.

## [0.1.0] - 2026-10-23

First public release.

### Added

- Canonical data contract (`v_products`, `v_attributes`, `v_attribute_options`) with adapters, documented views and
  contract checks.
- Enrichment job on serverless Lakeflow Jobs: Firecrawl search and scrape, full-page screenshots and evidence crops,
  a Foundation Model agent, deterministic validation and a quality score.
- Configurable content: editorial profiles, locale packs (en, pt-BR, es) and market packs (BR, ES, MX, US), set in the
  bundle or per category on the app's Settings screen.
- Review app on Databricks Apps, served from Lakebase: overview, catalog with filters and the review queue, product
  review with evidence, edits with evidence, approval and audit trail.
- Review app for keyboards, screen readers, phones and tablets: labeled controls, page headings and a skip link,
  errors shown next to the action that failed, field outlines at 3:1, card layouts below 1024px and 44px touch
  targets; each review and enrichment status has its own tone and icon, and the brand color is kept for actions. The
  first load sends about 185 KB (Brotli, cached for a year) instead of 2.2 MB: unused AppKit chart libraries are left out of the bundle.
- Publish job for approved products and an evidence recapture job.
- Lakebase compute that autoscales between 0.5 and 16 CU (`lakebase_min_cu`, `lakebase_max_cu`) and suspends after
  30 minutes without connections.
- Decisions bound to the result they were made on: an approval or rejection records its enrichment run and is
  refused when the product changed meanwhile; edits and evidence reopen an approval; a product enriched again or
  changed after its approval returns to the review queue and keeps its last published version until approved again;
  manual evidence of an AI value stays with its run. The review queue and the batch capacity count every result
  without a decision.
- Evidence linking: a candidate value is matched to the facts that state it up to spelling, unit or a market
  equivalence, and a candidate its own source contradicts goes to review (`EVIDENCE_VALUE_MISMATCH`).
- Evidence follow-up: one cached model turn, without Firecrawl, asks for the facts behind candidates left without
  evidence.
- Agent cost controls: a moving prompt-cache breakpoint, schema-constrained repairs where the endpoint supports
  them, and no second scrape of a page already extracted.
- `scripts/replay_capture.py`: replays the evidence crops of a past run from its archived text maps, without credits.
- CI on GitHub Actions (Python, app, bundles, secret scanning) and a tag-driven release workflow.

[Unreleased]: https://github.com/pedrotramos/BrickFill/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/pedrotramos/BrickFill/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/pedrotramos/BrickFill/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/pedrotramos/BrickFill/releases/tag/v0.1.0
