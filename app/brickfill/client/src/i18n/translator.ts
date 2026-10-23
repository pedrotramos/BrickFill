/*
 * A minimal i18next-compatible translator. The Databricks Apps npm mirror doesn't serve i18next or react-i18next, so
 * the app ships the subset it uses: "namespace:dotted.path" keys, {{name}} interpolation, plural keys
 * (key_one, key_other… chosen with Intl.PluralRules), defaultValue, a per-call lng, a fallback language and the
 * languageChanged event. Messages are plain strings (React escapes them), so nothing is HTML-escaped here.
 */

export type MessageTree = { [key: string]: string | MessageTree };
export type Resources = Record<string, Record<string, MessageTree>>;

export interface TOptions {
  count?: number;
  defaultValue?: string;
  lng?: string;
  [param: string]: unknown;
}

export type TFunction = (key: string, options?: TOptions) => string;

export interface TranslatorConfig {
  resources: Resources;
  defaultNS: string;
  fallbackLng: string;
  supportedLngs: readonly string[];
  lng: string;
}

type Listener = (language: string) => void;

const PLACEHOLDER = /{{\s*(\w+)\s*}}/g;

export class Translator {
  language: string;
  private readonly config: TranslatorConfig;
  private readonly listeners = new Set<Listener>();
  private readonly pluralRules = new Map<string, Intl.PluralRules>();

  constructor(config: TranslatorConfig) {
    this.config = config;
    this.language = this.supported(config.lng);
    // Bound so it can be passed around like i18next's t.
    this.t = this.t.bind(this);
  }

  /** The active language; always one of supportedLngs here, as with i18next's resolvedLanguage. */
  get resolvedLanguage(): string {
    return this.language;
  }

  t(key: string, options: TOptions = {}): string {
    const template = this.resolve(key, options);
    if (template === undefined) return options.defaultValue ?? this.split(key)[1];
    return template.replace(PLACEHOLDER, (match, name: string) => {
      const value = options[name];
      return value === undefined || value === null ? match : String(value);
    });
  }

  exists(key: string, options: TOptions = {}): boolean {
    return this.resolve(key, options) !== undefined;
  }

  getResource(language: string, namespace: string, path: string): unknown {
    let node: unknown = this.config.resources[language]?.[namespace];
    for (const part of path.split('.')) {
      if (typeof node !== 'object' || node === null) return undefined;
      node = (node as MessageTree)[part];
    }
    return node;
  }

  changeLanguage(language: string): Promise<void> {
    const next = this.supported(language);
    if (next !== this.language) {
      this.language = next;
      for (const listener of this.listeners) listener(next);
    }
    return Promise.resolve();
  }

  on(event: 'languageChanged', listener: Listener): void {
    if (event === 'languageChanged') this.listeners.add(listener);
  }

  off(event: 'languageChanged', listener: Listener): void {
    if (event === 'languageChanged') this.listeners.delete(listener);
  }

  private supported(language: string): string {
    return this.config.supportedLngs.includes(language) ? language : this.config.fallbackLng;
  }

  private split(key: string): [string, string] {
    const separator = key.indexOf(':');
    if (separator > 0) {
      const namespace = key.slice(0, separator);
      if (this.config.resources[this.config.fallbackLng]?.[namespace]) return [namespace, key.slice(separator + 1)];
    }
    return [this.config.defaultNS, key];
  }

  /** The template of ``key`` in the call's language, then the fallback language; plural forms first when counted. */
  private resolve(key: string, options: TOptions): string | undefined {
    const [namespace, path] = this.split(key);
    const languages = [options.lng ? this.supported(options.lng) : this.language, this.config.fallbackLng];
    for (const language of languages) {
      const candidates =
        typeof options.count === 'number'
          ? [`${path}_${this.plural(language, options.count)}`, `${path}_other`, path]
          : [path];
      for (const candidate of candidates) {
        const value = this.getResource(language, namespace, candidate);
        if (typeof value === 'string') return value;
      }
    }
    return undefined;
  }

  private plural(language: string, count: number): Intl.LDMLPluralRule {
    let rules = this.pluralRules.get(language);
    if (!rules) {
      rules = new Intl.PluralRules(language);
      this.pluralRules.set(language, rules);
    }
    return rules.select(count);
  }
}
