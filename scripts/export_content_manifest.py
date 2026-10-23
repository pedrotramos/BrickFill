"""Write app/brickfill/config/content-manifest.json: languages, profiles, markets and overridable settings.

The app bundle does not sync src/, so the Settings screen reads this copy. Run after changing any file under
src/brickfill/content/ (a test fails while the copy is stale):

    uv run python scripts/export_content_manifest.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from brickfill.content.loader import manifest
from brickfill.contract import CONTRACT_VERSION

MANIFEST_PATH = ROOT / "app" / "brickfill" / "config" / "content-manifest.json"


def render() -> str:
    return json.dumps(manifest(CONTRACT_VERSION), ensure_ascii=False, indent=2) + "\n"


def main() -> None:
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(render(), encoding="utf-8")
    print(f"Wrote {MANIFEST_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
