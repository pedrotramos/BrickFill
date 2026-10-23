import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = fs.readFileSync(path.join(__dirname, 'index.css'), 'utf8');

/** Declarations (comments left out) of the first block opened by `opening`, one per line, in order. */
function block(opening: string) {
  const start = css.indexOf(opening);
  expect(start, opening).toBeGreaterThanOrEqual(0);
  const body = css.slice(start + opening.length, css.indexOf('}', start)).replace(/\/\*[\s\S]*?\*\//g, '');
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

describe('index.css dark theme', () => {
  it('draws the same palette for the .dark class and for the system setting', () => {
    const forClass = block('.dark {');
    expect(forClass).toContain('color-scheme: dark;');
    expect(block(':root:not(.light) {')).toEqual(forClass);
  });
});
