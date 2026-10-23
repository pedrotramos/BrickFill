# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is the retailer's **catalog curator**: a catalog or content analyst who works through the daily
review batch at a desktop. They open the next product in the queue, check each value against its source page,
screenshot and crop, edit with their own evidence, and approve or reject. On a phone they only look things up.

Other people touch the app without being its focus. The retailer's data team deploys BrickFill, maps its tables to the
contract and adjusts the Settings screen. FinOps reads the cost view in the **How it works** dialog.

## Product Purpose

BrickFill fills the gaps in a retailer's product catalog with content that can be traced to a source page: titles,
descriptions, fact sheets, FAQs, images and structured attributes. A serverless job enriches a daily batch sized to
the review team's capacity. The review app is where a person decides what gets published, and only approved products
reach the destination table.

Success looks like this:

- the queue empties every day;
- every published value can be audited back to a page that was actually extracted;
- the curator never has to trust a value they cannot verify.

## Positioning

**Evidence or nothing.** Every published value cites a page that was actually extracted, with a full-page screenshot
and a crop of where the value appears. A value without evidence stays empty and goes to review. Human edits need
evidence too. A decision is bound to the enrichment run it was made on, so a changed product returns to the queue.
Everything runs on the retailer's own Databricks workspace.

## Operating Context

- **Daily routine:** the enrichment job runs each day, and curators work the review queue through overview, catalog,
  product review and approval.
- **Where it runs:** the review app runs on Databricks Apps and reads only from Lakebase Postgres. It never reads from
  a SQL warehouse.
- **Web research:** Firecrawl handles search, scrape, browser actions and screenshots. It is billed in credits, 5–10
  per product (median 8).
- **Evidence files:** screenshots and crops live in Unity Catalog Volumes.
- **Records:** the full audit trail of edits, evidence, decisions and settings changes lives in Lakebase. The
  enrichment history is immutable in Delta.

## Capabilities and Constraints

- **White-label accelerator.** BrickFill is Apache-2.0 and pre-1.0. A retailer maps its own tables to a documented
  canonical contract (`v_products`, `v_attributes`, `v_attribute_options`). Customer-specific data and rules stay out
  of the core.
- **Co-branding at runtime:**
  - the customer's name (`BRAND_CUSTOMER_NAME`);
  - their logo (`BRAND_CUSTOMER_LOGO_URL`);
  - an accent color (`BRAND_ACCENT_COLOR`) that replaces only the action color.
- **Languages and markets:**
  - the UI ships in English, Portuguese (Brazil) and Spanish;
  - the content language, editorial profile and market (BR, ES, MX, US) are configurable, globally or per
    department, category and subcategory;
  - the catalog's own attribute names and allowed values are never translated.
- **Deterministic guardrails:** code, not the model, enforces GTIN check digits, packaging-level GTINs, exact
  vocabularies, source ranking, editorial lengths and banned terms.
- **Review statuses:**
  - enrichment: PENDING, ENRICHED, REVIEW_REQUIRED;
  - review: IN_REVIEW, APPROVED, REJECTED.
  - An edit or new evidence reopens an approval.
- **Planned, not built:** keyboard shortcuts for the review queue, browser tests in CI, and scaling for large
  catalogs (see `docs/roadmap.md`).

## Brand Commitments

- The name is **BrickFill**, and it is presented as a Databricks solution accelerator.
- The mark and wordmark live in `app/brickfill/client/public/brickfill-logo.svg`.
- Firecrawl is credited as the web-research partner.
- **Visual home: the Databricks workspace.** The review app follows the Databricks product UI conventions (the
  category standard, played straight), so it reads as part of the workspace it runs in rather than as its own world.
- The voice is plain and factual: controls name their action, and errors name the problem and how to recover.

## Evidence on Hand

- A fictional ERP with a mock adapter (`brickfill_mock_source_data`) is the only demo catalog.
- Measured cost and token figures are in `docs/finops.md`.
- There are no customer names, testimonials, case studies or benchmarks to show. None may be invented, and real
  customer data must never enter the repo.

## Product Principles

1. **No value without a source.** An empty field that is flagged is better than a plausible value nobody can verify.
2. **The person decides.** The model proposes and code validates, but only an approval publishes, and every decision
   is recorded with its author, reason and the run it applies to.
3. **The reviewer's time is the budget.** Batch size, the order of the queue and the density of each screen serve how
   fast and how confidently a curator gets through the day's queue.
4. **Generic core, customer at the edges.** The contract, language and market packs and co-branding carry
   customization. The core never hard-codes a customer.

## Accessibility & Inclusion

WCAG 2.2 AA:

- AA contrast in both themes, including field outlines;
- full keyboard use, with a skip link and visible focus;
- screen-reader names and page headings;
- 44px touch targets on touch screens;
- color never the only cue, so every status has an icon and a label;
- less motion when the system asks for it.
