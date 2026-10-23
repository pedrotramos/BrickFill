import { describe, expect, it } from 'vitest';
import { type CurrentRun, currentRun, decisionApplies, decisionProblem } from './review-decision';

const run: CurrentRun = { runId: 'run-2', createdAt: new Date('2026-10-20T12:00:00Z'), hasContent: true };

describe('decisionApplies', () => {
  it('holds only for the run it was made on', () => {
    expect(decisionApplies({ runId: 'run-2', at: '2026-10-01T00:00:00Z' }, run)).toBe(true);
    expect(decisionApplies({ runId: 'run-1', at: '2026-10-21T00:00:00Z' }, run)).toBe(false);
    expect(decisionApplies({ runId: 'run-2', at: null }, undefined)).toBe(false);
  });

  it('holds a decision saved before the app recorded the run when it is not older than the result', () => {
    expect(decisionApplies({ runId: null, at: new Date('2026-10-20T12:00:00Z') }, run)).toBe(true);
    expect(decisionApplies({ runId: null, at: '2026-10-20T11:59:59Z' }, run)).toBe(false);
    expect(decisionApplies({ runId: null, at: null }, run)).toBe(false);
  });
});

describe('decisionProblem', () => {
  const approve = { status: 'APPROVED' as const, runId: 'run-2', basedOnEventId: '41' };

  it('accepts a decision on the result and the edits the page showed', () => {
    expect(decisionProblem(approve, run, '41')).toBeUndefined();
    expect(decisionProblem({ ...approve, status: 'REJECTED' }, run, '41')).toBeUndefined();
  });

  it('refuses a decision on an older result or after another change', () => {
    expect(decisionProblem({ ...approve, runId: 'run-1' }, run, '41')).toBe('REVIEW_STALE');
    expect(decisionProblem(approve, run, '42')).toBe('REVIEW_STALE');
    expect(decisionProblem({ ...approve, basedOnEventId: null }, run, '41')).toBe('REVIEW_STALE');
    expect(decisionProblem(approve, undefined, '41')).toBe('REVIEW_STALE');
  });

  it('refuses to approve a failed enrichment, which can still be rejected', () => {
    const failed = { ...run, hasContent: false };
    expect(decisionProblem(approve, failed, '41')).toBe('NOTHING_TO_APPROVE');
    expect(decisionProblem({ ...approve, status: 'REJECTED' }, failed, '41')).toBeUndefined();
    expect(decisionProblem({ ...approve, runId: null, basedOnEventId: null }, undefined, null)).toBe(
      'NOTHING_TO_APPROVE'
    );
  });

  it('does not check a status that is not a decision', () => {
    expect(decisionProblem({ status: 'IN_REVIEW', runId: null, basedOnEventId: null }, run, '41')).toBeUndefined();
    expect(decisionProblem({ status: 'PENDING', runId: 'run-1', basedOnEventId: '1' }, run, '41')).toBeUndefined();
  });
});

describe('currentRun', () => {
  it('has no run before the enrichment job creates the results table', async () => {
    const client = { query: () => Promise.resolve({ rows: [{ exists: false }] }) };
    await expect(currentRun(client, '"enrichment"', '7891234567895')).resolves.toBeUndefined();
  });

  it('reads the latest run of the product', async () => {
    const calls: string[] = [];
    const client = {
      query: (text: string) => {
        calls.push(text);
        return Promise.resolve({
          rows:
            calls.length === 1
              ? [{ exists: true }]
              : [{ run_id: 'run-2', created_at: run.createdAt, has_content: false }],
        });
      },
    };
    await expect(currentRun(client, '"enrichment"', '7891234567895')).resolves.toEqual({ ...run, hasContent: false });
    expect(calls[1]).toContain('"enrichment".product_enrichment');
  });
});
