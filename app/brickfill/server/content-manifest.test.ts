import { describe, expect, it } from 'vitest';
import { FALLBACK_MANIFEST, type SettingsLayer, lengthConflict } from './content-manifest';

const none = new Map<string, SettingsLayer>();

describe('lengthConflict', () => {
  it('checks a lone minimum against the profile maximum', () => {
    const global = { overrides: { short_description_min_length: 500 } };
    expect(lengthConflict(FALLBACK_MANIFEST, 'default', global, none, [])).toEqual({
      key: 'short_description_min_length',
      minimum: 500,
      maximum: 300,
      layers: ['global'],
    });
    expect(
      lengthConflict(FALLBACK_MANIFEST, 'default', { overrides: { short_description_min_length: 200 } }, none, [])
    ).toBeUndefined();
  });

  it('resolves the global and scope layers each product would get', () => {
    const global = { overrides: { short_description_max_length: 600 } };
    const scopes = new Map<string, SettingsLayer>([
      ['category:10', { overrides: { short_description_min_length: 500 } }],
      ['subcategory:11', { overrides: { short_description_max_length: 400 } }],
    ]);
    // A product of category 10 in another subcategory is fine (min 500 <= max 600)...
    expect(
      lengthConflict(FALLBACK_MANIFEST, 'default', global, scopes, [{ category_id: '10', subcategory_id: '12' }])
    ).toBeUndefined();
    // ...one in subcategory 11 gets min 500 > max 400.
    expect(
      lengthConflict(FALLBACK_MANIFEST, 'default', global, scopes, [{ category_id: '10', subcategory_id: '11' }])
    ).toMatchObject({ key: 'short_description_min_length', layers: ['global', 'category:10', 'subcategory:11'] });
    // Scopes no product falls under together are not combined.
    expect(
      lengthConflict(FALLBACK_MANIFEST, 'default', global, scopes, [{ category_id: '20', subcategory_id: '11' }])
    ).toBeUndefined();
  });
});
