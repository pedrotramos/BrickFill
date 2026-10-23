"""Language-neutral text keys shared by the deterministic checks."""

from __future__ import annotations

import re
import unicodedata


def search_key(value: str) -> str:
    """Casefolded ASCII words: accents, punctuation and repeated spaces removed ("Peso Líquido" -> "peso liquido")."""
    normalized = unicodedata.normalize("NFKD", value)
    ascii_value = normalized.encode("ascii", "ignore").decode().casefold()
    return " ".join(re.sub(r"[^a-z0-9]+", " ", ascii_value).split())


def contains_term(text_key: str, term: str) -> bool:
    """Whether ``term`` appears in ``text_key`` (already a :func:`search_key`) as whole words."""
    term_key = search_key(term)
    return bool(term_key) and f" {term_key} " in f" {text_key} "


def contains_fragment(text_key: str, term: str) -> bool:
    """Whether ``term`` appears in ``text_key`` as a word prefix ("logist" matches "logistica")."""
    term_key = search_key(term)
    return bool(term_key) and f" {term_key}" in f" {text_key}"
