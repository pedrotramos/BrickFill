import enArchitecture from './locales/en/architecture.json';
import enCatalog from './locales/en/catalog.json';
import enCommon from './locales/en/common.json';
import enErrors from './locales/en/errors.json';
import enIssues from './locales/en/issues.json';
import enOverview from './locales/en/overview.json';
import enProduct from './locales/en/product.json';
import enSettings from './locales/en/settings.json';
import esArchitecture from './locales/es/architecture.json';
import esCatalog from './locales/es/catalog.json';
import esCommon from './locales/es/common.json';
import esErrors from './locales/es/errors.json';
import esIssues from './locales/es/issues.json';
import esOverview from './locales/es/overview.json';
import esProduct from './locales/es/product.json';
import esSettings from './locales/es/settings.json';
import ptArchitecture from './locales/pt-BR/architecture.json';
import ptCatalog from './locales/pt-BR/catalog.json';
import ptCommon from './locales/pt-BR/common.json';
import ptErrors from './locales/pt-BR/errors.json';
import ptIssues from './locales/pt-BR/issues.json';
import ptOverview from './locales/pt-BR/overview.json';
import ptProduct from './locales/pt-BR/product.json';
import ptSettings from './locales/pt-BR/settings.json';

export const NAMESPACES = [
  'common',
  'overview',
  'catalog',
  'product',
  'architecture',
  'settings',
  'issues',
  'errors',
] as const;

export const resources = {
  en: {
    common: enCommon,
    overview: enOverview,
    catalog: enCatalog,
    product: enProduct,
    architecture: enArchitecture,
    settings: enSettings,
    issues: enIssues,
    errors: enErrors,
  },
  'pt-BR': {
    common: ptCommon,
    overview: ptOverview,
    catalog: ptCatalog,
    product: ptProduct,
    architecture: ptArchitecture,
    settings: ptSettings,
    issues: ptIssues,
    errors: ptErrors,
  },
  es: {
    common: esCommon,
    overview: esOverview,
    catalog: esCatalog,
    product: esProduct,
    architecture: esArchitecture,
    settings: esSettings,
    issues: esIssues,
    errors: esErrors,
  },
} as const;
