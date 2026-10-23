import { describe, expect, it } from 'vitest';
import {
  AttributeCode,
  attributePathSegment,
  createManualEvidencePolicy,
  manualScreenshotPath,
  parseManualScreenshotPath,
} from './manual-evidence';

const root = '/Volumes/main/brickfill/manual_evidence';
const digest = 'a'.repeat(64);

describe('AttributeCode', () => {
  it('accepts any non-blank code of the contract', () => {
    for (const code of ['color', 'size.cm', 'a/b', 'net weight', 'x'.repeat(150)]) {
      expect(AttributeCode.safeParse(code).success).toBe(true);
    }
    expect(AttributeCode.safeParse('  ').success).toBe(false);
  });
});

describe('manual screenshot paths', () => {
  it('keeps plain codes readable and hashes the others into one safe segment', () => {
    expect(attributePathSegment('color_name')).toBe('color_name');
    for (const code of ['a/../b', '..', 'size.cm', 'net weight']) {
      expect(attributePathSegment(code)).toMatch(/^~[0-9a-f]{64}$/);
    }
    expect(attributePathSegment('a/b')).not.toBe(attributePathSegment('a.b'));
  });

  it('round-trips through parsing and passes the upload policy', () => {
    const policy = createManualEvidencePolicy(root);
    const user = { id: 'sp', isServicePrincipal: true } as Parameters<typeof policy>[2];
    for (const code of ['color', 'a/../b']) {
      const path = manualScreenshotPath(root, '7891234567895', code, digest, 'png');
      expect(parseManualScreenshotPath(root, path, '7891234567895', code)).toEqual({
        sha256: digest,
        contentType: 'image/png',
      });
      expect(parseManualScreenshotPath(root, path, '7891234567895', 'other')).toBeUndefined();
      expect(policy('upload', { volume: 'manual_evidence', path } as Parameters<typeof policy>[1], user)).toBe(true);
    }
  });
});
