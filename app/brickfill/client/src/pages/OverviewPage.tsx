import { useMemo, useState, type ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle, Card, CardContent, Skeleton } from '@databricks/appkit-ui/react';
import { AlertCircle, CheckCircle2, ClipboardList, Database, Gauge } from 'lucide-react';
import { useTranslation } from '../i18n/react';
import { Link } from 'react-router';
import { queryErrorText } from '../lib/api-errors';
import { PageHeader, RefreshButton } from '../components/PageHeader';
import { QualityInfo } from '../components/QualityInfo';
import { useCatalogQuery } from '../lib/catalog-query';
import { formatDate, formatNumber, formatPercent } from '../lib/formatters';

/** One figure of the summary panel: label (with the tone icon of the status it counts), value and what it means. */
function Metric({
  title,
  value,
  detail,
  icon: Icon,
  iconClassName = 'text-muted-foreground',
  info,
}: {
  title: string;
  value: string;
  detail: string;
  icon: typeof Database;
  /** Tone of the status the metric counts (StatusBadge), muted otherwise. */
  iconClassName?: string;
  info?: ReactNode;
}) {
  return (
    <div className="min-w-0 bg-card p-4 sm:p-5">
      <h2 className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
        <Icon className={`h-4 w-4 shrink-0 ${iconClassName}`} aria-hidden="true" />
        {title}
        {info}
      </h2>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
    </div>
  );
}

export function OverviewPage() {
  const { t } = useTranslation();
  const [refreshToken, setRefreshToken] = useState(() => Date.now());
  const parameters = useMemo(() => ({ refresh_token: String(refreshToken) }), [refreshToken]);
  const query = useCatalogQuery('catalog_overview', parameters);
  const { data, loading } = query;
  const error = queryErrorText(query);
  const row = data?.[0];

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <PageHeader
        actions={
          <>
            <p className="text-xs text-muted-foreground">
              {row?.last_updated_at
                ? t('overview:updatedAt', { date: formatDate(row.last_updated_at) })
                : t('common:notUpdatedYet')}
            </p>
            <RefreshButton busy={loading} label={t('overview:refresh')} onClick={() => setRefreshToken(Date.now())} />
          </>
        }
        description={t('overview:subtitle')}
        title={t('overview:title')}
      />

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{t('overview:loadError')}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <Skeleton className="h-32 rounded-xl" />
      ) : (
        <section
          aria-label={t('overview:title')}
          className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border xl:grid-cols-4"
        >
          <Metric
            title={t('overview:metrics.products.title')}
            value={formatNumber(row?.product_count)}
            detail={t('overview:metrics.products.detail')}
            icon={Database}
          />
          <Metric
            title={t('overview:metrics.enriched.title')}
            value={formatNumber(row?.enriched_count)}
            detail={t('overview:metrics.enriched.detail')}
            icon={CheckCircle2}
            iconClassName="text-info"
          />
          <Metric
            title={t('overview:metrics.review.title')}
            value={formatNumber(row?.review_count)}
            detail={t('overview:metrics.review.detail')}
            icon={ClipboardList}
            iconClassName="text-warning"
          />
          <Metric
            title={t('overview:metrics.quality.title')}
            value={row?.average_quality == null ? '—' : formatPercent(row.average_quality)}
            detail={
              row?.scored_count
                ? t('overview:metrics.quality.detail', {
                    count: row.scored_count,
                    products: formatNumber(row.scored_count),
                    coverage: formatPercent(row.average_coverage),
                  })
                : t('overview:metrics.quality.empty')
            }
            icon={Gauge}
            info={<QualityInfo averaged />}
          />
        </section>
      )}

      <Card className="py-5">
        <CardContent className="flex flex-col gap-4 px-5 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-sm font-semibold">{t('overview:nextAction.heading')}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{t('overview:nextAction.description')}</p>
          </div>
          <Link
            className="inline-flex min-h-8 shrink-0 items-center justify-center rounded-md bg-primary px-3 py-1.5 text-center text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            to="/catalog?status=REVIEW_REQUIRED"
          >
            {t('overview:nextAction.cta')}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
