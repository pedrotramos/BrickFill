# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). `CONTRACT_VERSION` in `src/brickfill/contract.py`
versions the canonical data contract separately.

## [Unreleased]

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

[Unreleased]: https://github.com/pedrotramos/BrickFill/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/pedrotramos/BrickFill/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/pedrotramos/BrickFill/releases/tag/v0.1.0
