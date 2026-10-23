## What and why

<!-- One topic per pull request. Link the issue it closes, if any (Closes #123). -->

## How it was verified

<!-- Commands run, dev workspace run (one product at most), screenshots of the mock catalog. -->

## Checklist

- [ ] `uv run ruff check .`, `uv run ruff format --check .` and `uv run pytest` pass
- [ ] In `app/brickfill`: `npm run typecheck`, `npm run lint`, `npm run format`, `npm test` and `npm run build` pass
- [ ] New UI strings exist in `en`, `pt-BR` and `es`
- [ ] Generated files regenerated (contract doc, content manifest), if the contract or content packs changed
- [ ] `databricks bundle validate` run in the changed bundle(s), if `databricks.yml` or `resources/` changed
- [ ] New or updated npm dependencies deployed to a dev workspace (the Databricks Apps npm mirror refuses some)
- [ ] No customer data, workspace hosts, IDs or secrets
- [ ] `CHANGELOG.md` updated under `Unreleased` for user-facing changes
