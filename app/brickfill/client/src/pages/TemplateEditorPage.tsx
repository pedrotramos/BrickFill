import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Skeleton,
  Switch,
} from '@databricks/appkit-ui/react';
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CircleCheck,
  CircleDot,
  CirclePause,
  Lock,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { useTranslation } from '../i18n/react';
import { CategoryCombobox } from '../components/CategoryCombobox';
import { ToneBadge } from '../components/StatusBadge';
import { TagInput } from '../components/TagInput';
import { ApiError, errorText } from '../lib/api-errors';
import { useCatalogQuery } from '../lib/catalog-query';
import { categoryOptions, type CategoryLevel, type CategoryOption, type CategoryTreeRow } from '../lib/category-tree';
import {
  loadTemplates,
  saveTemplate,
  templateIdFrom,
  type CategoryTemplate,
  type TemplateMatch,
  type TemplatesState,
} from '../lib/editors';
import { formatDate } from '../lib/formatters';
import type { Overrides } from '../lib/settings';
import { KNOWN_TOKENS, LEVELS, useTokenLabel } from '../lib/template-tokens';

const NO_PARAMETERS = {};
const MAX_PARTS = 15;
const MAX_SECTIONS = 12;

interface Section {
  section: string;
  fields: string[];
}

interface Draft {
  name: string;
  match: TemplateMatch;
  titleOrder: string[];
  layout: Section[];
  mustInclude: string[];
  required: string[];
  optional: string[];
  active: boolean;
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

const list = (value: unknown) => (Array.isArray(value) ? value.map(String) : []);
const clean = (items: readonly string[]) => [...new Set(items.map((item) => item.trim()).filter(Boolean))];

function draftOf(template: CategoryTemplate | null, defaults: Overrides): Draft {
  const overrides = template?.overrides ?? {};
  const pick = (key: string) => (key in overrides ? overrides[key] : defaults[key]);
  const match = { ...EMPTY_MATCH, ...(template?.match ?? {}) } as TemplateMatch;
  return {
    name: template?.name ?? '',
    match: Object.fromEntries(Object.entries(match).map(([key, value]) => [key, list(value)])) as TemplateMatch,
    titleOrder: list(pick('title_order')),
    layout: Array.isArray(pick('fact_sheet_layout'))
      ? (pick('fact_sheet_layout') as Section[]).map((item) => ({ section: item.section, fields: list(item.fields) }))
      : [],
    mustInclude: list(pick('fact_sheet_must_include')),
    required: list(overrides.required_fact_labels),
    optional: list(overrides.optional_fact_labels),
    active: template?.active ?? true,
  };
}

/** Only what differs from the profile is saved, so a later profile change still reaches the template. */
function overridesOf(draft: Draft, defaults: Overrides): Overrides {
  const candidate: Overrides = {
    title_order: draft.titleOrder,
    fact_sheet_layout: draft.layout
      .map((item) => ({ section: item.section.trim(), fields: clean(item.fields) }))
      .filter((item) => item.section),
    fact_sheet_must_include: clean(draft.mustInclude),
    required_fact_labels: clean(draft.required),
    optional_fact_labels: clean(draft.optional),
  };
  return Object.fromEntries(
    Object.entries(candidate).filter(
      ([key, value]) =>
        JSON.stringify(value) !== JSON.stringify(defaults[key] ?? []) &&
        !(Array.isArray(value) && !value.length && key !== 'fact_sheet_layout')
    )
  );
}

const move = <T,>(items: readonly T[], index: number, by: number) => {
  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(Math.max(0, Math.min(next.length, index + by)), 0, item);
  return next;
};

/** Up, down and remove of an ordered row; the labels name the row for screen readers. */
function RowActions({
  name,
  index,
  count,
  disabled,
  onMove,
  onRemove,
}: {
  name: string;
  index: number;
  count: number;
  disabled?: boolean;
  onMove: (by: number) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex shrink-0 items-center">
      <Button
        aria-label={t('templates:editor.moveUp', { name })}
        className="size-8"
        disabled={disabled || index === 0}
        size="icon"
        title={t('templates:editor.up')}
        variant="ghost"
        onClick={() => onMove(-1)}
      >
        <ArrowUp aria-hidden className="h-4 w-4" />
      </Button>
      <Button
        aria-label={t('templates:editor.moveDown', { name })}
        className="size-8"
        disabled={disabled || index === count - 1}
        size="icon"
        title={t('templates:editor.down')}
        variant="ghost"
        onClick={() => onMove(1)}
      >
        <ArrowDown aria-hidden className="h-4 w-4" />
      </Button>
      <Button
        aria-label={t('templates:editor.removeNamed', { name })}
        className="size-8 hover:text-destructive"
        disabled={disabled}
        size="icon"
        title={t('common:actions.remove')}
        variant="ghost"
        onClick={onRemove}
      >
        <X aria-hidden className="h-4 w-4" />
      </Button>
    </div>
  );
}

function Panel({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card aria-labelledby={`${id}-title`} role="region">
      <CardHeader>
        <CardTitle aria-level={2} id={`${id}-title`} role="heading">
          {title}
        </CardTitle>
        <CardDescription className="max-w-prose">{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

/** A section key of the profile (e.g. key_features), which the content shows under its localized name. */
const isProfileSection = (name: string) => /^[a-z0-9]+(_[a-z0-9]+)+$/.test(name.trim());
const sectionTitle = (name: string) =>
  isProfileSection(name)
    ? name
        .trim()
        .replace(/_/g, ' ')
        .replace(/^\w/, (letter) => letter.toUpperCase())
    : name;

/** An empty ordered list, said plainly inside its frame. */
const EmptyRow = ({ children }: { children: ReactNode }) => (
  <p className="rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground">{children}</p>
);

/** The editor of one category template: the content model of a product type, saved field by field in the history. */
export function TemplateEditorPage() {
  const { t } = useTranslation();
  const tokenLabel = useTokenLabel();
  const navigate = useNavigate();
  const { id: routeId = 'new' } = useParams();
  const isNew = routeId === 'new';
  const tree = useCatalogQuery('category_tree', NO_PARAMETERS);
  const [state, setState] = useState<TemplatesState | null>(null);
  const [template, setTemplate] = useState<CategoryTemplate | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [initial, setInitial] = useState('');
  const [reason, setReason] = useState('');
  const [samples, setSamples] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [savedRevision, setSavedRevision] = useState<number | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const defaults = useMemo(() => state?.manifest.profile_defaults.default ?? {}, [state]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const loaded = await loadTemplates(signal);
        if (signal?.aborted) return;
        const found = isNew ? null : (loaded.templates.find((item) => item.id === routeId) ?? null);
        const next = draftOf(found, loaded.manifest.profile_defaults.default ?? {});
        setState(loaded);
        setTemplate(found);
        setDraft(next);
        setInitial(JSON.stringify(next));
        setConflict(false);
      } catch (caught) {
        if (!signal?.aborted) setError(errorText(caught, 'errors:TEMPLATES_LOAD_FAILED'));
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [isNew, routeId]
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const treeRows = useMemo(() => (tree.data ?? []) as CategoryTreeRow[], [tree.data]);
  const byLevel = useMemo(
    () => Object.fromEntries(LEVELS.map((level) => [level, categoryOptions(treeRows, level)])),
    [treeRows]
  ) as Record<CategoryLevel, CategoryOption[]>;
  const pickerOptions = useMemo(
    () =>
      LEVELS.flatMap((level) =>
        byLevel[level].map((option) => ({
          ...option,
          id: `${level}:${option.id}`,
          path: [t(`settings:scopes.${level}`), option.path].filter(Boolean).join(' · '),
        }))
      ),
    [byLevel, t]
  );

  const notFound = !loading && !isNew && state !== null && template === null;
  const canEdit = !!state?.canEdit && !notFound;
  const id = isNew ? templateIdFrom(draft?.name ?? '') : routeId;
  const takenId = isNew && !!id && !!state?.templates.some((item) => item.id === id);
  const dirty = draft !== null && JSON.stringify(draft) !== initial;
  const set = (patch: Partial<Draft>) => setDraft((current) => (current ? { ...current, ...patch } : current));
  const setMatch = (patch: Partial<TemplateMatch>) =>
    setDraft((current) => (current ? { ...current, match: { ...current.match, ...patch } } : current));

  const associations = draft
    ? LEVELS.flatMap((level) => [
        ...draft.match[`${level}_ids`].map((value) => {
          const option = byLevel[level].find((item) => item.id === value);
          return { level, key: `${level}_ids` as const, value, name: option?.name ?? value, path: option?.path ?? '' };
        }),
        ...draft.match[`${level}_names`].map((value) => ({
          level,
          key: `${level}_names` as const,
          value,
          name: value,
          path: t('templates:editor.byName'),
        })),
      ])
    : [];
  const missing = draft
    ? [
        !draft.name.trim() || !id ? t('templates:editor.needs.name') : null,
        takenId ? t('templates:editor.needs.uniqueName') : null,
        !associations.length && !draft.match.synonyms.length ? t('templates:editor.needs.association') : null,
        !draft.titleOrder.length ? t('templates:editor.needs.title') : null,
      ].filter((item): item is string => item !== null)
    : [];

  const save = async () => {
    if (!draft || missing.length) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await saveTemplate(id, {
        name: draft.name.trim(),
        match: { ...draft.match, synonyms: clean(draft.match.synonyms) },
        overrides: overridesOf(draft, defaults),
        active: draft.active,
        expectedRevision: template?.revision ?? 0,
        reason: reason.trim() || undefined,
      });
      setReason('');
      setSavedRevision(saved.revision);
      if (isNew) {
        navigate(`/templates/${encodeURIComponent(saved.id)}`, { replace: true });
      } else {
        await load();
      }
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'TEMPLATE_VERSION_CONFLICT') setConflict(true);
      else setError(errorText(caught, 'errors:TEMPLATE_SAVE_FAILED'));
    } finally {
      setSaving(false);
    }
  };

  const leave = () => (dirty ? setConfirmLeave(true) : navigate('/templates'));
  const unusedTokens = KNOWN_TOKENS.filter((token) => !draft?.titleOrder.includes(token));
  const addPart = (token: string) => {
    if (!draft || !token.trim() || draft.titleOrder.length >= MAX_PARTS) return;
    set({ titleOrder: clean([...draft.titleOrder, token]) });
  };
  const maxLength = Number(defaults.title_max_length ?? 150);
  const titleParts = (draft?.titleOrder ?? []).map((token) => ({
    token,
    value: (samples[token] ?? '').trim(),
  }));
  const titleText = titleParts.map((part) => part.value || tokenLabel(part.token)).join(' ');
  const pageTitle = isNew ? draft?.name.trim() || t('templates:editor.newTitle') : (template?.name ?? '');

  return (
    <div className="mx-auto w-full max-w-7xl">
      <div className="space-y-6 pb-6">
        <Button className="-ml-2.5" variant="ghost" onClick={leave}>
          <ArrowLeft aria-hidden className="mr-1 h-4 w-4" />
          {t('templates:editor.back')}
        </Button>

        {loading && !state ? (
          <div className="space-y-6">
            <Skeleton className="h-12 w-80" />
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
              <Skeleton className="h-96" />
              <Skeleton className="h-72" />
            </div>
          </div>
        ) : notFound ? (
          <Card>
            <CardContent className="space-y-3 py-10 text-center">
              <h1 className="text-[1.375rem] leading-7 font-semibold">{t('templates:editor.notFound.title')}</h1>
              <p className="text-sm text-muted-foreground">
                {t('templates:editor.notFound.description', { id: routeId })}
              </p>
              <Button asChild variant="outline">
                <Link to="/templates">{t('templates:editor.back')}</Link>
              </Button>
            </CardContent>
          </Card>
        ) : draft && state ? (
          <>
            <header className="space-y-2">
              <h1 className="text-[1.375rem] leading-7 font-semibold break-words">{pageTitle}</h1>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {draft.active ? (
                  <ToneBadge icon={CircleCheck} tone="success">
                    {t('templates:list.active')}
                  </ToneBadge>
                ) : (
                  <ToneBadge icon={CirclePause} tone="quiet">
                    {t('templates:list.inactive')}
                  </ToneBadge>
                )}
                {id ? (
                  <Badge title={t('templates:editor.identifier')} variant="outline">
                    {id}
                  </Badge>
                ) : null}
                {template ? (
                  <span className="tabular-nums">
                    {t('templates:editor.lastSaved', {
                      revision: template.revision,
                      actor: template.updatedBy,
                      date: formatDate(template.updatedAt),
                    })}
                  </span>
                ) : (
                  <span>{t('templates:editor.description')}</span>
                )}
              </div>
            </header>

            {conflict ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{t('errors:TEMPLATE_VERSION_CONFLICT')}</AlertTitle>
                <AlertDescription className="flex flex-wrap items-center gap-3">
                  {t('templates:conflict')}
                  <Button size="sm" variant="outline" onClick={() => void load()}>
                    {t('templates:editor.reloadDiscard')}
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
            {!state.canEdit ? (
              <Alert>
                <Lock className="h-4 w-4" />
                <AlertTitle>{t('settings:readOnly.title')}</AlertTitle>
                <AlertDescription>{t('settings:readOnly.description')}</AlertDescription>
              </Alert>
            ) : null}

            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
              <div className="min-w-0 space-y-6">
                <Panel
                  description={t('templates:editor.identityHelp')}
                  id="template-identity"
                  title={t('templates:editor.identity')}
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="template-name">{t('templates:editor.name')}</Label>
                    <Input
                      aria-describedby="template-name-help"
                      aria-invalid={takenId || undefined}
                      disabled={!canEdit}
                      id="template-name"
                      maxLength={120}
                      placeholder={t('templates:editor.namePlaceholder')}
                      value={draft.name}
                      onChange={(event) => set({ name: event.target.value })}
                    />
                    <p
                      className={`text-xs ${takenId ? 'text-destructive' : 'text-muted-foreground'}`}
                      id="template-name-help"
                    >
                      {takenId
                        ? t('templates:editor.needs.uniqueName')
                        : isNew
                          ? t('templates:editor.idNew', { id: id || '—' })
                          : t('templates:editor.idFixed')}
                    </p>
                  </div>
                  <div className="flex items-start justify-between gap-4 rounded-md border px-4 py-3">
                    <div className="space-y-0.5">
                      <Label htmlFor="template-active">{t('templates:editor.active')}</Label>
                      <p className="text-xs text-muted-foreground" id="template-active-help">
                        {t('templates:editor.activeHelp')}
                      </p>
                    </div>
                    <Switch
                      aria-describedby="template-active-help"
                      checked={draft.active}
                      disabled={!canEdit}
                      id="template-active"
                      onCheckedChange={(checked) => set({ active: checked })}
                    />
                  </div>
                </Panel>

                <Panel
                  description={t('templates:editor.appliesHelp')}
                  id="template-applies"
                  title={t('templates:editor.applies')}
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="template-association">{t('templates:editor.addAssociation')}</Label>
                    <CategoryCombobox
                      disabled={!canEdit || tree.loading}
                      id="template-association"
                      options={pickerOptions}
                      placeholder={t('templates:editor.addAssociationPlaceholder')}
                      value={null}
                      onChange={(value) => {
                        if (!value) return;
                        const [level, ...rest] = value.split(':');
                        const key = `${level as CategoryLevel}_ids` as const;
                        setMatch({ [key]: clean([...draft.match[key], rest.join(':')]) });
                      }}
                    />
                  </div>
                  {associations.length ? (
                    <ul aria-label={t('templates:editor.applies')} className="divide-y rounded-md border">
                      {associations.map((item) => (
                        <li className="flex items-center gap-3 py-2 pr-1 pl-3" key={`${item.key}:${item.value}`}>
                          <Badge className="w-24 shrink-0 justify-center" variant="secondary">
                            {t(`settings:scopes.${item.level}`)}
                          </Badge>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{item.name}</p>
                            {item.path ? <p className="truncate text-xs text-muted-foreground">{item.path}</p> : null}
                          </div>
                          <Button
                            aria-label={t('templates:editor.removeNamed', { name: item.name })}
                            className="size-8 hover:text-destructive"
                            disabled={!canEdit}
                            size="icon"
                            title={t('common:actions.remove')}
                            variant="ghost"
                            onClick={() =>
                              setMatch({ [item.key]: draft.match[item.key].filter((value) => value !== item.value) })
                            }
                          >
                            <X aria-hidden className="h-4 w-4" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <EmptyRow>{t('templates:editor.noAssociation')}</EmptyRow>
                  )}
                  <div className="space-y-1.5">
                    <Label htmlFor="template-synonyms">{t('templates:editor.synonyms')}</Label>
                    <TagInput
                      describedBy="template-synonyms-help"
                      disabled={!canEdit}
                      id="template-synonyms"
                      label={t('templates:editor.synonyms')}
                      placeholder={t('templates:editor.tagPlaceholder')}
                      values={draft.match.synonyms}
                      onChange={(synonyms) => setMatch({ synonyms })}
                    />
                    <p className="text-xs text-muted-foreground" id="template-synonyms-help">
                      {t('templates:editor.synonymsHelp')}
                    </p>
                  </div>
                </Panel>

                <Panel
                  description={t('templates:editor.titleHelp')}
                  id="template-title"
                  title={t('templates:editor.title')}
                >
                  {draft.titleOrder.length ? (
                    <ol aria-label={t('templates:editor.title')} className="divide-y rounded-md border">
                      {draft.titleOrder.map((token, index) => {
                        const label = tokenLabel(token);
                        return (
                          <li
                            className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 py-2 pr-1 pl-3 sm:grid-cols-[1.5rem_minmax(0,1fr)_12rem_auto]"
                            key={token}
                          >
                            <span className="text-right text-xs text-muted-foreground tabular-nums">{index + 1}</span>
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="text-sm font-medium break-words">{label}</span>
                              {!KNOWN_TOKENS.includes(token) ? (
                                <Badge
                                  className="shrink-0"
                                  title={t('templates:editor.customPartHelp')}
                                  variant="outline"
                                >
                                  {t('templates:editor.customPart')}
                                </Badge>
                              ) : null}
                            </span>
                            <Input
                              aria-label={t('templates:editor.sampleFor', { token: label })}
                              className="col-span-3 col-start-2 row-start-2 h-8 sm:col-span-1 sm:col-start-3 sm:row-start-1"
                              maxLength={60}
                              placeholder={t('templates:editor.sample')}
                              value={samples[token] ?? ''}
                              onChange={(event) =>
                                setSamples((current) => ({ ...current, [token]: event.target.value }))
                              }
                            />
                            <RowActions
                              count={draft.titleOrder.length}
                              disabled={!canEdit}
                              index={index}
                              name={label}
                              onMove={(by) => set({ titleOrder: move(draft.titleOrder, index, by) })}
                              onRemove={() => set({ titleOrder: draft.titleOrder.filter((_, i) => i !== index) })}
                            />
                          </li>
                        );
                      })}
                    </ol>
                  ) : (
                    <EmptyRow>{t('templates:editor.noParts')}</EmptyRow>
                  )}
                  {canEdit ? (
                    <div className="space-y-3 rounded-md bg-muted/50 p-3">
                      {unusedTokens.length ? (
                        <div className="space-y-1.5">
                          <p className="text-xs font-medium text-muted-foreground">{t('templates:editor.suggested')}</p>
                          <div className="flex flex-wrap gap-1.5">
                            {unusedTokens.map((token) => (
                              <Button
                                className="h-7 bg-background px-2 text-xs"
                                disabled={draft.titleOrder.length >= MAX_PARTS}
                                key={token}
                                size="sm"
                                variant="outline"
                                onClick={() => addPart(token)}
                              >
                                <Plus aria-hidden className="h-3.5 w-3.5" />
                                {tokenLabel(token)}
                              </Button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      <form
                        className="flex flex-wrap items-end gap-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          addPart(custom);
                          setCustom('');
                        }}
                      >
                        <div className="min-w-48 flex-1 space-y-1.5">
                          <Label className="text-xs text-muted-foreground" htmlFor="template-custom-part">
                            {t('templates:editor.customPartLabel')}
                          </Label>
                          <Input
                            className="bg-background"
                            id="template-custom-part"
                            maxLength={40}
                            placeholder={t('templates:editor.addToken')}
                            value={custom}
                            onChange={(event) => setCustom(event.target.value)}
                          />
                        </div>
                        <Button
                          className="bg-background"
                          disabled={!custom.trim() || draft.titleOrder.length >= MAX_PARTS}
                          type="submit"
                          variant="outline"
                        >
                          <Plus aria-hidden className="mr-1 h-4 w-4" />
                          {t('templates:editor.addPart')}
                        </Button>
                      </form>
                    </div>
                  ) : null}
                </Panel>

                <Panel
                  description={t('templates:editor.sheetHelp')}
                  id="template-sheet"
                  title={t('templates:editor.sheet')}
                >
                  {draft.layout.length ? (
                    <ol aria-label={t('templates:editor.sheet')} className="space-y-3">
                      {draft.layout.map((item, index) => {
                        const name = item.section.trim() || t('templates:editor.sectionUntitled', { index: index + 1 });
                        return (
                          <li className="space-y-3 rounded-md border p-3" key={index}>
                            <div className="flex items-center gap-3">
                              <span className="w-6 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                                {index + 1}
                              </span>
                              <Input
                                aria-label={t('templates:editor.sectionNameFor', { index: index + 1 })}
                                className="font-medium"
                                disabled={!canEdit}
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
                              {isProfileSection(item.section) ? (
                                <Badge
                                  className="hidden shrink-0 sm:inline-flex"
                                  title={t('templates:editor.profileSectionHelp')}
                                  variant="secondary"
                                >
                                  {t('templates:editor.profileSection')}
                                </Badge>
                              ) : null}
                              <RowActions
                                count={draft.layout.length}
                                disabled={!canEdit}
                                index={index}
                                name={name}
                                onMove={(by) => set({ layout: move(draft.layout, index, by) })}
                                onRemove={() => set({ layout: draft.layout.filter((_, i) => i !== index) })}
                              />
                            </div>
                            <div className="pl-9">
                              <TagInput
                                disabled={!canEdit}
                                label={t('templates:editor.sectionFieldsFor', { name })}
                                maxItems={30}
                                maxLength={60}
                                placeholder={t('templates:editor.sectionFields')}
                                values={item.fields}
                                onChange={(fields) =>
                                  set({
                                    layout: draft.layout.map((section, i) =>
                                      i === index ? { ...section, fields } : section
                                    ),
                                  })
                                }
                              />
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  ) : (
                    <EmptyRow>{t('templates:editor.noSections')}</EmptyRow>
                  )}
                  {canEdit ? (
                    <Button
                      disabled={draft.layout.length >= MAX_SECTIONS}
                      variant="outline"
                      onClick={() => set({ layout: [...draft.layout, { section: '', fields: [] }] })}
                    >
                      <Plus aria-hidden className="mr-1 h-4 w-4" />
                      {t('templates:editor.addSection')}
                    </Button>
                  ) : null}
                </Panel>

                <Panel
                  description={t('templates:editor.factsHelp')}
                  id="template-facts"
                  title={t('templates:editor.facts')}
                >
                  {(
                    [
                      ['required', 'templates:editor.required', 'templates:editor.requiredHelp'],
                      ['mustInclude', 'templates:editor.mustInclude', 'templates:editor.mustIncludeHelp'],
                      ['optional', 'templates:editor.optional', 'templates:editor.optionalHelp'],
                    ] as const
                  ).map(([field, label, help]) => (
                    <div className="space-y-1.5" key={field}>
                      <Label htmlFor={`template-${field}`}>{t(label)}</Label>
                      <TagInput
                        describedBy={`template-${field}-help`}
                        disabled={!canEdit}
                        id={`template-${field}`}
                        label={t(label)}
                        maxLength={60}
                        placeholder={t('templates:editor.tagPlaceholder')}
                        values={draft[field]}
                        onChange={(values) => set({ [field]: values } as Partial<Draft>)}
                      />
                      <p className="text-xs text-muted-foreground" id={`template-${field}-help`}>
                        {t(help)}
                      </p>
                    </div>
                  ))}
                </Panel>
              </div>

              <aside aria-labelledby="template-preview-title" className="lg:sticky lg:top-6">
                <Card>
                  <CardHeader>
                    <CardTitle aria-level={2} id="template-preview-title" role="heading">
                      {t('templates:preview.title')}
                    </CardTitle>
                    <CardDescription>{t('templates:preview.description')}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <section className="space-y-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <h3 className="text-xs font-medium text-muted-foreground">
                          {t('templates:preview.productTitle')}
                        </h3>
                        <span
                          className={`text-xs tabular-nums ${titleText.length > maxLength ? 'text-destructive' : 'text-muted-foreground'}`}
                        >
                          {t('templates:preview.length', { length: titleText.length, max: maxLength })}
                        </span>
                      </div>
                      {titleParts.length ? (
                        <p className="text-base leading-7 font-semibold break-words">
                          {titleParts.map((part, index) => (
                            <span key={part.token}>
                              {index ? ' ' : ''}
                              {part.value ? (
                                part.value
                              ) : (
                                <span className="rounded-[4px] bg-secondary px-1 font-normal text-muted-foreground">
                                  {tokenLabel(part.token)}
                                </span>
                              )}
                            </span>
                          ))}
                        </p>
                      ) : (
                        <p className="text-sm text-muted-foreground">{t('templates:editor.noParts')}</p>
                      )}
                      <p className="text-xs text-muted-foreground">{t('templates:preview.titleHint')}</p>
                    </section>

                    <section className="space-y-2 border-t pt-4">
                      <h3 className="text-xs font-medium text-muted-foreground">{t('templates:preview.sheet')}</h3>
                      {draft.layout.some((item) => item.section.trim()) ? (
                        <ol className="space-y-2.5">
                          {draft.layout
                            .filter((item) => item.section.trim())
                            .map((item, index) => (
                              <li key={`${item.section}-${index}`}>
                                <p className="text-sm font-medium">{sectionTitle(item.section)}</p>
                                {item.fields.length ? (
                                  <p className="text-xs text-muted-foreground">{item.fields.join(' · ')}</p>
                                ) : (
                                  <p className="text-xs text-muted-foreground">{t('templates:preview.anyField')}</p>
                                )}
                              </li>
                            ))}
                        </ol>
                      ) : (
                        <p className="text-sm text-muted-foreground">{t('templates:preview.profileSections')}</p>
                      )}
                    </section>

                    {draft.required.length ? (
                      <section className="space-y-2 border-t pt-4">
                        <h3 className="text-xs font-medium text-muted-foreground">{t('templates:editor.required')}</h3>
                        <ul className="flex flex-wrap gap-1">
                          {draft.required.map((item) => (
                            <li key={item}>
                              <Badge variant="outline">{item}</Badge>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ) : null}

                    <p className="border-t pt-4 text-xs text-muted-foreground">{t('templates:preview.precedence')}</p>
                  </CardContent>
                </Card>
              </aside>
            </div>
          </>
        ) : null}
      </div>

      {draft && canEdit ? (
        <div className="sticky bottom-0 z-10 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:-mx-8 md:px-8">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3">
            <p aria-live="polite" className="flex min-w-0 flex-1 basis-56 items-center gap-2 text-sm">
              {missing.length && dirty ? (
                <>
                  <AlertCircle aria-hidden className="h-4 w-4 shrink-0 text-warning" />
                  <span className="truncate text-muted-foreground" title={missing.join(' · ')}>
                    {missing[0]}
                  </span>
                </>
              ) : dirty ? (
                <>
                  <CircleDot aria-hidden className="h-4 w-4 shrink-0 text-warning" />
                  {t('templates:editor.unsaved')}
                </>
              ) : savedRevision ? (
                <>
                  <CircleCheck aria-hidden className="h-4 w-4 shrink-0 text-success" />
                  <span className="text-muted-foreground">
                    {t('templates:editor.saved', { revision: savedRevision })}
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">{t('templates:editor.noChanges')}</span>
              )}
            </p>
            <Input
              aria-label={t('settings:reason')}
              className="hidden sm:block sm:w-72"
              disabled={!dirty}
              maxLength={2000}
              placeholder={t('settings:reasonPlaceholder')}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <div className="flex gap-2">
              <Button variant="outline" onClick={leave}>
                {t('common:actions.cancel')}
              </Button>
              <Button disabled={saving || !dirty || missing.length > 0} onClick={() => void save()}>
                <Save aria-hidden className="mr-2 h-4 w-4" />
                {saving ? t('common:actions.saving') : t('templates:editor.save')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <AlertDialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('templates:editor.discard.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('templates:editor.discard.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('templates:editor.discard.keep')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => navigate('/templates')}
            >
              <Trash2 aria-hidden className="mr-2 h-4 w-4" />
              {t('templates:editor.discard.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
