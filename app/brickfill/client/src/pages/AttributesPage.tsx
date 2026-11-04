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
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@databricks/appkit-ui/react';
import { AlertCircle, Asterisk, Lock, PencilLine, Search } from 'lucide-react';
import { useTranslation } from '../i18n/react';
import { CategoryCombobox } from '../components/CategoryCombobox';
import { ChangeLog } from '../components/ChangeLog';
import { ToneBadge } from '../components/StatusBadge';
import { PageHeader, RefreshButton } from '../components/PageHeader';
import { ApiError, errorText, queryErrorText } from '../lib/api-errors';
import { useCatalogQuery } from '../lib/catalog-query';
import { categoryOptions, type CategoryTreeRow } from '../lib/category-tree';
import {
  loadRequirements,
  loadTemplates,
  saveRequirement,
  type AttributeRequirement,
  type CategoryTemplate,
  type RequirementsState,
} from '../lib/editors';
import { formatDate } from '../lib/formatters';
import { groupEvents } from '../lib/history';
import { matchesSearch } from '../lib/search';

const NO_PARAMETERS = {};
const FOLLOW = 'follow';

const isConflict = (error: unknown) =>
  error instanceof ApiError && (error.status === 409 || error.code === 'REQUIREMENT_VERSION_CONFLICT');

function RequirementBadge({ value }: { value: boolean | null }) {
  const { t } = useTranslation();
  if (value === null) return <span className="text-muted-foreground">—</span>;
  return value ? (
    <ToneBadge icon={Asterisk} tone="quiet">
      {t('attributes:required')}
    </ToneBadge>
  ) : (
    <Badge variant="outline">{t('attributes:optional')}</Badge>
  );
}

/** Most subcategories listed before one is chosen; the picker finds any other. */
const OVERVIEW_ROWS = 12;

/** Required or optional, per subcategory and attribute: the team's choice wins over the source and survives syncs. */
export function AttributesPage() {
  const { t } = useTranslation();
  const tree = useCatalogQuery('category_tree', NO_PARAMETERS);
  const summary = useCatalogQuery('attribute_requirement_summary', NO_PARAMETERS);
  const [templates, setTemplates] = useState<CategoryTemplate[]>([]);
  const [subcategoryId, setSubcategoryId] = useState<string | null>(null);
  const [state, setState] = useState<RequirementsState | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    loadTemplates(controller.signal)
      .then((loaded) => setTemplates(loaded.templates))
      .catch(() => undefined); // synonyms only help the search
    return () => controller.abort();
  }, []);

  const options = useMemo(
    () =>
      categoryOptions(
        (tree.data ?? []) as CategoryTreeRow[],
        'subcategory',
        templates.filter((item) => item.active).map((item) => item.match)
      ),
    [templates, tree.data]
  );
  const counts = useMemo(() => new Map((summary.data ?? []).map((row) => [row.subcategory_id, row])), [summary.data]);

  const reload = useCallback(async (id: string | null, signal?: AbortSignal) => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const loaded = await loadRequirements(id, signal);
      if (signal?.aborted) return;
      setState(loaded);
      setConflict(false);
    } catch (caught) {
      if (!signal?.aborted) setError(errorText(caught, 'errors:REQUIREMENTS_LOAD_FAILED'));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setState(null);
    void reload(subcategoryId, controller.signal);
    return () => controller.abort();
  }, [reload, subcategoryId]);

  const change = async (row: AttributeRequirement, choice: string) => {
    const required = choice === FOLLOW ? null : choice === 'true';
    setSaving(row.attributeId);
    setError(null);
    try {
      await saveRequirement(row.subcategoryId, row.attributeId, { required, expectedRevision: row.revision });
      await reload(row.subcategoryId);
    } catch (caught) {
      if (isConflict(caught)) setConflict(true);
      else setError(errorText(caught, 'errors:REQUIREMENT_SAVE_FAILED'));
    } finally {
      setSaving(null);
    }
  };

  const rows = (state?.attributes ?? []).filter((row) => matchesSearch(search, [row.attributeName, row.attributeId]));
  const selected = options.find((item) => item.id === subcategoryId);
  const selectedCounts = subcategoryId ? counts.get(subcategoryId) : undefined;
  const names = new Map((state?.attributes ?? []).map((row) => [row.attributeId, row.attributeName]));
  const treeError = queryErrorText(tree);
  const optionById = new Map(options.map((option) => [option.id, option]));
  const overview = [...(summary.data ?? [])]
    .sort(
      (a, b) =>
        b.override_count - a.override_count ||
        b.attribute_count - a.attribute_count ||
        (optionById.get(a.subcategory_id)?.name ?? '').localeCompare(optionById.get(b.subcategory_id)?.name ?? '')
    )
    .slice(0, OVERVIEW_ROWS)
    .map((row) => ({ row, option: optionById.get(row.subcategory_id) }));
  const history = groupEvents(state?.history ?? []);
  const choiceLabel = (value: unknown) =>
    value === true
      ? t('attributes:choice.required')
      : value === false
        ? t('attributes:choice.optional')
        : t('attributes:choice.follow');

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <PageHeader
        actions={
          <RefreshButton busy={loading} label={t('attributes:reload')} onClick={() => void reload(subcategoryId)} />
        }
        description={t('attributes:subtitle')}
        title={t('attributes:title')}
      />

      {conflict ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{t('errors:REQUIREMENT_VERSION_CONFLICT')}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            {t('attributes:conflict')}
            <Button size="sm" variant="outline" onClick={() => void reload(subcategoryId)}>
              {t('common:actions.reload')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {error || treeError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error ?? treeError}</AlertDescription>
        </Alert>
      ) : null}
      {state && !state.canEdit ? (
        <Alert>
          <Lock className="h-4 w-4" />
          <AlertTitle>{t('settings:readOnly.title')}</AlertTitle>
          <AlertDescription>{t('settings:readOnly.description')}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle aria-level={2} role="heading">
            {t('attributes:picker.title')}
          </CardTitle>
          <CardDescription>{t('attributes:picker.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="max-w-xl space-y-1.5">
            <Label htmlFor="attributes-subcategory">{t('attributes:picker.label')}</Label>
            <CategoryCombobox
              disabled={tree.loading}
              id="attributes-subcategory"
              options={options}
              placeholder={t('attributes:picker.placeholder')}
              value={subcategoryId}
              onChange={(value) => setSubcategoryId(value)}
            />
          </div>
          {selected ? (
            <p className="text-sm text-muted-foreground">
              {[selected.path, selected.name].filter(Boolean).join(' › ')}
              {selectedCounts
                ? ` · ${t('attributes:picker.counts', {
                    attributes: selectedCounts.attribute_count,
                    required: selectedCounts.required_count,
                    overrides: selectedCounts.override_count,
                  })}`
                : ''}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {!subcategoryId ? (
        <Card className="gap-0 overflow-hidden py-0">
          <CardHeader className="border-b py-5">
            <CardTitle aria-level={2} role="heading">
              {t('attributes:overview.title')}
            </CardTitle>
            <CardDescription>
              {t('attributes:overview.description', { count: summary.data?.length ?? 0 })}
            </CardDescription>
          </CardHeader>
          {summary.loading ? (
            <Skeleton className="m-6 h-40" />
          ) : !overview.length ? (
            <p className="px-6 py-5 text-sm text-muted-foreground">{t('attributes:table.empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">{t('attributes:overview.subcategory')}</TableHead>
                  <TableHead className="text-right">{t('attributes:overview.attributes')}</TableHead>
                  <TableHead className="text-right">{t('attributes:overview.required')}</TableHead>
                  <TableHead className="pr-6 text-right">{t('attributes:overview.choices')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overview.map(({ row, option }) => (
                  <TableRow className="relative hover:bg-muted/50" key={row.subcategory_id}>
                    <TableCell className="pl-6">
                      <button
                        className="text-left font-medium after:absolute after:inset-0 hover:text-primary hover:underline focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
                        type="button"
                        onClick={() => setSubcategoryId(row.subcategory_id)}
                      >
                        {option?.name ?? row.subcategory_id}
                      </button>
                      {option?.path ? <span className="block text-xs text-muted-foreground">{option.path}</span> : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.attribute_count}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.required_count}</TableCell>
                    <TableCell className="pr-6 text-right tabular-nums">
                      {row.override_count ? row.override_count : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {(summary.data?.length ?? 0) > OVERVIEW_ROWS ? (
            <p className="border-t px-6 py-3 text-xs text-muted-foreground">
              {t('attributes:overview.more', { shown: OVERVIEW_ROWS, count: summary.data?.length ?? 0 })}
            </p>
          ) : null}
        </Card>
      ) : null}

      {subcategoryId ? (
        <Card className="gap-0 overflow-hidden py-0">
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0 border-b py-5">
            <div className="space-y-1.5">
              <CardTitle aria-level={2} role="heading">
                {t('attributes:table.title')}
              </CardTitle>
              <CardDescription className="max-w-prose">{t('attributes:table.description')}</CardDescription>
            </div>
            <div className="relative w-full sm:max-w-xs">
              <Search aria-hidden className="absolute top-2 left-3 h-4 w-4 text-muted-foreground" />
              <Input
                aria-label={t('attributes:table.search')}
                className="pl-9"
                placeholder={t('attributes:table.search')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </CardHeader>
          {!state && loading ? (
            <Skeleton className="m-6 h-48" />
          ) : !rows.length ? (
            <p className="px-6 py-5 text-sm text-muted-foreground">{t('attributes:table.empty')}</p>
          ) : (
            <Table className="stack-table">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">{t('attributes:table.attribute')}</TableHead>
                  <TableHead>{t('attributes:table.source')}</TableHead>
                  <TableHead>{t('attributes:table.choice')}</TableHead>
                  <TableHead>{t('attributes:table.effective')}</TableHead>
                  <TableHead className="pr-6">{t('attributes:table.updated')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.attributeId}>
                    <TableCell className="pl-6" data-label={t('attributes:table.attribute')}>
                      <span className="block font-medium">{row.attributeName ?? row.attributeId}</span>
                      <span className="block text-xs text-muted-foreground">
                        {row.attributeId}
                        {!row.inSource ? ` · ${t('attributes:table.notInSource')}` : ''}
                      </span>
                    </TableCell>
                    <TableCell data-label={t('attributes:table.source')}>
                      <RequirementBadge value={row.sourceEffectiveRequired} />
                      {row.inSource && row.sourceRequired === null ? (
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {t('attributes:table.sourceDefault')}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="min-w-48" data-label={t('attributes:table.choice')}>
                      <Select
                        disabled={!state?.canEdit || saving !== null}
                        value={row.overrideRequired === null ? FOLLOW : String(row.overrideRequired)}
                        onValueChange={(choice) => void change(row, choice)}
                      >
                        <SelectTrigger
                          aria-label={t('attributes:table.choiceFor', { name: row.attributeName })}
                          className="w-full"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={FOLLOW}>{t('attributes:choice.follow')}</SelectItem>
                          <SelectItem value="true">{t('attributes:choice.required')}</SelectItem>
                          <SelectItem value="false">{t('attributes:choice.optional')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell data-label={t('attributes:table.effective')}>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <RequirementBadge value={row.effectiveRequired} />
                        {row.overrideRequired !== null ? (
                          <ToneBadge icon={PencilLine} tone="info">
                            {t('attributes:table.teamChoice')}
                          </ToneBadge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell
                      className="pr-6 text-xs text-muted-foreground"
                      data-label={t('attributes:table.updated')}
                    >
                      {row.updatedBy ? (
                        <>
                          <span className="block tabular-nums whitespace-nowrap">{formatDate(row.updatedAt)}</span>
                          <span className="block max-w-48 truncate" title={row.updatedBy}>
                            {row.updatedBy}
                          </span>
                        </>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      ) : null}

      {state ? (
        <Card className="gap-0 overflow-hidden py-0">
          <CardHeader className="border-b py-5">
            <CardTitle aria-level={2} role="heading">
              {t('attributes:history.title')}
            </CardTitle>
            <CardDescription>{t('attributes:history.description')}</CardDescription>
          </CardHeader>
          <ChangeLog
            empty="attributes:history.empty"
            fieldLabel={() => t('attributes:history.field')}
            groups={history}
            renderValue={(_key, before, after) => (
              <span>
                <span className="text-muted-foreground line-through decoration-muted-foreground/60">
                  {choiceLabel(before)}
                </span>{' '}
                → {choiceLabel(after)}
              </span>
            )}
            title={(group) => {
              const attributeId = group.scopeId.slice((subcategoryId ?? '').length + 1);
              return names.get(attributeId) ?? attributeId;
            }}
          />
        </Card>
      ) : null}
    </div>
  );
}
