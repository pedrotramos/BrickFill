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
import { AlertCircle, Lock, Search } from 'lucide-react';
import { useTranslation } from '../i18n/react';
import { CategoryCombobox } from '../components/CategoryCombobox';
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
import { matchesSearch } from '../lib/search';

const NO_PARAMETERS = {};
const FOLLOW = 'follow';

const isConflict = (error: unknown) =>
  error instanceof ApiError && (error.status === 409 || error.code === 'REQUIREMENT_VERSION_CONFLICT');

function RequirementBadge({ value }: { value: boolean | null }) {
  const { t } = useTranslation();
  if (value === null) return <span className="text-muted-foreground">—</span>;
  return value ? (
    <Badge>{t('attributes:required')}</Badge>
  ) : (
    <Badge variant="outline">{t('attributes:optional')}</Badge>
  );
}

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

      {subcategoryId ? (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
            <div className="space-y-1.5">
              <CardTitle aria-level={2} role="heading">
                {t('attributes:table.title')}
              </CardTitle>
              <CardDescription>{t('attributes:table.description')}</CardDescription>
            </div>
            <div className="relative w-full max-w-xs">
              <Search aria-hidden className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
              <Input
                aria-label={t('attributes:table.search')}
                className="pl-8"
                placeholder={t('attributes:table.search')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </CardHeader>
          <CardContent>
            {!state && loading ? (
              <Skeleton className="h-48" />
            ) : !rows.length ? (
              <p className="text-sm text-muted-foreground">{t('attributes:table.empty')}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('attributes:table.attribute')}</TableHead>
                    <TableHead>{t('attributes:table.source')}</TableHead>
                    <TableHead>{t('attributes:table.choice')}</TableHead>
                    <TableHead>{t('attributes:table.effective')}</TableHead>
                    <TableHead>{t('attributes:table.updated')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.attributeId}>
                      <TableCell>
                        <span className="block font-medium">{row.attributeName ?? row.attributeId}</span>
                        <span className="block text-xs text-muted-foreground">
                          {row.attributeId}
                          {!row.inSource ? ` · ${t('attributes:table.notInSource')}` : ''}
                        </span>
                      </TableCell>
                      <TableCell>
                        <RequirementBadge value={row.sourceEffectiveRequired} />
                        {row.inSource && row.sourceRequired === null ? (
                          <span className="block text-xs text-muted-foreground">
                            {t('attributes:table.sourceDefault')}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="min-w-44">
                        <Select
                          disabled={!state?.canEdit || saving !== null}
                          value={row.overrideRequired === null ? FOLLOW : String(row.overrideRequired)}
                          onValueChange={(choice) => void change(row, choice)}
                        >
                          <SelectTrigger aria-label={t('attributes:table.choiceFor', { name: row.attributeName })}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={FOLLOW}>{t('attributes:choice.follow')}</SelectItem>
                            <SelectItem value="true">{t('attributes:choice.required')}</SelectItem>
                            <SelectItem value="false">{t('attributes:choice.optional')}</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <RequirementBadge value={row.effectiveRequired} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.updatedBy ? `${row.updatedBy} · ${formatDate(row.updatedAt)}` : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}

      {state ? (
        <Card>
          <CardHeader>
            <CardTitle aria-level={2} role="heading">
              {t('attributes:history.title')}
            </CardTitle>
            <CardDescription>{t('attributes:history.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!state.history.length ? (
              <p className="text-sm text-muted-foreground">{t('attributes:history.empty')}</p>
            ) : (
              state.history.map((event) => {
                const attributeId = event.scopeId.slice((subcategoryId ?? '').length + 1);
                const label = (value: unknown) =>
                  value === true
                    ? t('attributes:choice.required')
                    : value === false
                      ? t('attributes:choice.optional')
                      : t('attributes:choice.follow');
                return (
                  <div className="border-l-2 border-border pl-3" key={event.id}>
                    <p className="text-sm">
                      <span className="font-medium">{names.get(attributeId) ?? attributeId}</span>{' '}
                      <span className="text-muted-foreground">
                        {label(event.before)} → {label(event.after)}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {event.actor} · {formatDate(event.createdAt)}
                      {event.revision ? ` · ${t('attributes:history.revision', { revision: event.revision })}` : ''}
                    </p>
                    {event.reason ? <p className="mt-1 text-xs text-muted-foreground">{event.reason}</p> : null}
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
