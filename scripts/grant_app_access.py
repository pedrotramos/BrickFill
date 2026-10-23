"""Grant the app's service principal read access to the Lakebase schemas it serves the catalog from (idempotent).

Run from the app bundle after the app exists, so the inputs come from the same bundle variables:

    cd app/brickfill
    databricks bundle run grant_access -t <target> --profile <PROFILE>

USAGE / SELECT on the results schema loaded by the job and on the schema of the synced products table. The app reads
no Unity Catalog table: its Volumes come from the app's resources, and the schema it writes (brickfill_app) needs
nothing, because the app creates and owns it. The identity running this script must be able to grant these privileges
(Lakebase project owner or databricks_superuser).
"""

from __future__ import annotations

import os
import re

import psycopg
from databricks.sdk import WorkspaceClient

# Self-contained on purpose: most of the brickfill package imports the Databricks runtime (spark), which is not
# available on the operator's machine. The SQL below mirrors lakebase_load.grant_statements.


def _identifier(value: str) -> str:
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", value):
        raise ValueError(f"Invalid SQL identifier: {value!r}")
    return value


def _quoted(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def lakebase_grants(schema: str, role: str) -> list[str]:
    target, grantee = _quoted(_identifier(schema)), _quoted(role)
    return [
        f"GRANT USAGE ON SCHEMA {target} TO {grantee}",
        f"GRANT SELECT ON ALL TABLES IN SCHEMA {target} TO {grantee}",
        f"ALTER DEFAULT PRIVILEGES IN SCHEMA {target} GRANT SELECT ON TABLES TO {grantee}",
    ]


def _connect(workspace: WorkspaceClient, endpoint: str, database: str) -> psycopg.Connection:
    host = workspace.postgres.get_endpoint(name=endpoint).status.hosts.host
    token = workspace.postgres.generate_database_credential(endpoint=endpoint).token
    user = workspace.current_user.me().user_name
    return psycopg.connect(host=host, dbname=database, user=user, password=token, sslmode="require")


def _required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"Missing environment variable {name}; run through `databricks bundle run grant_access`")
    return value


def main() -> None:
    workspace = WorkspaceClient()
    app = workspace.apps.get(_required("APP_NAME"))
    principal = app.service_principal_client_id
    if not principal:
        raise SystemExit(f"App {app.name} has no service principal yet; deploy it first")
    print(f"App {app.name}: service principal {principal}")

    schemas = [item.strip() for item in _required("LAKEBASE_SCHEMAS").split(",") if item.strip()]
    with _connect(workspace, _required("LAKEBASE_ENDPOINT"), _required("LAKEBASE_DATABASE")) as connection:
        for name in schemas:
            exists = connection.execute("SELECT 1 FROM pg_namespace WHERE nspname = %s", (name,)).fetchone()
            if not exists:
                # Created by its owner (the load job or the sync pipeline); creating it here would change the owner.
                print(f"Lakebase: schema {name} does not exist yet; run the job/sync first and repeat this command")
                continue
            for statement in lakebase_grants(name, principal):
                connection.execute(statement)
            print(f"Lakebase: USAGE, SELECT on schema {name}")
        connection.commit()
    print("Done. Restart the app if it was started before these grants: databricks bundle run app")


if __name__ == "__main__":
    main()
