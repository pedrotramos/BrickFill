import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@databricks/appkit-ui/react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Languages,
  Pencil,
  PencilLine,
  RefreshCw,
  Save,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { useTranslation } from '../i18n/react';
import type { TFunction } from '../i18n/translator';
import { AttributeAudit } from '../components/AttributeAudit';
import { ManualEvidenceForm } from '../components/ManualEvidenceForm';
import type { EvidenceReference } from '../components/AttributeAudit';
import { RefreshButton } from '../components/PageHeader';
import { QualityInfo } from '../components/QualityInfo';
import { StatusBadge, ToneBadge } from '../components/StatusBadge';
import { useCatalogQuery } from '../lib/catalog-query';
import { ApiError, ensureOk, errorText, queryErrorText } from '../lib/api-errors';
import { formatDate, formatPercent } from '../lib/formatters';
import { attributeReason, fieldLabel, issueMessage, issueTitle, severityLabel } from '../lib/issues';
import { languageLabel } from '../i18n/languages';
import { evidenceFileUrl, hostname } from '../lib/evidence';
import {
  type ManualEvidence,
  type ManualEvidenceDraft,
  addManualEvidence,
  draftProblem,
  emptyDraft,
  evidencePayload,
  removeManualEvidence,
} from '../lib/manual-evidence';

interface Review {
  product_ean: string;
  status: 'PENDING' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED';
  assignee: string;
  notes: string;
  updated_by: string;
  updated_at: string;
  /** Enrichment run the decision was made on (null for decisions saved before the app recorded it). */
  run_id: string | null;
  /** The decision was made on the result shown now; a re-enriched product needs a new one. */
  applies: boolean;
}
interface AttributeOverride {
  id: number;
  attribute_code: string;
  attribute_name: string;
  value: string;
  reason: string;
  created_by: string;
  created_at: string;
}
interface AuditEvent {
  id: number;
  event_type: string;
  field_key: string | null;
  before_value: string | null;
  after_value: string | null;
  reason: string | null;
  actor: string;
  created_at: string;
}
interface ReviewState {
  review: Review | null;
  overrides: AttributeOverride[];
  events: AuditEvent[];
  evidence: ManualEvidence[];
  /** Run of the result shown, and the latest audit event: a decision is saved against both. */
  currentRunId: string | null;
  lastEventId: string | null;
}
type EvidenceItem = EvidenceReference;
interface VisualAttribute {
  code: string;
  value?: string | null;
  candidate_value?: string | null;
  visual_evidence?: EvidenceReference[];
}
interface GeneratedPayload {
  fact_sheet?: Array<{ name: string; items: Array<{ label: string; value: string }> }>;
  faq?: Array<{ question: string; answer: string; source_urls: string[] }>;
  attributes?: VisualAttribute[];
}
// Manifest of an evidence recapture; 'PILOT' and pilot.json are its stored contract.
interface RecaptureEvidence extends GeneratedPayload {
  capture_mode: 'PILOT';
  capture_run_id: string;
  source_run_id: string;
  ean: string;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizeEvidenceUrl(url: string): string {
  return url.replace(/\/$/, '');
}

function asBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === 'true';
}

type AttributeFilter = 'relevant' | 'filled' | 'candidates' | 'required' | 'not_applicable';

function candidateStatusLabel(t: TFunction, status: unknown, published = false): string {
  if (status === 'OUT_OF_VOCAB') {
    return published
      ? t('product:attributes.candidate.outOfVocabularyPreapproved')
      : t('product:attributes.candidate.outOfVocabulary');
  }
  if (status === 'CONFLICT') return t('product:attributes.candidate.conflict');
  return t('product:attributes.candidate.noEvidence');
}

/** Fields added by the canonical contract; read defensively so older query outputs keep working. */
function isStaleDecision(review: Review | null): boolean {
  return Boolean(review && !review.applies && (review.status === 'APPROVED' || review.status === 'REJECTED'));
}

function optionalText(row: object | undefined, name: string): string | null {
  const value = (row as Record<string, unknown> | undefined)?.[name];
  return typeof value === 'string' && value.trim() ? value : null;
}

/** Localized reasons of the attribute state: codes from the pipeline, English text as the fallback. */
function reasonsFor(attribute: object): string[] {
  const reasons = [
    attributeReason(
      'rejection',
      optionalText(attribute, 'rejection_code'),
      optionalText(attribute, 'rejection_reason')
    ),
    attributeReason(
      'applicability',
      optionalText(attribute, 'applicability_code'),
      optionalText(attribute, 'applicability_reason')
    ),
  ];
  return reasons.filter((reason): reason is string => Boolean(reason));
}

const AUDIT_EVENTS = new Set([
  'REVIEW_UPDATED',
  'REVIEW_REOPENED',
  'ATTRIBUTE_OVERRIDDEN',
  'ATTRIBUTE_OVERRIDE_REMOVED',
  'ATTRIBUTE_OVERRIDE_SUPERSEDED',
  'EVIDENCE_ADDED',
  'EVIDENCE_REMOVED',
]);

const REVIEW_STATUSES = new Set(['PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED']);
/** Review states shown beside the enrichment status; PENDING (no review yet) adds nothing to it. */
const REVIEW_DECISIONS = new Set(['IN_REVIEW', 'APPROVED', 'REJECTED']);

/** New value of a history event; review statuses are stored as codes and shown translated. */
function historyValue(t: TFunction, event: AuditEvent): string {
  const value = event.after_value ?? '';
  return event.field_key === 'review.status' && REVIEW_STATUSES.has(value) ? t(`common:status.${value}`) : value;
}

export function ProductPage() {
  const { t } = useTranslation();
  const { ean = '' } = useParams();
  const [searchParams] = useSearchParams();
  const recaptureRun = searchParams.get('evidence_run') ?? '';
  const [recapture, setRecapture] = useState<RecaptureEvidence | null>(null);
  const [recaptureError, setRecaptureError] = useState<string | null>(null);
  const [recaptureLoading, setRecaptureLoading] = useState(false);
  const [refreshToken, setRefreshToken] = useState(() => Date.now());
  const parameters = useMemo(() => ({ ean, refresh_token: String(refreshToken) }), [ean, refreshToken]);
  // A refresh keeps the page on screen (open tab, edits being typed) while the new rows load.
  const detail = useCatalogQuery('product_detail', parameters, { keepPrevious: true });
  const attributes = useCatalogQuery('product_attributes', parameters, { keepPrevious: true });
  const facts = useCatalogQuery('product_facts', parameters, { keepPrevious: true });
  const issues = useCatalogQuery('product_issues', parameters, { keepPrevious: true });
  const navigate = useNavigate();
  // Next product of the review queue (refreshed with the page and after a decision is saved).
  const next = useCatalogQuery('next_in_queue', parameters, { keepPrevious: true });
  const nextProduct = next.data?.[0] ?? null;
  const [reviewState, setReviewState] = useState<ReviewState>({
    review: null,
    overrides: [],
    events: [],
    evidence: [],
    currentRunId: null,
    lastEventId: null,
  });
  const [reviewLoading, setReviewLoading] = useState(true);
  // after the first load, reloads keep the review form on screen
  const [reviewLoaded, setReviewLoaded] = useState(false);
  // Each failure is shown where it happened: loading at the top, a decision in the review form, an edit in its row
  // (evidence and restoring an edit report inside the audit panel, see AttributeAudit).
  const [loadError, setLoadError] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [reviewSaved, setReviewSaved] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setRecapture(null);
    setRecaptureError(null);
    setRecaptureLoading(false);
    if (!recaptureRun) return () => controller.abort();
    if (!/^[0-9a-f-]{36}$/i.test(recaptureRun)) {
      setRecaptureError(t('product:recapture.invalidId'));
      return () => controller.abort();
    }
    setRecaptureLoading(true);
    void fetch(evidenceFileUrl(`${recaptureRun}/pilot.json`), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(t('product:recapture.loadFailed'));
        const payload = (await response.json()) as RecaptureEvidence;
        if (payload.capture_mode !== 'PILOT' || payload.ean !== ean || payload.capture_run_id !== recaptureRun) {
          throw new Error(t('product:recapture.mismatch'));
        }
        setRecapture(payload);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setRecaptureError(errorText(error, 'product:recapture.loadFailed'));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setRecaptureLoading(false);
      });
    return () => controller.abort();
  }, [ean, recaptureRun, refreshToken, t]);
  const [reviewStatus, setReviewStatus] = useState<Review['status']>('PENDING');
  const [notes, setNotes] = useState('');
  const [assignee, setAssignee] = useState('');
  const [savingReview, setSavingReview] = useState(false);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [overrideValue, setOverrideValue] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideEvidence, setOverrideEvidence] = useState<ManualEvidenceDraft>(emptyDraft);
  const [savingOverride, setSavingOverride] = useState(false);
  const [removingOverrideCode, setRemovingOverrideCode] = useState<string | null>(null);
  const [attributeFilter, setAttributeFilter] = useState<AttributeFilter>('relevant');

  /**
   * Reads the review, edits, evidence and history. The status always follows the server (an edit can reopen an
   * approval); the notes and assignee being typed are kept unless `resetDraft` (first load, after saving the review).
   */
  const loadReview = useCallback(
    async (resetDraft: boolean) => {
      setReviewLoading(true);
      setLoadError(null);
      try {
        const response = await fetch(`/api/products/${ean}/review-state`);
        await ensureOk(response, 'errors:REVIEW_LOAD_FAILED');
        const payload = (await response.json()) as ReviewState;
        setReviewState({ ...payload, evidence: payload.evidence ?? [] });
        // an approval or rejection of an older result does not hold for this one: the product is to review again
        setReviewStatus(isStaleDecision(payload.review) ? 'PENDING' : (payload.review?.status ?? 'PENDING'));
        if (resetDraft) {
          setNotes(payload.review?.notes ?? '');
          setAssignee(payload.review?.assignee ?? '');
        }
      } catch (error) {
        setLoadError(errorText(error, 'errors:REVIEW_LOAD_FAILED'));
      } finally {
        setReviewLoading(false);
        setReviewLoaded(true);
      }
    },
    [ean]
  );

  useEffect(() => {
    void loadReview(true);
  }, [loadReview]);

  /** Someone changed the product since the page loaded (REVIEW_STALE): show the current result and edits. */
  const reloadIfStale = async (error: unknown) => {
    if (!(error instanceof ApiError) || error.code !== 'REVIEW_STALE') return;
    setRefreshToken(Date.now());
    await loadReview(false);
  };

  const refresh = () => {
    setRefreshToken(Date.now());
    void loadReview(false);
  };

  const saveReview = async () => {
    setSavingReview(true);
    setDecisionError(null);
    setReviewSaved(false);
    try {
      const response = await fetch(`/api/products/${ean}/review`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        // the decision is made on the result and the edits this page shows
        body: JSON.stringify({
          status: reviewStatus,
          assignee,
          notes,
          runId: reviewState.currentRunId,
          basedOnEventId: reviewState.lastEventId,
        }),
      });
      await ensureOk(response, 'errors:REVIEW_SAVE_FAILED');
      if ((reviewStatus === 'APPROVED' || reviewStatus === 'REJECTED') && nextProduct) {
        // a decision closes this product: go on with the queue
        void navigate(`/catalog/${nextProduct.ean}`);
        return;
      }
      await loadReview(true);
      setReviewSaved(true);
    } catch (error) {
      await reloadIfStale(error);
      setDecisionError(errorText(error, 'errors:REVIEW_SAVE_FAILED'));
    } finally {
      setSavingReview(false);
    }
  };

  const beginOverride = (code: string, currentValue: string | null | undefined) => {
    setEditingCode(code);
    setEditError(null);
    setOverrideValue(currentValue ?? '');
    setOverrideReason('');
    setOverrideEvidence(emptyDraft);
  };
  const canSaveOverride =
    !savingOverride &&
    Boolean(overrideValue.trim()) &&
    overrideReason.trim().length >= 3 &&
    !draftProblem(overrideEvidence);
  const saveOverride = async (attributeCode: string, attributeName: string) => {
    if (!canSaveOverride) return;
    setSavingOverride(true);
    setEditError(null);
    try {
      // Every human edit carries its own evidence: the screenshot is uploaded first, then the edit references it.
      const evidence = await evidencePayload(ean, attributeCode, overrideEvidence);
      const response = await fetch(`/api/products/${ean}/attribute-overrides`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attributeCode,
          attributeName,
          value: overrideValue.trim(),
          reason: overrideReason.trim(),
          evidence,
        }),
      });
      await ensureOk(response, 'errors:OVERRIDE_SAVE_FAILED');
      setEditingCode(null);
      await loadReview(false);
    } catch (error) {
      setEditError(errorText(error, 'errors:OVERRIDE_SAVE_FAILED'));
    } finally {
      setSavingOverride(false);
    }
  };

  // The audit panel actions resolve to the error message to show there, or null when they succeeded.
  const removeOverride = async (attributeCode: string): Promise<string | null> => {
    setRemovingOverrideCode(attributeCode);
    try {
      const response = await fetch(`/api/products/${ean}/attribute-overrides/${encodeURIComponent(attributeCode)}`, {
        method: 'DELETE',
      });
      await ensureOk(response, 'errors:OVERRIDE_RESTORE_FAILED');
      if (editingCode === attributeCode) setEditingCode(null);
      await loadReview(false);
      return null;
    } catch (error) {
      return errorText(error, 'errors:OVERRIDE_RESTORE_FAILED');
    } finally {
      setRemovingOverrideCode(null);
    }
  };

  const addEvidence = async (
    attributeCode: string,
    attributeName: string,
    draft: ManualEvidenceDraft
  ): Promise<string | null> => {
    try {
      await addManualEvidence(ean, attributeCode, attributeName, draft, reviewState.currentRunId);
      await loadReview(false);
      return null;
    } catch (error) {
      await reloadIfStale(error);
      return errorText(error, 'errors:EVIDENCE_SAVE_FAILED');
    }
  };
  const removeEvidence = async (attributeCode: string, id: number): Promise<string | null> => {
    try {
      await removeManualEvidence(ean, attributeCode, id);
      await loadReview(false);
      return null;
    } catch (error) {
      return errorText(error, 'errors:EVIDENCE_REMOVE_FAILED');
    }
  };
  const manualEvidenceFor = (code: string) => reviewState.evidence.filter((item) => item.attribute_code === code);

  const product = detail.data?.[0];
  const contentLanguage = optionalText(product, 'content_language');
  const productId = optionalText(product, 'product_id');
  const generated = parseJson<GeneratedPayload>(product?.result_json, {});
  const overrideByCode = new Map(reviewState.overrides.map((item) => [item.attribute_code, item]));
  const evidenceByFact = useMemo(() => {
    const index = new Map<string, EvidenceReference[]>();
    for (const fact of facts.data ?? []) {
      index.set(fact.fact_name, parseJson<EvidenceItem[]>(fact.evidence_json, []));
    }
    return index;
  }, [facts.data]);
  const referencesFor = (attribute: {
    attribute_code: string;
    evidence_urls_json: unknown;
    source_fact_names_json: unknown;
  }): EvidenceReference[] => {
    const visual = (recapture?.attributes ?? generated.attributes)?.find(
      (item) => item.code === attribute.attribute_code
    );
    if (visual?.visual_evidence?.length) return visual.visual_evidence;
    const names = parseJson<string[]>(attribute.source_fact_names_json, []);
    const urls = new Set(parseJson<string[]>(attribute.evidence_urls_json, []).map(normalizeEvidenceUrl));
    const references = names
      .flatMap((name) => evidenceByFact.get(name) ?? [])
      .filter((reference) => urls.has(normalizeEvidenceUrl(reference.url)));
    const covered = new Set(references.map((reference) => normalizeEvidenceUrl(reference.url)));
    return [
      ...references,
      ...Array.from(urls)
        .filter((url) => !covered.has(url))
        .map((url) => ({ url })),
    ];
  };
  const expectsCapture = (code: string) =>
    (recapture?.attributes ?? generated.attributes)?.some(
      (item) => item.code === code && item.visual_evidence !== undefined
    ) ?? false;
  const visibleAttributes = useMemo(() => {
    return (attributes.data ?? []).filter((attribute) => {
      const required = asBoolean(attribute.required);
      const applicable = asBoolean(attribute.applicable);
      const hasOverride = reviewState.overrides.some((item) => item.attribute_code === attribute.attribute_code);
      const filled = hasOverride || Boolean(attribute.attribute_value);
      const candidate = attribute.mapping_status === 'OUT_OF_VOCAB' || (!filled && Boolean(attribute.candidate_value));
      const requiredPending = required && !filled;
      if (attributeFilter === 'filled') return filled;
      if (attributeFilter === 'candidates') return candidate;
      if (attributeFilter === 'required') return requiredPending;
      if (attributeFilter === 'not_applicable') return !applicable;
      return filled || candidate || requiredPending;
    });
  }, [attributeFilter, attributes.data, reviewState.overrides]);
  const queryError =
    queryErrorText(detail) || queryErrorText(attributes) || queryErrorText(facts) || queryErrorText(issues);
  const refreshing = detail.loading || reviewLoading;

  if (detail.loading && !product)
    return (
      <div className="mx-auto max-w-7xl space-y-4" role="status">
        <span className="sr-only">{t('product:loading')}</span>
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-96" />
      </div>
    );
  if (!product) {
    // a failed query is not a missing product: say so and offer to try again
    const failed = queryErrorText(detail);
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>{failed ? t('product:loadFailed.title') : t('product:notFound.title')}</EmptyTitle>
          <EmptyDescription>{failed ?? t('product:notFound.description')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row flex-wrap justify-center">
          {failed ? (
            <Button onClick={refresh}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t('common:actions.retry')}
            </Button>
          ) : null}
          <Button asChild variant="outline">
            <Link to="/catalog">
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t('product:backToCatalog')}
            </Link>
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      {recaptureRun ? (
        <Alert>
          <AlertTitle>{t('product:recapture.title')}</AlertTitle>
          <AlertDescription>
            {recaptureLoading ? t('product:recapture.loading') : (recaptureError ?? t('product:recapture.notice'))}
            {recapture && recapture.source_run_id !== product.run_id ? ` ${t('product:recapture.olderRun')}` : ''}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
        <Button asChild className="-ml-2" variant="ghost" size="sm">
          <Link to="/catalog">
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t('product:backToCatalog')}
          </Link>
        </Button>
        <div className="order-last flex w-full flex-wrap items-center gap-2 md:order-none md:ml-auto md:w-auto">
          <RefreshButton busy={refreshing} label={t('product:refresh')} onClick={refresh} />
          {nextProduct ? (
            <Button asChild size="sm" title={nextProduct.display_title}>
              <Link to={`/catalog/${nextProduct.ean}`}>
                {t('product:queue.next')}
                <span className="ml-1 font-normal opacity-80">
                  {t('product:queue.remaining', { count: nextProduct.remaining })}
                </span>
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          ) : next.data ? (
            <span className="text-xs text-muted-foreground">{t('product:queue.empty')}</span>
          ) : null}
        </div>
        <div className="flex w-full flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-4xl">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <StatusBadge status={product.status} />
              {reviewState.review?.status && REVIEW_DECISIONS.has(reviewState.review.status) ? (
                <StatusBadge status={reviewState.review.status} />
              ) : null}
              <Badge variant="outline">{t('product:gtin', { gtin: product.ean })}</Badge>
              {productId ? <Badge variant="outline">{t('product:productId', { id: productId })}</Badge> : null}
              {product.category ? (
                <Badge className="max-w-full whitespace-normal break-words" variant="secondary">
                  {product.category}
                </Badge>
              ) : null}
              {contentLanguage ? (
                <Badge title={t('product:contentLanguage.tooltip')} variant="outline">
                  <Languages aria-hidden className="mr-1 h-3 w-3" />
                  {t('product:contentLanguage.badge', { language: languageLabel(contentLanguage) })}
                </Badge>
              ) : null}
            </div>
            <h1 className="break-words text-[1.375rem] leading-7 font-semibold">
              {product.generated_title || product.source_title || t('product:gtin', { gtin: product.ean })}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {[product.verified_brand || product.source_brand, product.subcategory].filter(Boolean).join(' · ')} ·{' '}
              {product.created_at
                ? t('product:updatedAt', { date: formatDate(product.created_at) })
                : t('common:notUpdatedYet')}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Card className="py-0">
              <CardContent className="p-4">
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  {t('product:quality')}
                  <QualityInfo />
                </p>
                <p className="text-2xl font-semibold tabular-nums">{formatPercent(product.quality_score)}</p>
              </CardContent>
            </Card>
            <Card className="py-0">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{t('product:coverage')}</p>
                <p className="text-2xl font-semibold tabular-nums">{formatPercent(product.required_coverage)}</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
      {(queryError || loadError) && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{t('product:unavailableData')}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>{queryError || loadError}</span>
            <Button disabled={refreshing} size="sm" variant="outline" onClick={refresh}>
              {t('common:actions.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <Tabs defaultValue="content">
        <TabsList className="flex h-auto flex-wrap justify-start">
          <TabsTrigger value="content">{t('product:tabs.content')}</TabsTrigger>
          <TabsTrigger value="attributes">{t('product:tabs.attributes')}</TabsTrigger>
          <TabsTrigger value="evidence">{t('product:tabs.evidence')}</TabsTrigger>
          <TabsTrigger value="issues">
            {t('product:tabs.issues', { count: Number(product.error_count) + Number(product.warning_count) })}
          </TabsTrigger>
          <TabsTrigger value="review">{t('product:tabs.review')}</TabsTrigger>
        </TabsList>
        <TabsContent value="content" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle aria-level={2} role="heading">
                {t('product:content.shortDescription')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="leading-7">{product.short_description || t('product:content.notGenerated')}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle aria-level={2} role="heading">
                {t('product:content.metaDescription')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p>{product.meta_description || t('product:content.notGenerated')}</p>
            </CardContent>
          </Card>
          {generated.fact_sheet?.map((section) => (
            <Card key={section.name}>
              <CardHeader>
                <CardTitle aria-level={2} role="heading">
                  {section.name}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-x-6 gap-y-3 md:grid-cols-2">
                  {section.items.map((item) => (
                    <div key={`${section.name}-${item.label}`} className="border-b pb-2">
                      <dt className="text-xs text-muted-foreground">{item.label}</dt>
                      <dd className="font-medium">{item.value}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          ))}
          {generated.faq?.length ? (
            <Card>
              <CardHeader>
                <CardTitle aria-level={2} role="heading">
                  {t('product:content.faq')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {generated.faq.map((item) => (
                  <div key={item.question}>
                    <h3 className="font-medium">{item.question}</h3>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">{item.answer}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>
        <TabsContent value="attributes">
          <Card>
            <CardHeader>
              <CardTitle aria-level={2} role="heading">
                {t('product:attributes.title')}
              </CardTitle>
              <p className="text-sm text-muted-foreground">{t('product:attributes.subtitle')}</p>
            </CardHeader>
            <CardContent className="space-y-4 p-0">
              <div className="px-4 md:px-6">
                <Alert>
                  <ShieldCheck className="h-4 w-4" />
                  <AlertTitle>{t('product:attributes.auditTitle')}</AlertTitle>
                  <AlertDescription>{t('product:attributes.auditDescription')}</AlertDescription>
                </Alert>
              </div>
              <div className="px-4 md:px-6">
                <Select value={attributeFilter} onValueChange={(value) => setAttributeFilter(value as AttributeFilter)}>
                  <SelectTrigger className="w-full sm:w-64" aria-label={t('product:attributes.filterLabel')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="relevant">{t('product:attributes.filters.relevant')}</SelectItem>
                    <SelectItem value="filled">{t('product:attributes.filters.filled')}</SelectItem>
                    <SelectItem value="candidates">{t('product:attributes.filters.candidates')}</SelectItem>
                    <SelectItem value="required">{t('product:attributes.filters.required')}</SelectItem>
                    <SelectItem value="not_applicable">{t('product:attributes.filters.notApplicable')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {attributes.loading && !attributes.data ? (
                <Skeleton className="m-6 h-60" />
              ) : !attributes.data?.length ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>{t('product:attributes.empty.title')}</EmptyTitle>
                    <EmptyDescription>{t('product:attributes.empty.description')}</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <>
                  <section aria-label={t('product:attributes.title')} className="divide-y lg:hidden">
                    {visibleAttributes.map((attribute) => {
                      const override = overrideByCode.get(attribute.attribute_code);
                      const effectiveValue = override?.value ?? attribute.attribute_value;
                      const candidateOnly = !effectiveValue && Boolean(attribute.candidate_value);
                      const outOfVocabulary = attribute.mapping_status === 'OUT_OF_VOCAB';
                      const references = referencesFor(attribute);
                      const editing = editingCode === attribute.attribute_code;
                      return (
                        // tablets lay the card out in two columns: what the value is, then how it is backed
                        <div
                          className="space-y-4 p-4 md:grid md:grid-cols-2 md:gap-x-8 md:gap-y-4 md:space-y-0 md:px-6"
                          key={`mobile-${attribute.attribute_code}`}
                        >
                          <div>
                            <p className="font-medium">{attribute.attribute_name}</p>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {asBoolean(attribute.required) ? (
                                <Badge variant="outline">{t('product:attributes.required')}</Badge>
                              ) : null}
                              {!asBoolean(attribute.applicable) ? (
                                <Badge variant="secondary">{t('product:attributes.notApplicable')}</Badge>
                              ) : null}
                              {candidateOnly || outOfVocabulary ? (
                                <ToneBadge
                                  icon={candidateOnly ? TriangleAlert : undefined}
                                  tone={candidateOnly ? 'warning' : 'quiet'}
                                >
                                  {candidateStatusLabel(t, attribute.mapping_status, Boolean(effectiveValue))}
                                </ToneBadge>
                              ) : null}
                            </div>
                          </div>

                          {editing ? (
                            <div className="space-y-2">
                              <Label htmlFor={`mobile-value-${attribute.attribute_code}`}>
                                {t('product:attributes.edit.newValue')}
                              </Label>
                              <Input
                                id={`mobile-value-${attribute.attribute_code}`}
                                value={overrideValue}
                                onChange={(event) => setOverrideValue(event.target.value)}
                              />
                              <Label htmlFor={`mobile-reason-${attribute.attribute_code}`}>
                                {t('product:attributes.edit.reason')}
                              </Label>
                              <Textarea
                                id={`mobile-reason-${attribute.attribute_code}`}
                                value={overrideReason}
                                onChange={(event) => setOverrideReason(event.target.value)}
                                placeholder={t('product:attributes.edit.reasonPlaceholder')}
                              />
                              <ManualEvidenceForm
                                description={t('product:attributes.edit.evidenceRequired')}
                                value={overrideEvidence}
                                onChange={setOverrideEvidence}
                              />
                            </div>
                          ) : (
                            <div>
                              <p className="text-xs text-muted-foreground">{t('product:attributes.effectiveValue')}</p>
                              <p className={effectiveValue ? 'mt-1 font-medium' : 'mt-1 text-muted-foreground'}>
                                {effectiveValue ||
                                  (candidateOnly
                                    ? t('product:attributes.notPublished')
                                    : t('product:attributes.notFound'))}
                              </p>
                              {candidateOnly ? (
                                <p className="mt-1 text-sm font-medium">
                                  {t('product:attributes.candidateValue', { value: attribute.candidate_value })}
                                </p>
                              ) : null}
                            </div>
                          )}

                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                              <p className="text-xs text-muted-foreground">{t('product:attributes.confidence')}</p>
                              <p className="mt-1 tabular-nums">
                                {override ? t('product:attributes.curated') : formatPercent(attribute.confidence)}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">{t('product:attributes.valueOrigin')}</p>
                              <div className="mt-1">
                                {override ? (
                                  <ToneBadge icon={PencilLine} tone="info">
                                    {t('product:attributes.edited')}
                                  </ToneBadge>
                                ) : (
                                  <Badge variant="outline">{t('product:attributes.agent')}</Badge>
                                )}
                              </div>
                            </div>
                          </div>

                          <AttributeAudit
                            aiValue={candidateOnly ? attribute.candidate_value : attribute.attribute_value}
                            attributeName={attribute.attribute_name}
                            candidateOnly={candidateOnly}
                            captureExpected={expectsCapture(attribute.attribute_code)}
                            observation={attribute.observation}
                            reasons={reasonsFor(attribute)}
                            onRemoveOverride={override ? () => removeOverride(attribute.attribute_code) : undefined}
                            override={override}
                            references={references}
                            removingOverride={removingOverrideCode === attribute.attribute_code}
                            manualEvidence={manualEvidenceFor(attribute.attribute_code)}
                            onAddEvidence={(draft) =>
                              addEvidence(attribute.attribute_code, attribute.attribute_name, draft)
                            }
                            onRemoveEvidence={(id) => removeEvidence(attribute.attribute_code, id)}
                          />

                          {editing ? (
                            <div className="flex flex-wrap items-center gap-2">
                              {editError ? (
                                <p className="w-full text-sm text-destructive" role="alert">
                                  {editError}
                                </p>
                              ) : null}
                              <Button
                                size="sm"
                                disabled={!canSaveOverride}
                                onClick={() => {
                                  void saveOverride(attribute.attribute_code, attribute.attribute_name);
                                }}
                              >
                                <Save className="mr-1 h-4 w-4" />
                                {t('common:actions.save')}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setEditingCode(null)}>
                                {t('common:actions.cancel')}
                              </Button>
                            </div>
                          ) : (
                            <Button
                              className="w-full"
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                beginOverride(attribute.attribute_code, effectiveValue ?? attribute.candidate_value)
                              }
                            >
                              <Pencil className="mr-1 h-4 w-4" />
                              {t('product:attributes.editAttribute')}
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </section>

                  <div className="hidden lg:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('product:attributes.table.attribute')}</TableHead>
                          <TableHead>{t('product:attributes.effectiveValue')}</TableHead>
                          <TableHead>{t('product:attributes.confidence')}</TableHead>
                          <TableHead>{t('product:attributes.table.origin')}</TableHead>
                          <TableHead>{t('product:attributes.table.audit')}</TableHead>
                          <TableHead>
                            <span className="sr-only">{t('common:actions.edit')}</span>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {visibleAttributes.map((attribute) => {
                          const override = overrideByCode.get(attribute.attribute_code);
                          const effectiveValue = override?.value ?? attribute.attribute_value;
                          const candidateOnly = !effectiveValue && Boolean(attribute.candidate_value);
                          const outOfVocabulary = attribute.mapping_status === 'OUT_OF_VOCAB';
                          const references = referencesFor(attribute);
                          const editing = editingCode === attribute.attribute_code;
                          return (
                            <TableRow key={attribute.attribute_code}>
                              <TableCell>
                                <p className="font-medium">{attribute.attribute_name}</p>
                                <div className="mt-1 flex gap-1">
                                  {asBoolean(attribute.required) ? (
                                    <Badge variant="outline">{t('product:attributes.required')}</Badge>
                                  ) : null}
                                  {!asBoolean(attribute.applicable) ? (
                                    <Badge variant="secondary">{t('product:attributes.notApplicable')}</Badge>
                                  ) : null}
                                  {candidateOnly || outOfVocabulary ? (
                                    <ToneBadge
                                      icon={candidateOnly ? TriangleAlert : undefined}
                                      tone={candidateOnly ? 'warning' : 'quiet'}
                                    >
                                      {candidateStatusLabel(t, attribute.mapping_status, Boolean(effectiveValue))}
                                    </ToneBadge>
                                  ) : null}
                                </div>
                              </TableCell>
                              <TableCell className="min-w-64">
                                {editing ? (
                                  <div className="space-y-2">
                                    <Label htmlFor={`value-${attribute.attribute_code}`}>
                                      {t('product:attributes.edit.newValue')}
                                    </Label>
                                    <Input
                                      id={`value-${attribute.attribute_code}`}
                                      value={overrideValue}
                                      onChange={(event) => setOverrideValue(event.target.value)}
                                    />
                                    <Label htmlFor={`reason-${attribute.attribute_code}`}>
                                      {t('product:attributes.edit.reason')}
                                    </Label>
                                    <Textarea
                                      id={`reason-${attribute.attribute_code}`}
                                      value={overrideReason}
                                      onChange={(event) => setOverrideReason(event.target.value)}
                                      placeholder={t('product:attributes.edit.reasonPlaceholder')}
                                    />
                                    <ManualEvidenceForm
                                      description={t('product:attributes.edit.evidenceRequired')}
                                      value={overrideEvidence}
                                      onChange={setOverrideEvidence}
                                    />
                                  </div>
                                ) : (
                                  <div>
                                    <p className={effectiveValue ? '' : 'text-muted-foreground'}>
                                      {effectiveValue ||
                                        (candidateOnly
                                          ? t('product:attributes.notPublished')
                                          : t('product:attributes.notFound'))}
                                    </p>
                                    {candidateOnly ? (
                                      <p className="mt-1 text-sm font-medium">
                                        {t('product:attributes.candidateValue', { value: attribute.candidate_value })}
                                      </p>
                                    ) : null}
                                  </div>
                                )}
                              </TableCell>
                              <TableCell>
                                {override ? t('product:attributes.curated') : formatPercent(attribute.confidence)}
                              </TableCell>
                              <TableCell>
                                {override ? (
                                  <div>
                                    <ToneBadge icon={PencilLine} tone="info">
                                      {t('product:attributes.edited')}
                                    </ToneBadge>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                      {override.created_by}
                                      <br />
                                      {formatDate(override.created_at)}
                                    </p>
                                  </div>
                                ) : (
                                  <Badge variant="outline">{t('product:attributes.agent')}</Badge>
                                )}
                              </TableCell>
                              <TableCell className="align-top">
                                <AttributeAudit
                                  aiValue={candidateOnly ? attribute.candidate_value : attribute.attribute_value}
                                  attributeName={attribute.attribute_name}
                                  candidateOnly={candidateOnly}
                                  captureExpected={expectsCapture(attribute.attribute_code)}
                                  observation={attribute.observation}
                                  reasons={reasonsFor(attribute)}
                                  onRemoveOverride={
                                    override ? () => removeOverride(attribute.attribute_code) : undefined
                                  }
                                  override={override}
                                  references={references}
                                  removingOverride={removingOverrideCode === attribute.attribute_code}
                                  manualEvidence={manualEvidenceFor(attribute.attribute_code)}
                                  onAddEvidence={(draft) =>
                                    addEvidence(attribute.attribute_code, attribute.attribute_name, draft)
                                  }
                                  onRemoveEvidence={(id) => removeEvidence(attribute.attribute_code, id)}
                                />
                              </TableCell>
                              <TableCell>
                                {editing ? (
                                  <div className="flex max-w-56 flex-wrap gap-1">
                                    {editError ? (
                                      <p className="w-full text-sm text-destructive" role="alert">
                                        {editError}
                                      </p>
                                    ) : null}
                                    <Button
                                      size="sm"
                                      disabled={!canSaveOverride}
                                      onClick={() => {
                                        void saveOverride(attribute.attribute_code, attribute.attribute_name);
                                      }}
                                    >
                                      <Save className="mr-1 h-4 w-4" />
                                      {t('common:actions.save')}
                                    </Button>
                                    <Button size="sm" variant="ghost" onClick={() => setEditingCode(null)}>
                                      {t('common:actions.cancel')}
                                    </Button>
                                  </div>
                                ) : (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                      beginOverride(
                                        attribute.attribute_code,
                                        effectiveValue ?? attribute.candidate_value
                                      )
                                    }
                                  >
                                    <Pencil className="mr-1 h-4 w-4" />
                                    {t('common:actions.edit')}
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="evidence">
          <Card>
            <CardHeader>
              <CardTitle aria-level={2} role="heading">
                {t('product:evidence.title')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {facts.loading && !facts.data ? (
                <Skeleton className="h-64" />
              ) : !facts.data?.length ? (
                <p className="text-sm text-muted-foreground">{t('product:evidence.empty')}</p>
              ) : (
                facts.data.map((fact) => {
                  const evidence = parseJson<EvidenceItem[]>(fact.evidence_json, []);
                  return (
                    <div key={fact.fact_name} className="rounded-lg border p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">{fact.fact_name}</p>
                          <p className="break-words font-medium">{fact.normalized_value ?? fact.fact_value}</p>
                        </div>
                        <Badge variant="outline">
                          {t('product:evidence.confidence', { value: formatPercent(fact.confidence) })}
                        </Badge>
                      </div>
                      <div className="mt-3 space-y-2">
                        {evidence.map((item) => (
                          <div key={`${fact.fact_name}-${item.url}`} className="rounded-md bg-muted p-3">
                            <a
                              className="inline-flex max-w-full items-center gap-1 text-sm [overflow-wrap:anywhere] font-medium text-primary underline-offset-4 hover:underline"
                              href={item.url}
                              rel="noreferrer"
                              target="_blank"
                            >
                              {item.source_title || hostname(item.url) || item.url}
                              <ExternalLink aria-hidden className="h-3 w-3 shrink-0" />
                            </a>
                            <p className="mt-1 text-sm text-muted-foreground">{item.excerpt}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="issues">
          <Card>
            <CardHeader>
              <CardTitle aria-level={2} role="heading">
                {t('product:issues.title')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {issues.loading && !issues.data ? (
                <Skeleton className="h-48" />
              ) : !issues.data?.length ? (
                <Alert>
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertTitle>{t('product:issues.none.title')}</AlertTitle>
                  <AlertDescription>{t('product:issues.none.description')}</AlertDescription>
                </Alert>
              ) : (
                issues.data.map((issue, index) => (
                  <Alert
                    key={`${issue.issue_code}-${issue.field}-${index}`}
                    // the Alert draws its icon in the text color; a warning shows the warning tone instead
                    className={issue.severity === 'ERROR' ? undefined : '[&>svg]:text-warning!'}
                    variant={issue.severity === 'ERROR' ? 'destructive' : 'default'}
                  >
                    {issue.severity === 'ERROR' ? (
                      <AlertCircle className="h-4 w-4" />
                    ) : (
                      <TriangleAlert className="h-4 w-4" />
                    )}
                    <AlertTitle className="flex flex-wrap items-center gap-x-2">
                      <span>{issueTitle(issue.issue_code)}</span>
                      {issue.field ? (
                        <span className="text-xs font-normal text-muted-foreground">{fieldLabel(issue.field)}</span>
                      ) : null}
                      <span className="text-xs font-normal text-muted-foreground">
                        {severityLabel(issue.severity)} · {issue.issue_code}
                      </span>
                    </AlertTitle>
                    <AlertDescription>{issueMessage(issue)}</AlertDescription>
                  </Alert>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="review" className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
          <Card>
            <CardHeader>
              <CardTitle aria-level={2} role="heading">
                {t('product:review.title')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!reviewLoaded ? (
                <Skeleton className="h-56" />
              ) : (
                <>
                  {isStaleDecision(reviewState.review) && reviewState.review ? (
                    <Alert>
                      <AlertDescription>
                        {t('product:review.staleDecision', {
                          status: t(`common:status.${reviewState.review.status}`),
                        })}
                      </AlertDescription>
                    </Alert>
                  ) : null}
                  <div className="space-y-2">
                    <Label htmlFor="review-status">{t('product:review.status')}</Label>
                    <Select
                      value={reviewStatus}
                      onValueChange={(value) => {
                        setReviewStatus(value as Review['status']);
                        setReviewSaved(false);
                      }}
                    >
                      <SelectTrigger id="review-status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PENDING">{t('common:status.PENDING')}</SelectItem>
                        <SelectItem value="IN_REVIEW">{t('common:status.IN_REVIEW')}</SelectItem>
                        <SelectItem value="APPROVED">{t('common:status.APPROVED')}</SelectItem>
                        <SelectItem value="REJECTED">{t('common:status.REJECTED')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="assignee">{t('product:review.assignee')}</Label>
                    <Input
                      id="assignee"
                      value={assignee}
                      onChange={(event) => {
                        setAssignee(event.target.value);
                        setReviewSaved(false);
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="notes">{t('product:review.notes')}</Label>
                    <Textarea
                      id="notes"
                      rows={5}
                      value={notes}
                      onChange={(event) => {
                        setNotes(event.target.value);
                        setReviewSaved(false);
                      }}
                    />
                  </div>
                  <Button
                    disabled={savingReview}
                    onClick={() => {
                      void saveReview();
                    }}
                  >
                    <Save className="mr-2 h-4 w-4" />
                    {savingReview ? t('common:actions.saving') : t('product:review.save')}
                  </Button>
                  {decisionError ? (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{decisionError}</AlertDescription>
                    </Alert>
                  ) : null}
                  {reviewSaved ? (
                    <p className="flex items-center gap-1.5 text-sm text-muted-foreground" role="status">
                      <CheckCircle2 aria-hidden className="h-4 w-4 text-success" />
                      {t('product:review.saved')}
                    </p>
                  ) : null}
                  {nextProduct ? (
                    <p className="text-xs text-muted-foreground">{t('product:queue.afterDecision')}</p>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle aria-level={2} role="heading">
                {t('product:history.title')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!reviewState.events.length ? (
                <p className="text-sm text-muted-foreground">{t('product:history.empty')}</p>
              ) : (
                reviewState.events.map((event) => (
                  <div key={event.id} className="border-l-2 border-border pl-3">
                    <p className="text-sm font-medium">
                      {AUDIT_EVENTS.has(event.event_type)
                        ? t(`product:history.events.${event.event_type}`)
                        : event.event_type}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {event.actor} · {formatDate(event.created_at)}
                    </p>
                    {event.after_value ? (
                      <p className="mt-1 break-words text-sm">
                        {fieldLabel(event.field_key)}: {historyValue(t, event)}
                      </p>
                    ) : null}
                    {event.event_type === 'REVIEW_REOPENED' ? (
                      <p className="mt-1 text-xs text-muted-foreground">{t('product:history.reopenedReason')}</p>
                    ) : event.reason ? (
                      <p className="mt-1 whitespace-pre-line break-words text-xs text-muted-foreground">
                        {event.reason}
                      </p>
                    ) : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
