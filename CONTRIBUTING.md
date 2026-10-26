# Contributing to BrickFill

Thanks for helping. BrickFill is a solution accelerator: retailers fork or deploy it on their own Databricks
workspace, so changes must stay generic, safe with real catalogs and cheap to run.

- [Ways to contribute](#ways-to-contribute)
- [Development setup](#development-setup)
- [Checks](#checks)
- [Project rules](#project-rules)
- [Common changes](#common-changes)
- [Pull requests](#pull-requests)

## Ways to contribute

- **Report a bug** or **propose a feature** with the issue templates.
- **Add an adapter** for a common ERP or PIM layout (`adapters/`), a **locale** (`src/brickfill/content/locales/`)
  or a **market** (`src/brickfill/content/markets/`).
- **Improve enrichment quality** with a reproducible case: the GTIN (public products only), what was expected and
  what the run produced (`result_json:research_trace`, issue codes, capture statuses).
- **Docs**: everything under `docs/` and the READMEs.

Security problems go through [SECURITY.md](SECURITY.md), never through a public issue.

## Development setup

Requirements:
- Python 3.11–3.12 and [`uv`](https://docs.astral.sh/uv/);
- Node.js 22 (`app/brickfill/.nvmrc`);
- Databricks CLI ≥ 1.19, only for the bundle checks and for deploying.

```bash
uv sync                      # Python library, notebooks' code and dev tools
cd app/brickfill && npm ci   # review app
```

Optional: `uvx pre-commit install` runs ruff and prettier on every commit (`.pre-commit-config.yaml`).

Nothing in the checks below needs a workspace. To try a change end to end, deploy to a **development** workspace
(`-t dev`), as the [quickstart](README.md#quickstart-development-workspace) shows.

## Checks

CI (`.github/workflows/ci.yml`) runs exactly these; run them before opening a pull request.

| Area | Commands |
| --- | --- |
| Python | `uv run ruff check .` · `uv run ruff format --check .` · `uv run pytest` |
| Review app (`app/brickfill`) | `npm run typecheck` · `npm run lint` · `npm run format` · `npm test` · `npm run build` |
| Bundles | `uv run pytest tests/test_bundles.py` (schema check runs when the `databricks` CLI is installed) |

`databricks bundle validate -t dev --profile <PROFILE>` needs a login, so it is not part of CI: run it in both
bundles (root and `app/brickfill`) when you change `databricks.yml` or `resources/`.

## Project rules

- **No customer data.** Never commit real catalogs, customer names, workspace hosts, IDs or screenshots of a real
  customer's products. Tests use synthetic data (`tests/conftest.py`) and the mock adapter; screenshots for docs use
  the mock catalog.
- **Evidence or nothing.** A value is published only with evidence from a page that was actually extracted.
  Deterministic rules live in code (`quality.py`, `postprocess.py`), not only in the prompt.
- **Spend little on tests.** An enrichment test spends Firecrawl credits and model tokens: run it on one product
  (`--params ean=<GTIN>`). To check a change to evidence crops, replay a past run for free with
  `scripts/replay_capture.py`.
- **Three UI languages.** Every UI string exists in `en`, `pt-BR` and `es` (`client/src/i18n/locales`); the i18n
  test fails otherwise. Every issue, rejection and applicability code in `src/brickfill/issues.py` needs a
  translation (`tests/test_content_packs.py`).
- **Lakebase serves the app.** The app reads only from Lakebase (`config/lakebase-queries`), never from a SQL
  warehouse. A query that reads a results table needs an empty stand-in (`_pending_<table>.sql`) or returns no rows
  on a fresh install.
- **App dependencies.** Databricks Apps installs npm packages from its own mirror, which refuses some public packages
  and versions. Deploy to a dev workspace before merging a new or updated dependency. AppKit pins its dependencies
  exactly, so `overrides` in `package.json` lifts the vulnerable ones (OpenTelemetry, dompurify, echarts, js-yaml, qs,
  uuid, ws, zod) to patched versions; drop each entry once an AppKit upgrade ships that version or newer. Keep the
  experimental OpenTelemetry packages at 0.219.x while AppKit is 0.38: 0.220 changed the `BatchLogRecordProcessor`
  constructor that AppKit calls, which silently stops log export.

## Common changes

| Change | Where | Then |
| --- | --- | --- |
| Canonical contract | `src/brickfill/contract.py` | `uv run python scripts/export_contract_doc.py` (regenerates `adapters/README.md`) |
| Content profile, locale or market | `src/brickfill/content/` | `uv run python scripts/export_content_manifest.py` (regenerates the app's `content-manifest.json`) |
| Quality score formula | `src/brickfill/quality.py` | Update `client/src/components/QualityInfo.tsx` and its `qualityInfo` texts |
| A new catalog screen | `app/brickfill/config/lakebase-queries/*.sql` | Add the row type to `client/src/lib/catalog-query.ts` |
| Issue code | `src/brickfill/issues.py` | Add `issues.codes.<CODE>` to the three `issues.json` |
| Python dependency | `pyproject.toml` | `uv lock`, or, without access to pypi.org, the Relock workflow (`.github/workflows/relock.yml`); a job runtime package also gets its exact pin in `job_dependencies` (`databricks.yml`) |

Tests fail while a generated file is stale.

## Pull requests

- Branch from `main`; `main` is protected and only takes pull requests with a green `ci-ok` check.
- Keep a pull request to one topic and describe how you verified it (commands, dev run, screenshots of the mock
  catalog).
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`,
  `ci:`, `refactor:`, `test:`, `chore:`).
- User-facing changes get a line under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md).

### Releases

Maintainers bump the version in `pyproject.toml` and `app/brickfill/package.json` (they must match), move the
`Unreleased` notes to the new version in `CHANGELOG.md` and push a tag `vX.Y.Z`. The release workflow reruns CI,
checks the versions and publishes the GitHub release with those notes.

By contributing you agree that your contributions are licensed under the [Apache License 2.0](LICENSE).
