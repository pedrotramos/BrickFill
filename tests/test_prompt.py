from __future__ import annotations

import re

from brickfill.content.loader import effective_rules
from brickfill.prompt import build_system_prompt, build_user_prompt

PORTUGUESE = re.compile(r"ção|não|você|produto recebido|pagina_externa", re.IGNORECASE)


def test_english_prompt_has_no_portuguese_leftovers():
    prompt = build_system_prompt(effective_rules())
    assert not PORTUGUESE.search(prompt)
    assert "English (en)" in prompt
    assert "<external_page>" in prompt
    assert "verbatim" in prompt


def test_language_block_names_both_languages_and_localized_sections():
    prompt = " ".join(build_system_prompt(effective_rules(content_language="es", catalog_language="pt-BR")).split())
    assert "Spanish (es)" in prompt and "Brazilian Portuguese (pt-BR)" in prompt
    assert '"Características Principales"' in prompt


def test_optional_clauses():
    plain = build_system_prompt(effective_rules())
    assert "ending exactly with" not in plain and "certifications" not in plain
    rules = effective_rules(overrides={"meta_description_required_suffixes": ["Shop now!"]}, market="BR")
    prompt = build_system_prompt(rules)
    assert 'ending exactly with "Shop now!"' in prompt
    assert "ANVISA, INMETRO, MAPA" in prompt
    assert "Do not write FAQs" in build_system_prompt(effective_rules(overrides={"faq_enabled": False}))
    assert "imperial" in build_system_prompt(effective_rules(overrides={"units": "imperial"}))


def test_user_prompt_category_rule_only_when_present():
    common = {
        "seed_json": "{}",
        "attributes_json": "[]",
        "discovery_provider": "firecrawl_search",
        "discovery_context": "",
        "prefetched_pages": [],
        "max_steps": 3,
        "response_schema": "{}",
    }
    assert "requires these facts" not in build_user_prompt(**common, required_fact_labels=[])
    assert "warranty, weight" in build_user_prompt(**common, required_fact_labels=["warranty", "weight"])
