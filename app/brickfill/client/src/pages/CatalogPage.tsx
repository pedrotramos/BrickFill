import { useMemo, useState } from 'react';
import { useTranslation } from '../i18n/react';
import { Link, useSearchParams } from 'react-router';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Input,
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
import { AlertCircle, ArrowRight, ChevronLeft, ChevronRight, Search, SlidersHorizontal } from 'lucide-react';
import { PageHeader, RefreshButton } from '../components/PageHeader';
import { QualityInfo } from '../components/QualityInfo';
import { StatusBadge } from '../components/StatusBadge';
import { queryErrorText } from '../lib/api-errors';
import { useCatalogQuery } from '../lib/catalog-query';
import { formatDate, formatNumber, formatPercent } from '../lib/formatters';
import { issueTitle } from '../lib/issues';

const NO_PARAMETERS = {};

/** Categories carry a stable category_id from the canonical contract; older sources only the name. */
function categoryKey(item: { category: string }): string {
  const id = (item as { category_id?: unknown }).category_id;
  return typeof id === 'string' && id ? id : item.category;
}
const PAGE_SIZES = [25, 50, 100];
const SORTS = [
  { value: 'queue', label: 'catalog:sort.queue' },
  { value: 'quality_asc', label: 'catalog:sort.qualityAsc' },
  { value: 'quality_desc', label: 'catalog:sort.qualityDesc' },
] as const;
/** Decisions saved by a reviewer, shown next to the status the enrichment job gave the product. */
const DECISIONS = new Set(['IN_REVIEW', 'APPROVED', 'REJECTED']);

/** A product never enriched has no quality or coverage yet: a dash, not a measured 0%. */
function measured(product: { status: string }, value: number | null | undefined) {
  return product.status === 'PENDING' ? '—' : formatPercent(value);
}

export function CatalogPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  // The box edits `searchInput`; only Enter commits it to `search`, which drives the query.
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(searchParams.get('status') ?? '');
  const [category, setCategory] = useState('');
  const [issue, setIssue] = useState(searchParams.get('issue') ?? '');
  const [sort, setSort] = useState<string>(SORTS[0].value);
  const [refreshToken, setRefreshToken] = useState(() => Date.now());
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [page, setPage] = useState(0);
  // Phones show the search and fold the other filters away; from md they are always visible.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilters = [status, category, issue].filter(Boolean).length + (sort === SORTS[0].value ? 0 : 1);
  const queryParameters = useMemo(
    () => ({
      search,
      status,
      category,
      issue,
      sort,
      page_size: String(pageSize),
      page_offset: String(page * pageSize),
      refresh_token: String(refreshToken),
    }),
    [search, status, category, issue, sort, pageSize, page, refreshToken]
  );
  const query = useCatalogQuery('product_list', queryParameters);
  const { data, loading } = query;
  const error = queryErrorText(query);
  const total = Number(data?.[0]?.total_count ?? 0);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  // Any change of the filters starts again from the first page.
  const changeFilter =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value);
      setPage(0);
    };
  const categories = useCatalogQuery('categories', NO_PARAMETERS);
  const issueParameters = useMemo(() => ({ refresh_token: String(refreshToken) }), [refreshToken]);
  const issueCodes = useCatalogQuery('issue_codes', issueParameters);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <PageHeader
        actions={<RefreshButton label={t('catalog:refresh')} onClick={() => setRefreshToken(Date.now())} />}
        description={t('catalog:subtitle')}
        title={t('catalog:title')}
      />

      {/* A toolbar right above the table, as in the workspace lists; it wraps instead of overflowing. */}
      <section aria-labelledby="catalog-filters-title" className="grid gap-2 md:flex md:flex-wrap md:items-center">
        <h2 className="sr-only" id="catalog-filters-title">
          {t('catalog:filters.title')}
        </h2>
        <form
          className="relative md:min-w-56 md:max-w-96 md:flex-1"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            changeFilter(setSearch)(searchInput.trim());
          }}
        >
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label={t('catalog:filters.searchLabel')}
            className="pl-9"
            placeholder={t('catalog:filters.searchPlaceholder')}
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </form>
        <Button
          aria-controls="catalog-filters"
          aria-expanded={filtersOpen}
          className="justify-between md:hidden"
          variant="outline"
          onClick={() => setFiltersOpen(!filtersOpen)}
        >
          <span className="inline-flex items-center gap-2">
            <SlidersHorizontal aria-hidden className="h-4 w-4" />
            {filtersOpen ? t('catalog:filters.hide') : t('catalog:filters.show')}
          </span>
          {activeFilters ? (
            <span className="text-xs text-muted-foreground">
              {t('catalog:filters.active', { count: activeFilters })}
            </span>
          ) : null}
        </Button>
        <div className={`${filtersOpen ? 'grid' : 'hidden'} gap-2 md:contents`} id="catalog-filters">
          <Select
            value={status || '__all__'}
            onValueChange={(value) => changeFilter(setStatus)(value === '__all__' ? '' : value)}
          >
            <SelectTrigger aria-label={t('catalog:filters.statusLabel')} className="w-full md:w-auto">
              <SelectValue placeholder={t('catalog:filters.allStatuses')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t('catalog:filters.allStatuses')}</SelectItem>
              <SelectItem value="REVIEW_REQUIRED">{t('common:status.REVIEW_REQUIRED')}</SelectItem>
              <SelectItem value="ENRICHED">{t('common:status.ENRICHED')}</SelectItem>
              <SelectItem value="PENDING">{t('common:status.PENDING')}</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={category || '__all__'}
            onValueChange={(value) => changeFilter(setCategory)(value === '__all__' ? '' : value)}
          >
            <SelectTrigger aria-label={t('catalog:filters.categoryLabel')} className="w-full md:w-auto">
              <SelectValue placeholder={t('catalog:filters.allCategories')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t('catalog:filters.allCategories')}</SelectItem>
              {categories.data?.map((item) => (
                <SelectItem key={categoryKey(item)} value={item.category}>
                  {item.category}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={issue || '__all__'}
            onValueChange={(value) => changeFilter(setIssue)(value === '__all__' ? '' : value)}
          >
            <SelectTrigger aria-label={t('catalog:filters.issueLabel')} className="w-full md:w-auto">
              <SelectValue placeholder={t('catalog:filters.allIssues')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t('catalog:filters.allIssues')}</SelectItem>
              {issueCodes.data?.map((item) => (
                <SelectItem key={item.issue_code} value={item.issue_code}>
                  {issueTitle(item.issue_code)} ({formatNumber(item.product_count)})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={changeFilter(setSort)}>
            <SelectTrigger aria-label={t('catalog:filters.sortLabel')} className="w-full md:w-auto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORTS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {t(item.label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setSearch('');
                setSearchInput('');
                setStatus('');
                setCategory('');
                setIssue('');
                setSort(SORTS[0].value);
                setPage(0);
              }}
            >
              {t('common:actions.clear')}
            </Button>
          </div>
        </div>
      </section>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{t('catalog:loadError')}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <Skeleton className="h-96" />
      ) : !data?.length ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>{t('catalog:empty.title')}</EmptyTitle>
            <EmptyDescription>{t('catalog:empty.description')}</EmptyDescription>
            {page > 0 ? (
              <Button variant="outline" onClick={() => setPage(0)}>
                {t('catalog:empty.firstPage')}
              </Button>
            ) : null}
          </EmptyHeader>
        </Empty>
      ) : (
        <Card className="overflow-hidden py-0">
          <CardContent className="p-0 [&_[data-slot=table-container]]:overflow-x-hidden">
            {/* Below 1024px the seven columns no longer fit: each product is a card, the whole card opens it. */}
            <ul aria-label={t('catalog:title')} className="divide-y lg:hidden">
              {data.map((product) => (
                <li
                  className="relative p-4 focus-within:bg-muted/50 hover:bg-muted/50 md:px-6"
                  key={`card-${product.ean}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        className="line-clamp-2 break-words font-medium after:absolute after:inset-0 focus-visible:outline-none after:focus-visible:ring-2 after:focus-visible:ring-inset after:focus-visible:ring-ring"
                        title={product.display_title}
                        to={`/catalog/${product.ean}`}
                      >
                        {product.display_title}
                      </Link>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t('catalog:table.gtin', { gtin: product.ean })}
                        {product.brand ? ` · ${product.brand}` : ''}
                      </p>
                    </div>
                    <ArrowRight aria-hidden className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                  </div>
                  {product.category ? (
                    <p className="mt-2 text-sm">
                      {product.category}
                      {product.subcategory ? (
                        <span className="text-muted-foreground"> · {product.subcategory}</span>
                      ) : null}
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <StatusBadge status={product.status} />
                    {product.review_status && DECISIONS.has(product.review_status) ? (
                      <StatusBadge status={product.review_status} />
                    ) : null}
                    {product.status !== 'PENDING' ? (
                      <span className="text-xs text-muted-foreground">
                        {t('catalog:table.issueCounts', {
                          errors: formatNumber(product.error_count),
                          warnings: formatNumber(product.warning_count),
                        })}
                      </span>
                    ) : null}
                  </div>
                  <dl className="mt-3 grid max-w-md grid-cols-3 gap-3 text-sm">
                    <div>
                      <dt className="flex items-center gap-1 text-xs text-muted-foreground">
                        {t('catalog:table.quality')}
                        {/* above the card's link, so it opens the explanation instead of the product */}
                        <span className="relative z-10 inline-flex">
                          <QualityInfo />
                        </span>
                      </dt>
                      <dd className="font-medium tabular-nums">{measured(product, product.quality_score)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">{t('catalog:table.coverage')}</dt>
                      <dd className="font-medium tabular-nums">{measured(product, product.required_coverage)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">{t('catalog:table.updated')}</dt>
                      <dd className="text-xs text-muted-foreground">{formatDate(product.created_at)}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
            <div className="hidden lg:block">
              <Table className="table-fixed [&_[data-slot=badge]]:whitespace-normal [&_td]:whitespace-normal [&_th]:whitespace-normal">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[31%] pl-4">{t('catalog:table.product')}</TableHead>
                    <TableHead className="w-[18%]">{t('catalog:table.category')}</TableHead>
                    <TableHead className="w-[17%]">{t('catalog:table.status')}</TableHead>
                    <TableHead className="w-[10%] text-right">
                      <span className="inline-flex items-center gap-1">
                        {t('catalog:table.quality')}
                        <QualityInfo />
                      </span>
                    </TableHead>
                    <TableHead className="w-[10%] text-right">{t('catalog:table.coverage')}</TableHead>
                    <TableHead className="w-[14%] pr-4 pl-6">{t('catalog:table.updated')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((product) => (
                    <TableRow className="relative" key={product.ean}>
                      <TableCell className="min-w-0 overflow-hidden pl-4">
                        <div className="min-w-0 overflow-hidden">
                          {/* the name is the row's link; its hit area covers the whole row */}
                          <Link
                            aria-label={t('catalog:table.openProduct', { title: product.display_title })}
                            className="line-clamp-2 break-words font-medium after:absolute after:inset-0 hover:text-primary hover:underline focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
                            title={product.display_title}
                            to={`/catalog/${product.ean}`}
                          >
                            {product.display_title}
                          </Link>
                          <p className="text-xs text-muted-foreground">
                            {t('catalog:table.gtin', { gtin: product.ean })}
                            {product.brand ? ` · ${product.brand}` : ''}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <p>{product.category}</p>
                        <p className="text-xs text-muted-foreground">{product.subcategory}</p>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <StatusBadge status={product.status} />
                          {product.review_status && DECISIONS.has(product.review_status) ? (
                            <StatusBadge status={product.review_status} />
                          ) : null}
                        </div>
                        {product.status !== 'PENDING' ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t('catalog:table.issueCounts', {
                              errors: formatNumber(product.error_count),
                              warnings: formatNumber(product.warning_count),
                            })}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {measured(product, product.quality_score)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {measured(product, product.required_coverage)}
                      </TableCell>
                      <TableCell className="pr-4 pl-6 text-xs whitespace-nowrap text-muted-foreground">
                        {formatDate(product.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <nav
              aria-label={t('catalog:pagination.label')}
              className="flex flex-wrap items-center justify-between gap-3 border-t p-4 text-sm"
            >
              <p className="text-muted-foreground" role="status">
                {t('catalog:pagination.showing', {
                  from: formatNumber(page * pageSize + 1),
                  to: formatNumber(page * pageSize + data.length),
                  total: formatNumber(total),
                  count: total,
                })}
              </p>
              {/* on phones the page size and the pager split into two groups that wrap instead of overflowing */}
              <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto">
                <Select
                  value={String(pageSize)}
                  onValueChange={(value) => {
                    setPageSize(Number(value));
                    setPage(0);
                  }}
                >
                  <SelectTrigger aria-label={t('catalog:pagination.pageSizeLabel')} className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZES.map((size) => (
                      <SelectItem key={size} value={String(size)}>
                        {t('catalog:pagination.perPage', { size })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-2">
                  <Button
                    aria-label={t('catalog:pagination.previous')}
                    disabled={page === 0}
                    size="icon"
                    variant="outline"
                    onClick={() => setPage(page - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="min-w-24 text-center tabular-nums">
                    {t('catalog:pagination.page', { page: formatNumber(page + 1), pages: formatNumber(pageCount) })}
                  </span>
                  <Button
                    aria-label={t('catalog:pagination.next')}
                    disabled={page + 1 >= pageCount}
                    size="icon"
                    variant="outline"
                    onClick={() => setPage(page + 1)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </nav>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
