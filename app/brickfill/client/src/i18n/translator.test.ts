import { describe, expect, it } from 'vitest';
import { Translator } from './translator';

function translator(lng = 'pt-BR') {
  return new Translator({
    lng,
    defaultNS: 'common',
    fallbackLng: 'en',
    supportedLngs: ['en', 'pt-BR', 'es'],
    resources: {
      en: {
        common: {
          hello: 'Hello {{name}}',
          onlyEnglish: 'English only',
          rows_one: '{{count}} row',
          rows_other: '{{count}} rows',
        },
        catalog: { title: { page: 'Catalog' } },
      },
      'pt-BR': {
        common: { hello: 'Olá {{name}}', rows_one: '{{count}} linha', rows_other: '{{count}} linhas' },
        catalog: { title: { page: 'Catálogo' } },
      },
      es: { common: { rows_one: '{{count}} fila', rows_many: '{{count}} de filas', rows_other: '{{count}} filas' } },
    },
  });
}

describe('Translator', () => {
  it('resolves namespaces, dotted paths and interpolation', () => {
    const i18n = translator();
    expect(i18n.t('catalog:title.page')).toBe('Catálogo');
    expect(i18n.t('hello', { name: 'Ana' })).toBe('Olá Ana');
    expect(i18n.t('common:hello', { name: 0 })).toBe('Olá 0');
    expect(i18n.t('hello')).toBe('Olá {{name}}');
  });

  it('falls back to English, then to defaultValue, then to the key path', () => {
    const i18n = translator();
    expect(i18n.t('onlyEnglish')).toBe('English only');
    expect(i18n.t('catalog:missing.key', { defaultValue: 'x' })).toBe('x');
    expect(i18n.t('catalog:missing.key')).toBe('missing.key');
    expect(i18n.exists('onlyEnglish')).toBe(true);
    expect(i18n.exists('catalog:title')).toBe(false);
  });

  it('chooses plural forms with the language rules', () => {
    const i18n = translator();
    expect(i18n.t('rows', { count: 1 })).toBe('1 linha');
    expect(i18n.t('rows', { count: 3 })).toBe('3 linhas');
    expect(i18n.exists('rows', { count: 2 })).toBe(true);
    expect(i18n.t('rows', { count: 1_000_000, lng: 'es' })).toBe('1000000 de filas');
    expect(i18n.t('rows', { count: 2, lng: 'es' })).toBe('2 filas');
    expect(i18n.t('rows', { count: 2, lng: 'en' })).toBe('2 rows');
  });

  it('changes language, notifies listeners and ignores unsupported languages', async () => {
    const i18n = translator('fr');
    expect(i18n.resolvedLanguage).toBe('en');
    const seen: string[] = [];
    const listener = (language: string) => seen.push(language);
    i18n.on('languageChanged', listener);
    await i18n.changeLanguage('es');
    await i18n.changeLanguage('es');
    i18n.off('languageChanged', listener);
    await i18n.changeLanguage('pt-BR');
    expect(seen).toEqual(['es']);
    expect(i18n.language).toBe('pt-BR');
    const { t } = i18n;
    expect(t('hello', { name: 'Rui' })).toBe('Olá Rui');
  });
});
