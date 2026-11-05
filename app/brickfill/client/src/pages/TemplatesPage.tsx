import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@databricks/appkit-ui/react';
import { AlertCircle, CircleCheck, CirclePause, LayoutTemplate, Lock, Plus } from 'lucide-react';
import { useTranslation } from '../i18n/react';
import { ChangeLog, ChangeValue } from '../components/ChangeLog';
import { PageHeader, RefreshButton } from '../components/PageHeader';
import { ToneBadge } from '../components/StatusBadge';
import { errorText } from '../lib/api-errors';
import { useCatalogQuery } from '../lib/catalog-query';
import { categoryOptions, type CategoryTreeRow } from '../lib/category-tree';
import { loadTemplates, type CategoryTemplate, type TemplatesState } from '../lib/editors';
import { formatDate } from '../lib/formatters';
import { groupEvents } from '../lib/history';
import { LEVELS, useTokenLabel } from '../lib/template-tokens';

const NO_PARAMETERS = {};
/** Associations shown in a row before "+N". */
const SHOWN_ASSOCIATIONS = 2;

/** Content models per product type: title formula, fact-sheet structure and required facts, edited without a PR. */
export function TemplatesPage() {
  const { t, i18n } = useTranslation();
  const tokenLabel = useTokenLabel();
  const tree = useCatalogQuery('category_tree', NO_PARAMETERS);
  const [state, setState] = useState<TemplatesState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const loaded = await loadTemplates(signal);
      if (!signal?.aborted) setState(loaded);
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
  const associations = (template: CategoryTemplate) => [
    ...LEVELS.flatMap((level) => [
      ...(template.match[`${level}_ids`] ?? []).map((id) => ({ level, name: names.get(`${level}:${id}`) ?? id })),
      ...(template.match[`${level}_names`] ?? []).map((name) => ({ level, name })),
    ]),
  ];
  const groups = useMemo(() => groupEvents(state?.history ?? []), [state?.history]);
  const templateName = (id: string) => state?.templates.find((item) => item.id === id)?.name ?? id;
  const fieldLabel = (key: string) => {
    const field = key.split('.').pop() ?? key;
    return i18n.exists(`templates:fields.${field}`) ? t(`templates:fields.${field}`) : key;
  };
  /** Title formula tokens with their labels, as the editor shows them. */
  const tokenLabels = (value: unknown) =>
    Array.isArray(value) ? value.map((token) => tokenLabel(String(token))) : value;

  const newButton = state?.canEdit ? (
    <Button asChild>
      <Link to="/templates/new">
        <Plus aria-hidden className="mr-1 h-4 w-4" />
        {t('templates:new')}
      </Link>
    </Button>
  ) : null;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <PageHeader
        actions={
          <>
            {newButton}
            <RefreshButton busy={loading} label={t('templates:reload')} onClick={() => void reload()} />
          </>
        }
        description={t('templates:subtitle')}
        title={t('templates:title')}
      />

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
          <Card className="gap-0 overflow-hidden py-0">
            <CardHeader className="border-b py-5">
              <CardTitle aria-level={2} role="heading">
                {t('templates:list.title')}
              </CardTitle>
              <CardDescription>{t('templates:list.description')}</CardDescription>
            </CardHeader>
            {!state.templates.length ? (
              <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-md bg-secondary text-muted-foreground">
                  <LayoutTemplate aria-hidden className="h-5 w-5" />
                </span>
                <div className="space-y-1">
                  <p className="text-sm font-medium">{t('templates:list.emptyTitle')}</p>
                  <p className="max-w-md text-sm text-muted-foreground">{t('templates:list.empty')}</p>
                </div>
                {newButton}
              </div>
            ) : (
              <Table className="stack-table">
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">{t('templates:list.name')}</TableHead>
                    <TableHead>{t('templates:list.associations')}</TableHead>
                    <TableHead>{t('templates:list.formula')}</TableHead>
                    <TableHead>{t('templates:list.status')}</TableHead>
                    <TableHead className="pr-6">{t('templates:list.updated')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {state.templates.map((template) => {
                    const order = Array.isArray(template.overrides.title_order)
                      ? (template.overrides.title_order as string[])
                      : [];
                    const items = associations(template);
                    const synonyms = template.match.synonyms ?? [];
                    return (
                      <TableRow className="relative hover:bg-muted/50" key={template.id}>
                        <TableCell className="pl-6" data-label={t('templates:list.name')}>
                          {/* the name is the row's link; its hit area covers the whole row */}
                          <Link
                            className="font-medium after:absolute after:inset-0 hover:text-primary hover:underline focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
                            to={`/templates/${encodeURIComponent(template.id)}`}
                          >
                            {template.name}
                          </Link>
                          <span className="block text-xs text-muted-foreground">{template.id}</span>
                        </TableCell>
                        <TableCell className="max-w-80 whitespace-normal" data-label={t('templates:list.associations')}>
                          <div className="flex flex-wrap items-center gap-1">
                            {items.slice(0, SHOWN_ASSOCIATIONS).map((item) => (
                              <Badge
                                className="max-w-56"
                                key={`${item.level}:${item.name}`}
                                title={`${t(`settings:scopes.${item.level}`)} · ${item.name}`}
                                variant="outline"
                              >
                                <span className="truncate">{item.name}</span>
                              </Badge>
                            ))}
                            {items.length > SHOWN_ASSOCIATIONS ? (
                              <span className="text-xs text-muted-foreground">
                                {t('templates:list.more', { count: items.length - SHOWN_ASSOCIATIONS })}
                              </span>
                            ) : null}
                          </div>
                          {synonyms.length ? (
                            <p className="mt-1 truncate text-xs text-muted-foreground">
                              {t('templates:list.synonyms', { synonyms: synonyms.join(', ') })}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell className="max-w-96 whitespace-normal" data-label={t('templates:list.formula')}>
                          {order.length ? (
                            <p className="line-clamp-2 text-sm">
                              {order.map((token, index) => (
                                <span key={token}>
                                  {index ? <span className="px-1 text-muted-foreground">·</span> : null}
                                  {tokenLabel(token)}
                                </span>
                              ))}
                            </p>
                          ) : (
                            <span className="text-sm text-muted-foreground">{t('templates:list.profileFormula')}</span>
                          )}
                        </TableCell>
                        <TableCell data-label={t('templates:list.status')}>
                          {template.active ? (
                            <ToneBadge icon={CircleCheck} tone="success">
                              {t('templates:list.active')}
                            </ToneBadge>
                          ) : (
                            <ToneBadge icon={CirclePause} tone="quiet">
                              {t('templates:list.inactive')}
                            </ToneBadge>
                          )}
                        </TableCell>
                        <TableCell
                          className="pr-6 text-xs text-muted-foreground"
                          data-label={t('templates:list.updated')}
                        >
                          <span className="block tabular-nums whitespace-nowrap">{formatDate(template.updatedAt)}</span>
                          <span className="block max-w-48 truncate" title={template.updatedBy}>
                            {t('templates:list.revisionBy', { revision: template.revision, actor: template.updatedBy })}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </Card>

          <Card className="gap-0 overflow-hidden py-0">
            <CardHeader className="border-b py-5">
              <CardTitle aria-level={2} role="heading">
                {t('templates:history.title')}
              </CardTitle>
              <CardDescription>{t('templates:history.description')}</CardDescription>
            </CardHeader>
            <ChangeLog
              empty="templates:history.empty"
              fieldLabel={fieldLabel}
              groups={groups}
              renderValue={(key, before, after) => {
                const level = LEVELS.find((item) => key === `match.${item}_ids`);
                const show = (value: unknown) =>
                  key.endsWith('title_order')
                    ? tokenLabels(value)
                    : level && Array.isArray(value)
                      ? value.map((id) => names.get(`${level}:${String(id)}`) ?? String(id))
                      : value;
                return <ChangeValue after={show(after)} before={show(before)} />;
              }}
              title={(group) => templateName(group.scopeId)}
            />
          </Card>
        </>
      ) : null}
    </div>
  );
}
