import { useMemo, useState, type ReactNode } from 'react';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Skeleton,
} from '@databricks/appkit-ui/react';
import { AlertCircle, CheckCircle2, ClipboardList, Database, RefreshCw, Sparkles } from 'lucide-react';
import { useTranslation } from '../i18n/react';
import { Link } from 'react-router';
import { queryErrorText } from '../lib/api-errors';
import { QualityInfo } from '../components/QualityInfo';
import { useCatalogQuery } from '../lib/catalog-query';
import { formatDate, formatNumber, formatPercent } from '../lib/formatters';

function MetricCard({
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
    <Card className="gap-2">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-1 text-sm font-medium">
          {title}
          {info}
        </CardTitle>
        <Icon className={`h-4 w-4 ${iconClassName}`} aria-hidden="true" />
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-semibold tabular-nums">{value}</div>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
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
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{t('overview:title')}</h1>
          <p className="mt-1 text-muted-foreground">{t('overview:subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <p className="text-xs text-muted-foreground">
            {row?.last_updated_at
              ? t('overview:updatedAt', { date: formatDate(row.last_updated_at) })
              : t('common:notUpdatedYet')}
          </p>
          <Button
            aria-label={t('overview:refresh')}
            disabled={loading}
            size="icon"
            variant="outline"
            onClick={() => setRefreshToken(Date.now())}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{t('overview:loadError')}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-36" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
          <MetricCard
            title={t('overview:metrics.products.title')}
            value={formatNumber(row?.product_count)}
            detail={t('overview:metrics.products.detail')}
            icon={Database}
          />
          <MetricCard
            title={t('overview:metrics.enriched.title')}
            value={formatNumber(row?.enriched_count)}
            detail={t('overview:metrics.enriched.detail')}
            icon={CheckCircle2}
            iconClassName="text-info"
          />
          <MetricCard
            title={t('overview:metrics.review.title')}
            value={formatNumber(row?.review_count)}
            detail={t('overview:metrics.review.detail')}
            icon={ClipboardList}
            iconClassName="text-warning"
          />
          <MetricCard
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
            icon={Sparkles}
            info={<QualityInfo averaged />}
          />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle aria-level={2} role="heading">
            {t('overview:nextAction.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-medium">{t('overview:nextAction.heading')}</p>
            <p className="text-sm text-muted-foreground">{t('overview:nextAction.description')}</p>
          </div>
          <Link
            className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-md bg-primary px-4 py-2 text-center text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            to="/catalog?status=REVIEW_REQUIRED"
          >
            {t('overview:nextAction.cta')}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
