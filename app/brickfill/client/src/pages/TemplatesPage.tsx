import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@databricks/appkit-ui/react';
import { AlertCircle, ArrowDown, ArrowUp, Lock, Pencil, Plus, Save, X } from 'lucide-react';
import { useTranslation } from '../i18n/react';
import { CategoryCombobox } from '../components/CategoryCombobox';
import { PageHeader, RefreshButton } from '../components/PageHeader';
import { ApiError, errorText } from '../lib/api-errors';
import { useCatalogQuery } from '../lib/catalog-query';
import { categoryOptions, type CategoryLevel, type CategoryTreeRow } from '../lib/category-tree';
import {
  loadTemplates,
  saveTemplate,
  templateIdFrom,
  titleExample,
  type CategoryTemplate,
  type TemplateMatch,
  type TemplatesState,
} from '../lib/editors';
import { formatDate } from '../lib/formatters';
import type { Overrides } from '../lib/settings';

const NO_PARAMETERS = {};
const LEVELS: CategoryLevel[] = ['department', 'category', 'subcategory'];
/** Semantic title tokens the prompt knows; any other token is used as written (e.g. "Velocidade"). */
const KNOWN_TOKENS = [
  'product_type',
  'brand',
  'model',
  'key_feature',
  'secondary_feature',
  'color',
  'variant',
  'quantity',
];

interface Section {
  section: string;
  fields: string[];
}

interface Draft {
  id: string;
  name: string;
  match: TemplateMatch;
  titleOrder: string[];
  samples: Record<string, string>;
  layout: Section[];
  mustInclude: string;
  required: string;
  optional: string;
  active: boolean;
  reason: string;
}

const EMPTY_MATCH: TemplateMatch = {
  department_ids: [],
  category_ids: [],
  subcategory_ids: [],
  department_names: [],
  category_names: [],
  subcategory_names: [],
  synonyms: [],
};

const lines = (value: string) => [
  ...new Set(
    value
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean)
  ),
];
const list = (value: unknown) => (Array.isArray(value) ? value.map(String) : []);

function draftOf(template: CategoryTemplate | null, defaults: Overrides): Draft {
  const overrides = template?.overrides ?? {};
  const pick = (key: string) => (key in overrides ? overrides[key] : defaults[key]);
  return {
    id: template?.id ?? '',
    name: template?.name ?? '',
    match: { ...EMPTY_MATCH, ...(template?.match ?? {}) } as TemplateMatch,
    titleOrder: list(pick('title_order')),
    samples: {},
    layout: Array.isArray(pick('fact_sheet_layout')) ? (pick('fact_sheet_layout') as Section[]) : [],
    mustInclude: list(pick('fact_sheet_must_include')).join('\n'),
    required: list(overrides.required_fact_labels).join('\n'),
    optional: list(overrides.optional_fact_labels).join('\n'),
    active: template?.active ?? true,
    reason: '',
  };
}

/** Only what differs from the profile is saved, so a later profile change still reaches the template. */
function overridesOf(draft: Draft, defaults: Overrides): Overrides {
  const candidate: Overrides = {
    title_order: draft.titleOrder,
    fact_sheet_layout: draft.layout
      .map((item) => ({ section: item.section.trim(), fields: item.fields.map((f) => f.trim()).filter(Boolean) }))
      .filter((item) => item.section),
    fact_sheet_must_include: lines(draft.mustInclude),
    required_fact_labels: lines(draft.required),
    optional_fact_labels: lines(draft.optional),
  };
  return Object.fromEntries(
    Object.entries(candidate).filter(
      ([key, value]) =>
        JSON.stringify(value) !== JSON.stringify(defaults[key] ?? []) &&
        !(Array.isArray(value) && !value.length && key !== 'fact_sheet_layout')
    )
  );
}

function useTokenLabel() {
  const { t, i18n } = useTranslation();
  return (token: string) => (i18n.exists(`templates:tokens.${token}`) ? t(`templates:tokens.${token}`) : token);
}

function TemplateEditor({
  open,
  onOpenChange,
  template,
  state,
  tree,
  onSaved,
  onConflict,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: CategoryTemplate | null;
  state: TemplatesState;
  tree: CategoryTreeRow[];
  onSaved: () => Promise<void>;
  onConflict: () => void;
}) {
  const { t } = useTranslation();
  const tokenLabel = useTokenLabel();
  const defaults = state.manifest.profile_defaults.default ?? {};
  const [draft, setDraft] = useState<Draft>(() => draftOf(template, defaults));
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = useMemo(
    () => Object.fromEntries(LEVELS.map((level) => [level, categoryOptions(tree, level)])),
    [tree]
  ) as Record<CategoryLevel, ReturnType<typeof categoryOptions>>;

  useEffect(() => {
    if (open) {
      setDraft(draftOf(template, defaults));
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the dialog opens
  }, [open, template]);

  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const move = <T,>(items: T[], index: number, by: number) => {
    const next = [...items];
    const [item] = next.splice(index, 1);
    next.splice(Math.max(0, Math.min(next.length, index + by)), 0, item);
    return next;
  };
  const isNew = template === null;
  const id = isNew ? templateIdFrom(draft.name) : draft.id;
  const nameOf = (level: CategoryLevel, value: string) =>
    options[level].find((item) => item.id === value)?.name ?? value;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveTemplate(id, {
        name: draft.name.trim(),
        match: { ...draft.match, synonyms: draft.match.synonyms },
        overrides: overridesOf(draft, defaults),
        active: draft.active,
        expectedRevision: template?.revision ?? 0,
        reason: draft.reason.trim() || undefined,
      });
      onOpenChange(false);
      await onSaved();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'TEMPLATE_VERSION_CONFLICT') {
        onOpenChange(false);
        onConflict();
      } else {
        setError(errorText(caught, 'errors:TEMPLATE_SAVE_FAILED'));
      }
    } finally {
      setSaving(false);
    }
  };

  const associations = LEVELS.reduce((count, level) => count + draft.match[`${level}_ids`].length, 0);
  const valid = draft.name.trim() && id && draft.titleOrder.length && (associations || draft.match.synonyms.length);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? t('templates:editor.newTitle') : t('templates:editor.editTitle')}</DialogTitle>
          <DialogDescription>{t('templates:editor.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <section className="grid gap-4 md:grid-cols-[1fr_auto]">
            <div className="space-y-1.5">
              <Label htmlFor="template-name">{t('templates:editor.name')}</Label>
              <Input
                id="template-name"
                maxLength={120}
                placeholder={t('templates:editor.namePlaceholder')}
                value={draft.name}
                onChange={(event) => set({ name: event.target.value })}
              />
              <p className="text-xs text-muted-foreground">{t('templates:editor.id', { id: id || '—' })}</p>
            </div>
            <label className="flex items-center gap-2 pt-7 text-sm">
              <Checkbox checked={draft.active} onCheckedChange={(checked) => set({ active: checked === true })} />
              {t('templates:editor.active')}
            </label>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">{t('templates:editor.associations')}</h3>
            <p className="text-xs text-muted-foreground">{t('templates:editor.associationsHelp')}</p>
            <div className="grid gap-3 md:grid-cols-3">
              {LEVELS.map((level) => (
                <div className="space-y-1.5" key={level}>
                  <Label htmlFor={`template-${level}`}>{t(`settings:scopes.${level}`)}</Label>
                  <CategoryCombobox
                    id={`template-${level}`}
                    options={options[level]}
                    placeholder={t('templates:editor.add')}
                    value={null}
                    onChange={(value) => {
                      if (!value) return;
                      const key = `${level}_ids` as const;
                      set({ match: { ...draft.match, [key]: [...new Set([...draft.match[key], value])] } });
                    }}
                  />
                  <div className="flex flex-wrap gap-1">
                    {draft.match[`${level}_ids`].map((value) => (
                      <Badge className="gap-1" key={value} variant="outline">
                        {nameOf(level, value)}
                        <button
                          aria-label={t('common:actions.remove')}
                          type="button"
                          onClick={() =>
                            set({
                              match: {
                                ...draft.match,
                                [`${level}_ids`]: draft.match[`${level}_ids`].filter((item) => item !== value),
                              },
                            })
                          }
                        >
                          <X aria-hidden className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="template-synonyms">{t('templates:editor.synonyms')}</Label>
              <Textarea
                id="template-synonyms"
                placeholder={t('templates:editor.synonymsPlaceholder')}
                rows={2}
                value={draft.match.synonyms.join('\n')}
                onChange={(event) =>
                  set({ match: { ...draft.match, synonyms: event.target.value.split('\n').slice(0, 200) } })
                }
                onBlur={() => set({ match: { ...draft.match, synonyms: lines(draft.match.synonyms.join('\n')) } })}
              />
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">{t('templates:editor.title')}</h3>
            <p className="text-xs text-muted-foreground">{t('templates:editor.titleHelp')}</p>
            <ol className="space-y-1.5">
              {draft.titleOrder.map((item, index) => (
                <li className="flex flex-wrap items-center gap-2" key={`${item}-${index}`}>
                  <Badge variant="outline">{index + 1}</Badge>
                  <span className="min-w-36 text-sm">{tokenLabel(item)}</span>
                  <Input
                    aria-label={t('templates:editor.sampleFor', { token: tokenLabel(item) })}
                    className="h-8 max-w-48"
                    placeholder={t('templates:editor.sample')}
                    value={draft.samples[item] ?? ''}
                    onChange={(event) => set({ samples: { ...draft.samples, [item]: event.target.value } })}
                  />
                  <Button
                    aria-label={t('templates:editor.up')}
                    disabled={index === 0}
                    size="icon"
                    variant="ghost"
                    onClick={() => set({ titleOrder: move(draft.titleOrder, index, -1) })}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    aria-label={t('templates:editor.down')}
                    disabled={index === draft.titleOrder.length - 1}
                    size="icon"
                    variant="ghost"
                    onClick={() => set({ titleOrder: move(draft.titleOrder, index, 1) })}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    aria-label={t('common:actions.remove')}
                    size="icon"
                    variant="ghost"
                    onClick={() => set({ titleOrder: draft.titleOrder.filter((_, i) => i !== index) })}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                aria-label={t('templates:editor.addToken')}
                className="max-w-56"
                list="template-known-tokens"
                maxLength={40}
                placeholder={t('templates:editor.addToken')}
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
              <datalist id="template-known-tokens">
                {KNOWN_TOKENS.map((item) => (
                  <option key={item} value={item}>
                    {tokenLabel(item)}
                  </option>
                ))}
              </datalist>
              <Button
                disabled={!token.trim() || draft.titleOrder.length >= 15}
                size="sm"
                variant="outline"
                onClick={() => {
                  set({ titleOrder: [...new Set([...draft.titleOrder, token.trim()])] });
                  setToken('');
                }}
              >
                <Plus className="mr-1 h-4 w-4" />
                {t('templates:editor.add')}
              </Button>
            </div>
            <div className="rounded-md bg-muted p-3 text-sm">
              <p>
                <span className="font-medium">{t('templates:editor.formula')}</span>{' '}
                {draft.titleOrder.map(tokenLabel).join(' + ') || '—'}
              </p>
              <p>
                <span className="font-medium">{t('templates:editor.example')}</span>{' '}
                {titleExample(
                  draft.titleOrder.map(tokenLabel),
                  Object.fromEntries(Object.entries(draft.samples).map(([key, value]) => [tokenLabel(key), value]))
                ) || '—'}
              </p>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">{t('templates:editor.sheet')}</h3>
            <p className="text-xs text-muted-foreground">{t('templates:editor.sheetHelp')}</p>
            {draft.layout.map((item, index) => (
              <div className="grid gap-2 rounded-md border p-3 md:grid-cols-[1fr_1.4fr_auto]" key={index}>
                <Input
                  aria-label={t('templates:editor.sectionName')}
                  maxLength={60}
                  placeholder={t('templates:editor.sectionName')}
                  value={item.section}
                  onChange={(event) =>
                    set({
                      layout: draft.layout.map((section, i) =>
                        i === index ? { ...section, section: event.target.value } : section
                      ),
                    })
                  }
                />
                <Textarea
                  aria-label={t('templates:editor.sectionFields')}
                  placeholder={t('templates:editor.sectionFields')}
                  rows={3}
                  value={item.fields.join('\n')}
                  onChange={(event) =>
                    set({
                      layout: draft.layout.map((section, i) =>
                        i === index ? { ...section, fields: event.target.value.split('\n').slice(0, 30) } : section
                      ),
                    })
                  }
                />
                <div className="flex items-start gap-1">
                  <Button
                    aria-label={t('templates:editor.up')}
                    disabled={index === 0}
                    size="icon"
                    variant="ghost"
                    onClick={() => set({ layout: move(draft.layout, index, -1) })}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    aria-label={t('templates:editor.down')}
                    disabled={index === draft.layout.length - 1}
                    size="icon"
                    variant="ghost"
                    onClick={() => set({ layout: move(draft.layout, index, 1) })}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    aria-label={t('common:actions.remove')}
                    size="icon"
                    variant="ghost"
                    onClick={() => set({ layout: draft.layout.filter((_, i) => i !== index) })}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
            <Button
              disabled={draft.layout.length >= 12}
              size="sm"
              variant="outline"
              onClick={() => set({ layout: [...draft.layout, { section: '', fields: [] }] })}
            >
              <Plus className="mr-1 h-4 w-4" />
              {t('templates:editor.addSection')}
            </Button>
          </section>

          <section className="grid gap-4 md:grid-cols-3">
            {(
              [
                ['mustInclude', 'templates:editor.mustInclude'],
                ['required', 'templates:editor.required'],
                ['optional', 'templates:editor.optional'],
              ] as const
            ).map(([field, label]) => (
              <div className="space-y-1.5" key={field}>
                <Label htmlFor={`template-${field}`}>{t(label)}</Label>
                <Textarea
                  id={`template-${field}`}
                  placeholder={t('templates:editor.factsPlaceholder')}
                  rows={4}
                  value={draft[field]}
                  onChange={(event) => set({ [field]: event.target.value } as Partial<Draft>)}
                />
              </div>
            ))}
            <p className="text-xs text-muted-foreground md:col-span-3">{t('templates:editor.factsHelp')}</p>
          </section>

          <div className="space-y-1.5">
            <Label htmlFor="template-reason">{t('settings:reason')}</Label>
            <Input
              id="template-reason"
              maxLength={2000}
              placeholder={t('settings:reasonPlaceholder')}
              value={draft.reason}
              onChange={(event) => set({ reason: event.target.value })}
            />
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common:actions.cancel')}
          </Button>
          <Button disabled={saving || !valid} onClick={() => void save()}>
            <Save className="mr-2 h-4 w-4" />
            {saving ? t('common:actions.saving') : t('common:actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Content models per product type: title formula, fact-sheet structure and required facts, edited without a PR. */
export function TemplatesPage() {
  const { t } = useTranslation();
  const tokenLabel = useTokenLabel();
  const tree = useCatalogQuery('category_tree', NO_PARAMETERS);
  const [state, setState] = useState<TemplatesState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [editing, setEditing] = useState<CategoryTemplate | null>(null);
  const [open, setOpen] = useState(false);

  const reload = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const loaded = await loadTemplates(signal);
      if (signal?.aborted) return;
      setState(loaded);
      setConflict(false);
    } catch (caught) {
      if (!signal?.aborted) setError(errorText(caught, 'errors:TEMPLATES_LOAD_FAILED'));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [reload]);

  const treeRows = useMemo(() => (tree.data ?? []) as CategoryTreeRow[], [tree.data]);
  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const level of LEVELS)
      for (const item of categoryOptions(treeRows, level)) map.set(`${level}:${item.id}`, item.name);
    return map;
  }, [treeRows]);
  const associations = (template: CategoryTemplate) =>
    [
      ...LEVELS.flatMap((level) =>
        (template.match[`${level}_ids`] ?? []).map((id) => names.get(`${level}:${id}`) ?? id)
      ),
      ...(template.match.synonyms ?? []),
    ].join(', ');

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <PageHeader
        actions={
          <>
            {state?.canEdit ? (
              <Button
                onClick={() => {
                  setEditing(null);
                  setOpen(true);
                }}
              >
                <Plus className="mr-1 h-4 w-4" />
                {t('templates:new')}
              </Button>
            ) : null}
            <RefreshButton busy={loading} label={t('templates:reload')} onClick={() => void reload()} />
          </>
        }
        description={t('templates:subtitle')}
        title={t('templates:title')}
      />

      {conflict ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{t('errors:TEMPLATE_VERSION_CONFLICT')}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            {t('templates:conflict')}
            <Button size="sm" variant="outline" onClick={() => void reload()}>
              {t('common:actions.reload')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {state && !state.canEdit ? (
        <Alert>
          <Lock className="h-4 w-4" />
          <AlertTitle>{t('settings:readOnly.title')}</AlertTitle>
          <AlertDescription>{t('settings:readOnly.description')}</AlertDescription>
        </Alert>
      ) : null}

      {!state && loading ? (
        <Skeleton className="h-64" />
      ) : state ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle aria-level={2} role="heading">
                {t('templates:list.title')}
              </CardTitle>
              <CardDescription>{t('templates:list.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              {!state.templates.length ? (
                <p className="text-sm text-muted-foreground">{t('templates:list.empty')}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('templates:list.name')}</TableHead>
                      <TableHead>{t('templates:list.associations')}</TableHead>
                      <TableHead>{t('templates:list.formula')}</TableHead>
                      <TableHead>{t('templates:list.status')}</TableHead>
                      <TableHead>{t('templates:list.updated')}</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {state.templates.map((template) => {
                      const order = Array.isArray(template.overrides.title_order)
                        ? (template.overrides.title_order as string[])
                        : [];
                      return (
                        <TableRow key={template.id}>
                          <TableCell>
                            <span className="block font-medium">{template.name}</span>
                            <span className="block text-xs text-muted-foreground">{template.id}</span>
                          </TableCell>
                          <TableCell className="max-w-64 truncate text-sm">{associations(template)}</TableCell>
                          <TableCell className="max-w-72 truncate text-sm">
                            {order.map(tokenLabel).join(' + ') || t('templates:list.profileFormula')}
                          </TableCell>
                          <TableCell>
                            {template.active ? (
                              <Badge>{t('templates:list.active')}</Badge>
                            ) : (
                              <Badge variant="outline">{t('templates:list.inactive')}</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {t('templates:list.revision', { revision: template.revision })} · {template.updatedBy} ·{' '}
                            {formatDate(template.updatedAt)}
                          </TableCell>
                          <TableCell>
                            {state.canEdit ? (
                              <Button
                                aria-label={t('common:actions.edit')}
                                size="icon"
                                variant="ghost"
                                onClick={() => {
                                  setEditing(template);
                                  setOpen(true);
                                }}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle aria-level={2} role="heading">
                {t('templates:history.title')}
              </CardTitle>
              <CardDescription>{t('templates:history.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {!state.history.length ? (
                <p className="text-sm text-muted-foreground">{t('templates:history.empty')}</p>
              ) : (
                state.history.map((event) => (
                  <div className="border-l-2 border-border pl-3" key={event.id}>
                    <p className="text-sm">
                      <span className="font-medium">
                        {state.templates.find((item) => item.id === event.scopeId)?.name ?? event.scopeId}
                      </span>{' '}
                      · {t(`templates:fields.${event.fieldKey.split('.').pop()}`, { defaultValue: event.fieldKey })}
                    </p>
                    <p className="break-words text-xs text-muted-foreground">
                      {JSON.stringify(event.before) ?? '—'} → {JSON.stringify(event.after) ?? '—'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {event.actor} · {formatDate(event.createdAt)}
                      {event.revision ? ` · ${t('templates:list.revision', { revision: event.revision })}` : ''}
                    </p>
                    {event.reason ? <p className="mt-1 text-xs text-muted-foreground">{event.reason}</p> : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <TemplateEditor
            open={open}
            state={state}
            template={editing}
            tree={treeRows}
            onConflict={() => setConflict(true)}
            onOpenChange={setOpen}
            onSaved={() => reload()}
          />
        </>
      ) : null}
    </div>
  );
}
