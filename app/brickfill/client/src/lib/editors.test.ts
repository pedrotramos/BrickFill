import { describe, expect, it } from 'vitest';
import { templateIdFrom, titleExample } from './editors';

describe('templateIdFrom', () => {
  it('derives a lowercase identifier without accents', () => {
    expect(templateIdFrom('Secador de Cabelo')).toBe('secador-de-cabelo');
    expect(templateIdFrom('  Ar-condicionado / Split ')).toBe('ar-condicionado-split');
  });
});

describe('titleExample', () => {
  it('follows the formula and leaves out tokens without a value', () => {
    const order = ['product_type', 'brand', 'model', 'Velocidade', 'color', 'voltage'];
    expect(
      titleExample(order, { product_type: 'Secador', brand: 'Acme', model: 'X1', color: '', voltage: '127V' })
    ).toBe('Secador Acme X1 Velocidade 127V');
  });
});
