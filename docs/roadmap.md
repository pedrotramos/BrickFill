# Roadmap

What we plan to improve next, roughly by impact. Each item comes from a measured run or a code review; pick one up by
opening an issue first, so the approach can be agreed before the work starts.

## Enrichment quality

- **Collapsed specification sections.** Most of the evidence crops still missing are values inside a section the page
  only shows after a click that `capture_scripts/reveal.js` does not recognize (status `NOT_VISIBLE`, "no page
  control"). Use `scripts/replay_capture.py` on a past run to collect the controls it misses.
- **Variant guard.** Discovery can return the official page of a sibling variant (another color or model code of the
  same family). Rank pages that state the GTIN or the exact model code first, and treat variant-specific attributes
  (color, voltage, model) from a sibling page as conflicts.
- **FAQ coverage.** FAQs require official sources, so products whose manufacturer page was not extracted get few or
  none. Options: look for the manufacturer page explicitly before writing FAQs, or let the profile accept authorized
  distributors.

## Cost and latency

- **Re-measure cost per product** with the moving cache breakpoint and the cached evidence follow-up, and update
  [FinOps](finops.md) section 2 (the current table predates both).
- **Per-product budget.** Stop a product early when its tokens or Firecrawl credits pass a configurable ceiling, and
  report it apart.
- **Agent settings as job parameters**: `max_steps`, `max_prefetch_urls` and `max_output_tokens` are constructor
  arguments today.
- **Discovery per category.** Products of the same subcategory and brand often share sources; reuse their discovery
  instead of searching for each one.

## Review app

- **Keyboard shortcuts** for the review queue (next product, approve, reject).
- **Split the largest components**: `ProductPage.tsx` (~1,100 lines) and `SettingsPage.tsx` (~960 lines).
- **UI tests**: browser tests against the mock catalog, run in CI with a local Postgres.
- **Large catalogs**: `product_list` counts every match (`COUNT(*) OVER ()`) and searches with `LIKE`; add a trigram
  index on the search text or an estimated count past a threshold.

## Done recently

See [CHANGELOG.md](../CHANGELOG.md).
