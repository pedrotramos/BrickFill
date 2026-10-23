import { describe, expect, it } from 'vitest';
import { formatDate, formatNumber, formatPercent } from './formatters';

describe('formatters', () => {
  it('formats percentages per language', () => {
    expect(formatPercent(12.5, 'en')).toBe('12.5%');
    expect(formatPercent(12.5, 'pt-BR')).toBe('12,5%');
    expect(formatPercent(12.5, 'es').replace(/\s/g, ' ')).toBe('12,5 %');
    expect(formatPercent(null, 'en')).toBe('0%');
    expect(formatPercent('not a number', 'en')).toBe('0%');
  });

  it('formats numbers per language', () => {
    expect(formatNumber(1234567, 'en')).toBe('1,234,567');
    expect(formatNumber(1234567, 'pt-BR')).toBe('1.234.567');
    expect(formatNumber('42', 'es')).toBe('42');
  });

  it('formats dates per language and explains missing ones', () => {
    const date = '2026-03-04T12:00:00Z';
    expect(formatDate(date, 'en')).toMatch(/3\/4\/26/);
    expect(formatDate(date, 'pt-BR')).toMatch(/04\/03\/2026/);
    expect(formatDate(null, 'en')).toBe('Not updated yet');
    expect(formatDate(undefined, 'pt-BR')).toBe('Ainda não atualizado');
    expect(formatDate('', 'es')).toBe('Aún sin actualizar');
  });
});
