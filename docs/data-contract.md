# Data contract

BrickFill never reads a retailer's ERP, PIM or e-commerce tables directly. Everything downstream (the enrichment
job, the Lakebase synced table, the review app and the publication) reads three **canonical views** in Unity
Catalog:

| View | One row per | Primary key | Used for |
| --- | --- | --- | --- |
| `v_products` | sellable item | `product_id` (`gtin` unique) | What to enrich; the catalog the app lists |
| `v_attributes` | attribute × subcategory where it applies | `attribute_id, subcategory_id` | Which attributes to research for a product, required flag, unit, role |
| `v_attribute_options` | allowed value of an attribute | `attribute_id, option_id` | Controlled vocabularies: a published value must match one option |

A retailer onboards by writing an **adapter**: three `SELECT` statements over its own tables that return the
canonical column names. The **BrickFill · Source contract** job wraps them in documented views and validates the data.

**Reference.** The full column reference, adapter instructions and contract checks are generated from
`src/brickfill/contract.py` into [`adapters/README.md`](../adapters/README.md). It covers every column, type,
nullability and meaning, plus the allowed values of `value_type` and `attribute_role`. Every column also carries its
comment in Catalog Explorer.

## Design choices

- **Ids and names are separate.**
  - Attributes apply to a `subcategory_id`, not a name, so two subcategories with the same name in different
    categories never collide.
  - Department and category names are kept for display and for profile rules that match by name.
- **GTIN is the enrichment key.** `gtin` must be a valid GTIN-8/12/13/14 and unique across active products.
  `product_id` is the retailer's own key, carried to the destination table for the join back.
- **Brand is optional.**
  - When `brand` is NULL, the agent discovers the brand with evidence.
  - When `brand` is present, it is sent to the agent as a hint and helps rank search results. The published
    `verified_brand` still comes from the extracted sources.
- **Vocabularies are opt-in.**
  - An attribute with at least one active option is a controlled vocabulary.
  - `allows_free_text = TRUE` turns its options into suggestions.
- **Required flags are explicit booleans.** The adapter converts the retailer's own flags (`'Y'/'N'`, `'S'/'N'`,
  `1/0`). NULL falls back to the `attributes_required_default` job parameter.
- **Units and roles are data, not heuristics.**
  - `unit` tells the matcher that `16.4` and `16.4 cm` are the same value.
  - `attribute_role` (brand, manufacturer, supplier, model, color, size, taxonomy, other) drives brand aliases and the
    taxonomy guard.
- **Inactive items are skipped.** `is_active = FALSE` excludes an item from enrichment and from the app, and NULL
  counts as active.

## Onboarding a retailer

1. Copy `adapters/_template/` to `adapters/<retailer>/`. Fill the three `SELECT`s, using `{{source}}` and
   `adapter_params` placeholders instead of hard-coded names. [`adapters/mock/`](../adapters/mock) is a complete
   example over a deliberately non-canonical ERP.
2. Grant the jobs' service principal `USE CATALOG`, `USE SCHEMA` and `SELECT` on the retailer's source schema.
3. Set `adapter`, `adapter_source_catalog` and `adapter_source_schema` (and `adapter_params`, if used) in the
   platform bundle and deploy.
4. Run `databricks bundle run brickfill_source_contract -t <target>`. Read the results in
   `<catalog>.<schema>.contract_check` and fix the adapter until no `ERROR` remains.
5. Deploy the app bundle; its synced table copies `v_products` to `brickfill_serving.products` in Lakebase.

Teams that already build curated tables with dbt or a pipeline can produce the three views themselves. They then run
the job with `adapter=none`, which only validates the views.

## Changing the contract

The contract is versioned (`CONTRACT_VERSION` in `contract.py`, stamped in each view's `TBLPROPERTIES`). After
editing `contract.py`, regenerate the reference and the app manifest, then run the tests:

```bash
uv run python scripts/export_contract_doc.py
uv run python scripts/export_content_manifest.py
uv run pytest
```
