import { useTranslation } from '../i18n/react';
import type { CategoryLevel } from './category-tree';

export const LEVELS: CategoryLevel[] = ['department', 'category', 'subcategory'];

/** Semantic title tokens the prompt knows; any other token is used as written (e.g. "Velocidade"). */
export const KNOWN_TOKENS = [
  'product_type',
  'brand',
  'model',
  'key_feature',
  'secondary_feature',
  'color',
  'variant',
  'quantity',
];

/** The label of a title token in the interface language; a custom token is shown as written. */
export function useTokenLabel() {
  const { t, i18n } = useTranslation();
  return (token: string) => (i18n.exists(`templates:tokens.${token}`) ? t(`templates:tokens.${token}`) : token);
}
