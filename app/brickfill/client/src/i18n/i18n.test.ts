import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NAMESPACES, resources } from './resources';
import { SUPPORTED_LANGUAGES, matchLanguage } from './languages';

type Tree = { [key: string]: string | Tree };

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const entries = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') entries.set(name, value);
    else for (const [child, text] of flatten(value, name)) entries.set(child, text);
  }
  return entries;
}

/** Keys without plural suffixes, so "showing_one"/"showing_other" count as "showing". */
function baseKeys(tree: Tree): Set<string> {
  return new Set(Array.from(flatten(tree).keys(), (key) => key.replace(PLURAL_SUFFIX, '')));
}

function placeholders(text: string): string[] {
  return Array.from(text.matchAll(/{{\s*(\w+)\s*}}/g), (match) => match[1]).sort();
}

const languages = SUPPORTED_LANGUAGES.map((language) => language.code);
const all = resources as unknown as Record<string, Record<string, Tree>>;

describe('locale resources', () => {
  it('ships every namespace for every language', () => {
    for (const language of languages) {
      expect(Object.keys(all[language]).sort()).toEqual([...NAMESPACES].sort());
    }
  });

  for (const namespace of NAMESPACES) {
    it(`${namespace}: every language has exactly the English keys`, () => {
      const english = Array.from(baseKeys(all.en[namespace])).sort();
      for (const language of languages) {
        expect({ language, keys: Array.from(baseKeys(all[language][namespace])).sort() }).toEqual({
          language,
          keys: english,
        });
      }
    });

    it(`${namespace}: translations keep the English placeholders`, () => {
      const english = flatten(all.en[namespace]);
      for (const language of languages) {
        for (const [key, text] of flatten(all[language][namespace])) {
          const source = english.get(key) ?? english.get(key.replace(PLURAL_SUFFIX, '_other'));
          expect(source, `${language}:${namespace}:${key} has no English source`).toBeDefined();
          expect({ key: `${language}:${namespace}:${key}`, vars: placeholders(text) }).toEqual({
            key: `${language}:${namespace}:${key}`,
            vars: placeholders(source ?? ''),
          });
        }
      }
    });
  }
});

/** Every literal "namespace:key" in the client source must exist in English (dynamic keys are checked elsewhere). */
describe('keys used in the source', () => {
  const root = path.resolve(__dirname, '..');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts')) files.push(full);
    }
  };
  walk(root);
  const pattern = new RegExp(`['"](${NAMESPACES.join('|')}):([A-Za-z0-9_.]+)['"]`, 'g');

  it('resolve to an English string', () => {
    const missing: string[] = [];
    for (const file of files) {
      for (const match of readFileSync(file, 'utf8').matchAll(pattern)) {
        const [, namespace, key] = match;
        const keys = baseKeys(all.en[namespace]);
        if (!keys.has(key)) missing.push(`${path.relative(root, file)}: ${namespace}:${key}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('server and pipeline codes', () => {
  it('translate every server error code', () => {
    const source = readFileSync(path.resolve(__dirname, '../../../server/http-errors.ts'), 'utf8');
    const block = source.slice(source.indexOf('ERROR_MESSAGES'), source.indexOf('} as const'));
    const codes = Array.from(block.matchAll(/^\s+([A-Z_]+):/gm), (match) => match[1]);
    expect(codes.length).toBeGreaterThan(10);
    const translated = baseKeys(all.en.errors);
    expect(codes.filter((code) => !translated.has(code))).toEqual([]);
  });

  it('translate every validation issue code of the interface', () => {
    const codes = [
      'INVALID_GTIN',
      'BRAND_TITLE_CONFLICT',
      'INVALID_LENGTH',
      'FACT_SHEET_MISSING_GTIN',
      'INVALID_ENRICHED_GTIN',
      'GTIN_LOGISTIC_RELATION_CONFLICT',
      'GTIN_PACKAGING_LEVEL_CONFLICT',
      'CATEGORY_REQUIRED_FACT',
      'TITLE_MISSING_BRAND',
      'DESCRIPTION_LINK',
      'META_SUFFIX',
      'FAQ_COUNT',
      'UNRESOLVED_SOURCE_CONFLICT',
      'EMOJI',
      'PROMOTIONAL_LANGUAGE',
      'DUPLICATE_ATTRIBUTE',
      'MISSING_ATTRIBUTE_DEFINITION',
      'UNKNOWN_ATTRIBUTE',
      'VOCABULARY_VALUE_NOT_ALLOWED',
      'VOCABULARY_VALUE_PREAPPROVED',
      'VOCABULARY_VALUE_PENDING',
      'MISSING_REQUIRED_ATTRIBUTE',
      'UNCITED_ATTRIBUTE',
      'MISSING_ATTRIBUTE_OBSERVATION',
      'GENERIC_ATTRIBUTE_VALUE',
      'NON_OFFICIAL_FAQ_SOURCE',
      'IMAGE_DIMENSIONS_UNKNOWN',
      'IMAGE_RESOLUTION',
      'IMAGE_BACKGROUND_UNVERIFIED',
      'NO_IMAGE_CANDIDATE',
      'VISUAL_EVIDENCE_INCOMPLETE',
      'AGENT_FAILURE',
      'META_ENDING',
      'ELECTRO_REQUIRED_FIELD',
      'FACT_SHEET_MISSING_EAN',
    ];
    const translated = baseKeys(all.en.issues);
    expect(codes.filter((code) => !translated.has(`codes.${code}.message`))).toEqual([]);
  });
});

describe('matchLanguage', () => {
  it('maps browser tags to shipped languages', () => {
    expect(matchLanguage('pt-PT')).toBe('pt-BR');
    expect(matchLanguage('pt-br')).toBe('pt-BR');
    expect(matchLanguage('es-MX')).toBe('es');
    expect(matchLanguage('en-GB')).toBe('en');
    expect(matchLanguage('de-DE')).toBeNull();
    expect(matchLanguage(undefined)).toBeNull();
  });
});
