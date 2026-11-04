import { describe, expect, it } from 'vitest';
import { matchesSearch, matchKey } from './search';

describe('matchKey', () => {
  it('ignores accents, case and repeated spaces', () => {
    expect(matchKey('  Eletrodomésticos   PORTÁTEIS ')).toBe('eletrodomesticos portateis');
    expect(matchKey(null)).toBe('');
  });
});

describe('matchesSearch', () => {
  it('finds by name, identifier or synonym, word by word', () => {
    const terms = ['Secadores de cabelo', '564', 'hair dryer', 'Secador'];
    expect(matchesSearch('secador', terms)).toBe(true);
    expect(matchesSearch('CABELO secadores', terms)).toBe(true);
    expect(matchesSearch('564', terms)).toBe(true);
    expect(matchesSearch('dryer', terms)).toBe(true);
    expect(matchesSearch('chapinha', terms)).toBe(false);
    expect(matchesSearch('', terms)).toBe(true);
  });
});
