import { describe, expect, it } from 'vitest';
import {
  attributeCodeOf,
  captureReasonKey,
  distinctSources,
  evidenceState,
  hostname,
  rankReferences,
  referenceOf,
} from './evidence';

describe('hostname', () => {
  it('shows the host of a source without www', () => {
    expect(hostname('https://www.example.com/product/1')).toBe('example.com');
    expect(hostname('https://shop.example.com.br')).toBe('shop.example.com.br');
  });

  it('does not throw on a stored URL that does not parse', () => {
    expect(hostname('example.com/product')).toBeNull();
    expect(hostname('')).toBeNull();
  });
});

describe('captureReasonKey', () => {
  it('uses the code of the job', () => {
    expect(captureReasonKey({ capture_status: 'COMPLETE' })).toBeNull();
    expect(captureReasonKey({ capture_status: 'NO_MATCH', capture_code: 'FIRECRAWL_REJECTED' })).toBe(
      'FIRECRAWL_REJECTED'
    );
    expect(captureReasonKey({ capture_status: 'NOT_VISIBLE', capture_code: 'BUDGET' })).toBe('BUDGET');
  });

  it('reads the reason of runs before capture codes from their messages and statuses', () => {
    expect(
      captureReasonKey({
        capture_status: 'AMBIGUOUS',
        capture_error: "Focused capture failed: HTTPStatusError: Client error '400 Bad Request'",
      })
    ).toBe('FOCUS_FAILED');
    expect(captureReasonKey({ capture_status: 'FAILED', capture_error: 'Firecrawl returned a blank screenshot' })).toBe(
      'BLANK'
    );
    expect(captureReasonKey({ capture_status: 'NO_MATCH', capture_error: 'PDF: the value was not found.' })).toBe(
      'PDF_FAILED'
    );
    expect(captureReasonKey({ capture_status: 'UNSUPPORTED', capture_error: 'PDF: text extracted' })).toBe(
      'UNSUPPORTED'
    );
    expect(captureReasonKey({ capture_status: 'SCREENSHOT_ONLY' })).toBe('UNSTABLE');
    expect(captureReasonKey({ capture_status: 'SOMETHING_NEW' })).toBe('CROP_FAILED');
    expect(captureReasonKey({})).toBe('TEXT_ONLY');
  });
});

describe('reference capture', () => {
  const official = { url: 'o', source_tier: 'official', capture_status: 'NO_MATCH' };
  const retailer = { url: 'r', source_tier: 'recognized_retailer', capture_status: 'COMPLETE' };
  const croppedRetailer = { url: 'r2', source_tier: 'recognized_retailer', capture_status: 'NO_MATCH' };
  const other = { url: 'x', source_tier: 'other', capture_status: 'COMPLETE' };

  it('ranks older runs by reputation, a taken crop first within a tier', () => {
    expect(rankReferences([other, croppedRetailer, retailer, official]).map((item) => item.url)).toEqual([
      'o',
      'r',
      'r2',
      'x',
    ]);
  });

  it('keeps the order the job stored', () => {
    const ranked = [
      { ...other, source_rank: 2 },
      { ...official, source_rank: 1 },
    ];
    expect(rankReferences(ranked).map((item) => item.url)).toEqual(['o', 'x']);
  });

  it('lists a passage quoted by two facts once, keeping the reference', () => {
    const first = { url: 'https://a.example/p', excerpt: 'Voltage | 127V', fact_value: '127V', is_reference: false };
    const second = { ...first, is_reference: true };
    const other = { url: 'https://b.example/p', excerpt: 'Voltage | 127V', fact_value: '127V' };
    expect(distinctSources([first, second, other], second)).toEqual([second, other]);
  });

  it('shows the source the job marked, else the most reputable crop', () => {
    expect(
      referenceOf([
        { ...official, is_reference: false },
        { ...other, is_reference: true },
      ])?.url
    ).toBe('x');
    expect(
      referenceOf([
        { ...official, is_reference: false },
        { ...retailer, is_reference: false },
      ])
    ).toBeNull();
    expect(referenceOf([other, official, retailer])?.url).toBe('r');
    expect(referenceOf([official])).toBeNull();
  });
});

describe('evidence state of an attribute', () => {
  const base = { hasValue: true, references: [], manualCount: 0, captureExpected: true };
  it('says how well a value is backed', () => {
    expect(evidenceState({ ...base, hasValue: false })).toBe('none');
    expect(evidenceState(base)).toBe('missing');
    expect(
      evidenceState({ ...base, references: [{ capture_status: 'COMPLETE' }, { capture_status: 'NO_MATCH' }] })
    ).toBe('captured');
    expect(evidenceState({ ...base, references: [{ capture_status: 'NO_MATCH' }] })).toBe('check');
    expect(evidenceState({ ...base, captureExpected: false, references: [{}] })).toBe('text');
    // the reviewer's own evidence backs the value
    expect(evidenceState({ ...base, references: [{ capture_status: 'NO_MATCH' }], manualCount: 1 })).toBe('captured');
  });

  it('finds the attribute of a validation issue', () => {
    expect(attributeCodeOf('attributes.900153')).toBe('900153');
    expect(attributeCodeOf('attribute.A1')).toBe('A1');
    expect(attributeCodeOf('fact.Weight')).toBeNull();
    expect(attributeCodeOf(null)).toBeNull();
  });
});
