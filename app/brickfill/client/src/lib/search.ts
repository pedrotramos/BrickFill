/** Search key of a text: no accents, lower case, single spaces ("Eletrodomésticos" and "eletrodomesticos" match). */
export function matchKey(text: string | null | undefined): string {
  return (text ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every word of the query appears in one of the terms (name, identifier, synonyms), ignoring accents and case. */
export function matchesSearch(query: string, terms: readonly (string | null | undefined)[]): boolean {
  const words = matchKey(query).split(' ').filter(Boolean);
  if (!words.length) return true;
  const haystack = terms.map(matchKey).join(' | ');
  return words.every((word) => haystack.includes(word));
}
