# Security policy

## Reporting a vulnerability

Please **do not open a public issue**. Report it privately through GitHub:
**Security → Report a vulnerability** on this repository (private vulnerability reporting).

Include what you found, how to reproduce it and the impact you expect. You should get an answer within 7 days. Fixes
are released as soon as they are ready, and the advisory credits you unless you prefer otherwise.

## Supported versions

BrickFill is pre-1.0: only the latest release receives security fixes.

## Scope

In scope: the code in this repository (the enrichment library and notebooks, the review app, the bundles and
scripts). Out of scope: Databricks, Firecrawl and model providers themselves; report those to their vendors.

Areas that deserve special care:
- **Untrusted web content.** Pages, search results and tool output reach the model; they are wrapped as external
  content and the prompt forbids following instructions inside them (`src/brickfill/prompt.py`). Prompt-injection
  findings are in scope.
- **Secrets.** The Firecrawl key lives in a Unity Catalog secret and is only sent in the `Authorization` header;
  error messages are redacted (`src/brickfill/errors.py`).
- **Review app.** Every write is attributed to the Databricks identity forwarded by Databricks Apps and audited;
  manual evidence uploads are type- and size-checked (`app/brickfill/server`).
