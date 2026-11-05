import { describe, expect, it } from 'vitest';
import { attributeCodeOf, captureLabelKey, evidenceState, hostname } from './evidence';

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

describe('captureLabelKey', () => {
  it('maps the job statuses', () => {
    expect(captureLabelKey('COMPLETE', null, true)).toBe('COMPLETE');
    expect(captureLabelKey('NO_MATCH', null, true)).toBe('NO_MATCH');
    expect(captureLabelKey(null, null, false)).toBe('LEGACY');
    expect(captureLabelKey(null, null, true)).toBe('INCOMPLETE');
    expect(captureLabelKey('SOMETHING_NEW', null, true)).toBe('INCOMPLETE');
  });

  it('labels a blank screenshot apart from other failures', () => {
    expect(captureLabelKey('FAILED', 'Firecrawl returned a blank screenshot; the page was not rendered', true)).toBe(
      'BLANK'
    );
    expect(captureLabelKey('FAILED', 'Missing rendered text coordinates', true)).toBe('FAILED');
  });

  it('labels PDF crop failures apart, but keeps the old text-only PDF label', () => {
    expect(captureLabelKey('NO_MATCH', "PDF: the value was not found in the document's text.", true)).toBe(
      'PDF_FAILED'
    );
    expect(captureLabelKey('UNSUPPORTED', 'PDF: text extracted by Firecrawl', true)).toBe('UNSUPPORTED');
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
