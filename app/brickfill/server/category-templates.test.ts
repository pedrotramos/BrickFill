import { describe, expect, it } from 'vitest';
import { readInstructionEditors } from './app-config';
import { seedFileName, templateManifest, templateSchemas } from './category-templates';
import { FALLBACK_MANIFEST, overrideKeys } from './content-manifest';
import { changes } from './settings-events';

const { Body, Seed } = templateSchemas(FALLBACK_MANIFEST);
const valid = {
  name: 'Hair dryer',
  match: { subcategory_ids: ['564'], synonyms: ['Secador'] },
  overrides: {
    title_order: ['product_type', 'brand', 'model', 'Speed', 'Temperature', 'Power', 'color', 'Voltage'],
    fact_sheet_layout: [{ section: 'key_features', fields: ['Power', 'Speeds'] }],
    required_fact_labels: ['warranty'],
  },
  expectedRevision: 0,
};

describe('category template schemas', () => {
  it('accepts a template with a title formula, a fact-sheet layout and required facts', () => {
    const parsed = Body.parse(valid);
    expect(parsed.active).toBe(true);
    expect(parsed.match.category_ids).toEqual([]);
  });

  it('only allows the template override keys', () => {
    expect(Body.safeParse({ ...valid, overrides: { title_max_length: 120 } }).success).toBe(false);
    expect(Object.keys(templateManifest(FALLBACK_MANIFEST).overrides).sort()).toEqual(
      overrideKeys(FALLBACK_MANIFEST, 'template').sort()
    );
    expect(overrideKeys(FALLBACK_MANIFEST, 'settings')).not.toContain('title_order');
  });

  it('needs at least one association and a non-empty formula, without repeated sections', () => {
    expect(Body.safeParse({ ...valid, match: {} }).success).toBe(false);
    expect(Body.safeParse({ ...valid, overrides: { title_order: [] } }).success).toBe(false);
    const repeated = [
      { section: 'Specs', fields: [] },
      { section: 'specs', fields: [] },
    ];
    expect(Body.safeParse({ ...valid, overrides: { fact_sheet_layout: repeated } }).success).toBe(false);
  });

  it('validates seed entries by identifier', () => {
    expect(Seed.safeParse({ ...valid, id: 'hair-dryer' }).success).toBe(true);
    expect(Seed.safeParse({ ...valid, id: 'Hair Dryer' }).success).toBe(false);
  });

  it('reads the seed file name only as a plain JSON file of config/', () => {
    expect(seedFileName('category-templates.json')).toBe('category-templates.json');
    expect(seedFileName('none')).toBeNull();
    expect(seedFileName(undefined)).toBeNull();
    expect(() => seedFileName('../secrets.json')).toThrow();
    expect(() => seedFileName('templates.yaml')).toThrow();
  });
});

describe('field-level history', () => {
  it('compares match and overrides key by key', () => {
    const before = { name: 'Dryer', active: true, match: { synonyms: ['a'] }, overrides: { title_order: ['brand'] } };
    const after = { name: 'Dryer', active: false, match: { synonyms: ['a', 'b'] }, overrides: {} };
    expect(changes(before, after)).toEqual([
      { key: 'active', before: true, after: false },
      { key: 'match.synonyms', before: ['a'], after: ['a', 'b'] },
      { key: 'overrides.title_order', before: ['brand'], after: null },
    ]);
  });

  it('ignores the key order of a stored object', () => {
    const stored = { overrides: { fact_sheet_layout: [{ fields: ['Power'], section: 'Specs' }] } };
    const sent = { overrides: { fact_sheet_layout: [{ section: 'Specs', fields: ['Power'] }] } };
    expect(changes(stored, sent)).toEqual([]);
  });

  it('records no change for the empty fields of a new record', () => {
    const created = {
      name: 'Dryer',
      match: { synonyms: [], subcategory_ids: ['100'] },
      overrides: { title_order: [] },
    };
    expect(changes({}, created)).toEqual([
      { key: 'match.subcategory_ids', before: null, after: ['100'] },
      { key: 'name', before: null, after: 'Dryer' },
    ]);
  });
});

describe('agent instruction editors', () => {
  it('uses its own list, else the settings editors, else nobody', () => {
    expect([...readInstructionEditors({ AGENT_INSTRUCTIONS_EDITORS: 'A@x.com', SETTINGS_EDITORS: 'b@x.com' })]).toEqual(
      ['a@x.com']
    );
    expect([...readInstructionEditors({ AGENT_INSTRUCTIONS_EDITORS: 'none', SETTINGS_EDITORS: 'b@x.com' })]).toEqual([
      'b@x.com',
    ]);
    expect(readInstructionEditors({}).size).toBe(0);
  });
});
