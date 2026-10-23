import { describe, expect, it } from 'vitest';
import { hostname } from './evidence';

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
