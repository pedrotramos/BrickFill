"""Scanned PDFs read with ``ai_parse_document`` (Databricks AI Functions), on the job's Spark session.

Only PDFs without a text layer reach it, and only when the job runs with ``pdf_ocr=true``: the function is billed per
page, so ``pdf_ocr_max_pages`` limits the pages read. Each parsed element (paragraph, table, title...) becomes one
block of the page's text map, positioned by its bounding box on the page image the function writes to the evidence
Volume; the crop of a table is therefore the whole table. Any failure leaves the PDF unread (``NO_MATCH``).
"""

from __future__ import annotations

import html
import io
import json
import re
import uuid
from pathlib import Path
from typing import Any

from PIL import Image

from brickfill.pdf_evidence import OcrPage

QUERY = """
SELECT to_json(ai_parse_document(content, map(
  'version', '2.0',
  'imageOutputPath', :image_dir,
  'descriptionElementTypes', '',
  'pageRange', :page_range
))) AS parsed
FROM read_files(:path, format => 'binaryFile')
"""
SKIPPED_TYPES = {"page_header", "page_footer", "page_number"}


def _text(content: Any) -> str:
    """Element content as plain text: tables come as HTML, one row per line with ``|`` between cells."""
    value = str(content or "")
    value = re.sub(r"</t[dh]>\s*<t[dh][^>]*>", " | ", value, flags=re.IGNORECASE)
    value = re.sub(r"</tr>", "\n", value, flags=re.IGNORECASE)
    lines = html.unescape(re.sub(r"<[^>]+>", " ", value)).splitlines()
    return "\n".join(line for line in (" ".join(item.split()) for item in lines) if line)


def _local(uri: str) -> Path:
    return Path(re.sub(r"^dbfs:", "", uri))


def pages_from_parsed(document: dict[str, Any], read_image) -> list[OcrPage]:
    """Pages of an ``ai_parse_document`` v2 result; ``read_image(uri)`` returns the page image bytes."""
    if document.get("error_status"):
        raise ValueError(f"ai_parse_document failed: {document['error_status']}")
    parsed = document.get("document") or {}
    pages: dict[Any, OcrPage] = {}
    order: list[Any] = []
    for page in parsed.get("pages") or []:
        content = read_image(str(page.get("image_uri") or ""))
        with Image.open(io.BytesIO(content)) as image:
            width, height = image.size
        pages[page.get("id")] = OcrPage(content, float(width), float(height))
        order.append(page.get("id"))
    for element in parsed.get("elements") or []:
        if element.get("type") in SKIPPED_TYPES:
            continue
        text = _text(element.get("content"))
        for box in element.get("bbox") or []:
            coord = box.get("coord") or []
            page = pages.get(box.get("page_id"))
            if not text or page is None or len(coord) != 4:
                continue
            left, top, right, bottom = (float(item) for item in coord)
            if right > left and bottom > top:
                page.blocks.append({"text": text, "box": [left, top, right - left, bottom - top]})
    return [pages[key] for key in order]


class SparkDocumentParser:
    """:class:`brickfill.pdf_evidence.DocumentParser` backed by ``ai_parse_document`` on a Spark session."""

    def __init__(self, spark: Any) -> None:
        self.spark = spark

    def parse(self, pdf_path: str, max_pages: int) -> list[OcrPage]:
        image_dir = str(Path(pdf_path).parent / f"ocr-{uuid.uuid4().hex[:8]}")
        row = self.spark.sql(
            QUERY, args={"path": pdf_path, "image_dir": image_dir, "page_range": f"1-{max(1, int(max_pages))}"}
        ).first()
        if row is None or row["parsed"] is None:
            raise ValueError("ai_parse_document returned nothing")
        return pages_from_parsed(json.loads(row["parsed"]), lambda uri: _local(uri).read_bytes())
