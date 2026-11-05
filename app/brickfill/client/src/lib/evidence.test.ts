import { describe, expect, it } from 'vitest';
import { captureLabelKey, hostname } from './evidence';

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
