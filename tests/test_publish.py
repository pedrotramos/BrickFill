from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone

import pytest

from brickfill.lakebase import Decision, decision_applies, naive_utc, pending_reviews
from brickfill.publish import check_plan, merge_statement, publication_plan

NAMESPACE = "`main`.`brickfill`"
DESTINATION = "main.ecommerce.approved_products"
CREATED = datetime(2026, 10, 20, 12, 0, tzinfo=UTC).replace(tzinfo=None)  # Spark reads naive UTC


def _compact(sql: str) -> str:
    return " ".join(sql.split())


def test_an_approval_publishes_only_the_run_it_was_made_on_with_content():
    sql = _compact(merge_statement(NAMESPACE, DESTINATION))
    assert "c.run_id IS NOT NULL AND c.result_json IS NOT NULL" in sql
    assert "AND (c.run_id = a.run_id OR (a.run_id IS NULL AND c.created_at <= a.approved_at))" in sql
    # without a publishable result the last published row is kept, neither replaced nor deleted
    assert "WHEN MATCHED AND source.publishable THEN UPDATE" in sql
    assert "l.ean IS NOT NULL AS publishable" in sql


def test_a_reopened_approval_keeps_the_last_published_version():
    sql = _compact(merge_statement(NAMESPACE, DESTINATION))
    assert "reopened AS ( SELECT product_ean AS ean FROM approved_review WHERE status = 'IN_REVIEW' )" in sql
    # reopened products are in the source (not deleted) without a publishable result (not replaced)
    assert "SELECT ean, NULL, NULL, NULL FROM reopened" in sql
    assert "FROM decided d LEFT JOIN latest l ON l.ean = d.ean" in sql
    assert "WHEN NOT MATCHED BY SOURCE THEN DELETE" in sql


def test_manual_evidence_of_an_ai_value_is_published_only_on_its_run():
    sql = _compact(merge_statement(NAMESPACE, DESTINATION))
    assert (
        "WHERE e.override_id IS NULL AND (e.run_id = l.run_id OR (e.run_id IS NULL AND e.created_at >= l.created_at))"
        in sql
    )
    assert "LEFT JOIN confirmed_evidence confirmed ON confirmed.ean = a.ean" in sql
    # the evidence of an edit stays with that edit
    assert "WHERE override_id IS NOT NULL GROUP BY product_ean, attribute_code, override_id" in sql


def test_an_edited_attribute_is_published_even_when_the_ai_marked_it_not_applicable():
    assert "WHERE a.applicable OR o.value IS NOT NULL" in _compact(merge_statement(NAMESPACE, DESTINATION))


def test_the_plan_counts_with_the_same_approval_rule_as_the_merge():
    merge, plan = _compact(merge_statement(NAMESPACE, DESTINATION)), _compact(publication_plan(NAMESPACE, DESTINATION))
    approved = merge[merge.index("approved AS (") : merge.index(", overrides AS (")]
    assert approved in plan
    assert "(SELECT COUNT(*) FROM latest) AS publishable" in plan


def test_check_plan_refuses_to_empty_the_destination():
    check_plan(approved=0, published=0)
    check_plan(approved=3, published=10)
    check_plan(approved=0, published=2, reopened=1)  # the reopened products keep their published version
    with pytest.raises(RuntimeError, match="refusing to delete"):
        check_plan(approved=0, published=2)


def test_a_decision_holds_only_for_its_run():
    assert decision_applies(Decision("run-2", None), "run-2", CREATED)
    assert not decision_applies(Decision("run-1", CREATED + timedelta(days=1)), "run-2", CREATED)
    assert not decision_applies(Decision("run-2", None), None, None)


def test_a_decision_saved_before_the_run_was_recorded_holds_when_not_older_than_the_result():
    assert decision_applies(Decision(None, CREATED), "run-2", CREATED)
    assert not decision_applies(Decision(None, CREATED - timedelta(seconds=1)), "run-2", CREATED)
    assert not decision_applies(Decision(None, None), "run-2", CREATED)
    # Lakebase returns aware timestamps, Spark naive UTC ones
    aware = datetime(2026, 10, 20, 9, 30, tzinfo=timezone(timedelta(hours=-3)))
    assert naive_utc(aware) == CREATED + timedelta(minutes=30)
    assert decision_applies(Decision(None, aware), "run-2", CREATED)


def test_pending_reviews_count_every_result_without_a_decision_for_it():
    latest = {
        "enriched-clean": Decision("run-1", CREATED),  # ENRICHED, never opened
        "approved": Decision("run-1", CREATED),
        "approved-then-enriched-again": Decision("run-2", CREATED),
        "rejected": Decision("run-2", CREATED),
        "legacy-approval": Decision("run-1", CREATED),
    }
    closed = {
        "approved": Decision("run-1", CREATED),
        "approved-then-enriched-again": Decision("run-1", CREATED - timedelta(days=1)),
        "rejected": Decision("run-2", CREATED),
        "legacy-approval": Decision(None, CREATED + timedelta(hours=1)),
        "not-enriched": Decision("run-0", CREATED),
    }
    assert pending_reviews(latest, closed) == 2
