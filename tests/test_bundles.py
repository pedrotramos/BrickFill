"""Offline checks of the two bundles: what ``databricks bundle validate`` would catch without a workspace login.

The schema test needs the Databricks CLI (``databricks bundle schema``) and is skipped without it; CI installs it.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from functools import cache
from pathlib import Path
from typing import Any

import pytest
import regex
import yaml
from jsonschema import validators
from jsonschema.exceptions import ValidationError

ROOT = Path(__file__).resolve().parents[1]
BUNDLES = [ROOT, ROOT / "app" / "brickfill"]
VARIABLE = re.compile(r"\$\{var\.([A-Za-z0-9_]+)")


def _files(bundle: Path) -> list[Path]:
    root = yaml.safe_load((bundle / "databricks.yml").read_text())
    included = [path for pattern in root.get("include", []) for path in sorted(bundle.glob(pattern))]
    return [bundle / "databricks.yml", *included]


def _documents(bundle: Path) -> list[tuple[Path, dict[str, Any]]]:
    return [(path, yaml.safe_load(path.read_text())) for path in _files(bundle)]


def _without_empty(value: Any) -> Any:
    # A mapping whose entries are all commented-out templates (e.g. "variables:" in prod) parses as None.
    if isinstance(value, dict):
        return {key: _without_empty(item) for key, item in value.items() if item is not None}
    if isinstance(value, list):
        return [_without_empty(item) for item in value]
    return value


def _without_required(schema: Any) -> Any:
    # Target overrides are partial (merged into the top-level resources), so "required" does not apply to them.
    if isinstance(schema, dict):
        return {key: _without_required(item) for key, item in schema.items() if key != "required"}
    if isinstance(schema, list):
        return [_without_required(item) for item in schema]
    return schema


def _pattern(validator, pattern, instance, _schema):
    # The CLI schema uses Unicode classes (\p{L}) that the standard re module does not support.
    if validator.is_type(instance, "string") and not regex.search(pattern, instance):
        yield ValidationError(f"{instance!r} does not match {pattern!r}")


@cache
def _validator():
    output = subprocess.run(["databricks", "bundle", "schema"], check=True, capture_output=True, text=True).stdout
    schema = _without_required(json.loads(output))
    return validators.extend(validators.validator_for(schema), {"pattern": _pattern})(schema)


@pytest.mark.skipif(shutil.which("databricks") is None, reason="Databricks CLI not installed")
@pytest.mark.parametrize("bundle", BUNDLES, ids=["platform", "app"])
def test_bundle_files_match_the_cli_schema(bundle):
    problems = [
        f"{path.relative_to(ROOT)}: {'/'.join(map(str, error.absolute_path))}: {error.message[:200]}"
        for path, document in _documents(bundle)
        for error in _validator().iter_errors(_without_empty(document))
    ]
    assert not problems, "\n".join(problems)


@pytest.mark.parametrize("bundle", BUNDLES, ids=["platform", "app"])
def test_every_variable_reference_is_declared(bundle):
    declared = set(yaml.safe_load((bundle / "databricks.yml").read_text()).get("variables", {}))
    used = {name for path in _files(bundle) for name in VARIABLE.findall(path.read_text())}
    assert used - declared == set()


@pytest.mark.parametrize("bundle", BUNDLES, ids=["platform", "app"])
def test_every_referenced_path_exists(bundle):
    missing = []
    for path in _files(bundle):
        for key, value in re.findall(r"^\s*(notebook_path|source_code_path):\s*(\S+)", path.read_text(), re.MULTILINE):
            if not (path.parent / value).resolve().exists():
                missing.append(f"{path.relative_to(ROOT)}: {key} {value}")
    assert not missing
