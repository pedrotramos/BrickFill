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
  RadioGroup,
  RadioGroupItem,
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
  CircleCheck,
  CircleX,
  ExternalLink,
  Eye,
  Languages,
  PencilLine,
  RefreshCw,
  Save,
  Search,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from '../i18n/react';
import type { TFunction } from '../i18n/translator';
import {
  AttributeSheet,
  AttributeTags,
  EvidenceTag,
  type AttributeView,
  type EvidenceReference,
} from '../components/AttributeSheet';
import { RefreshButton } from '../components/PageHeader';
import { QualityInfo } from '../components/QualityInfo';
import { StatusBadge, ToneBadge } from '../components/StatusBadge';
import { useCatalogQuery } from '../lib/catalog-query';
import { ApiError, ensureOk, errorText, queryErrorText } from '../lib/api-errors';
import { formatDate, formatPercent } from '../lib/formatters';
import { attributeReason, fieldLabel, issueMessage, issueTitle, type IssueRow } from '../lib/issues';
import { languageLabel } from '../i18n/languages';
import {
  attributeCodeOf,
  evidenceFileUrl,
  evidenceState,
  hostname,
  distinctSources,
  rankReferences,
  referenceOf,
} from '../lib/evidence';
import { matchesSearch } from '../lib/search';
import {
  type ManualEvidence,
  type ManualEvidenceDraft,
  addManualEvidence,
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

/** The four decisions, as the review form offers them. */
const DECISIONS: { status: Review['status']; icon?: LucideIcon; tone: string }[] = [
  { status: 'PENDING', tone: 'text-muted-foreground' },
  { status: 'IN_REVIEW', icon: Eye, tone: 'text-muted-foreground' },
  { status: 'APPROVED', icon: CircleCheck, tone: 'text-success' },
  { status: 'REJECTED', icon: CircleX, tone: 'text-destructive' },
];

/** Issues of the same rule and severity, shown once with every field they hit. */
interface IssueGroup {
  key: string;
  code: string;
  severity: string;
  issues: IssueRow[];
}

function groupIssues(issues: readonly IssueRow[]): IssueGroup[] {
  const groups = new Map<string, IssueGroup>();
  for (const issue of issues) {
    const severity = issue.severity ?? 'WARNING';
    const key = `${severity}:${issue.issue_code}`;
    const group = groups.get(key) ?? { key, code: issue.issue_code, severity, issues: [] };
    group.issues.push(issue);
    groups.set(key, group);
  }
  return [...groups.values()];
}

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
  const [removingOverrideCode, setRemovingOverrideCode] = useState<string | null>(null);
  const [attributeFilter, setAttributeFilter] = useState<AttributeFilter>('relevant');
  const [attributeSearch, setAttributeSearch] = useState('');
  const [tab, setTab] = useState('content');
  // one sheet for every attribute: the code shown, and whether it opened straight into the edit
  const [sheetCode, setSheetCode] = useState<string | null>(null);
  const [sheetEdit, setSheetEdit] = useState(false);

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

  const saveOverride = async (
    attributeCode: string,
    attributeName: string,
    value: string,
    reason: string,
    draft: ManualEvidenceDraft
  ): Promise<string | null> => {
    try {
      // Every human edit carries its own evidence: the screenshot is uploaded first, then the edit references it.
      const evidence = await evidencePayload(ean, attributeCode, draft);
      const response = await fetch(`/api/products/${ean}/attribute-overrides`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attributeCode, attributeName, value, reason, evidence }),
      });
      await ensureOk(response, 'errors:OVERRIDE_SAVE_FAILED');
      await loadReview(false);
      return null;
    } catch (error) {
      return errorText(error, 'errors:OVERRIDE_SAVE_FAILED');
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
  const issuesByCode = new Map<string, IssueRow[]>();
  for (const issue of issues.data ?? []) {
    const code = attributeCodeOf(issue.field);
    if (code) issuesByCode.set(code, [...(issuesByCode.get(code) ?? []), issue]);
  }
  const views: AttributeView[] = (attributes.data ?? []).map((attribute) => {
    const override = overrideByCode.get(attribute.attribute_code);
    const effectiveValue = override?.value ?? attribute.attribute_value ?? null;
    const candidateOnly = !effectiveValue && Boolean(attribute.candidate_value);
    const outOfVocabulary = attribute.mapping_status === 'OUT_OF_VOCAB';
    const ranked = rankReferences(referencesFor(attribute));
    const reference = referenceOf(ranked);
    const references = distinctSources(ranked, reference);
    const manualEvidence = manualEvidenceFor(attribute.attribute_code);
    const captureExpected = expectsCapture(attribute.attribute_code);
    return {
      code: attribute.attribute_code,
      name: attribute.attribute_name,
      required: asBoolean(attribute.required),
      applicable: asBoolean(attribute.applicable),
      candidateOnly,
      candidateLabel:
        candidateOnly || outOfVocabulary
          ? candidateStatusLabel(t, attribute.mapping_status, Boolean(effectiveValue))
          : null,
      aiValue: (candidateOnly ? attribute.candidate_value : attribute.attribute_value) ?? null,
      effectiveValue,
      confidence: attribute.confidence as number | string | null | undefined,
      override,
      references,
      reference,
      manualEvidence,
      captureExpected,
      evidence: evidenceState({
        hasValue: Boolean(effectiveValue),
        references,
        manualCount: manualEvidence.length,
        captureExpected,
      }),
      observation: attribute.observation ?? null,
      reasons: reasonsFor(attribute),
      issues: issuesByCode.get(attribute.attribute_code) ?? [],
    };
  });
  const visibleAttributes = views.filter((view) => {
    if (!matchesSearch(attributeSearch, [view.name, view.code, view.effectiveValue ?? '', view.aiValue ?? '']))
      return false;
    const filled = Boolean(view.effectiveValue);
    const candidate = view.candidateLabel !== null;
    const requiredPending = view.required && !filled;
    if (attributeFilter === 'filled') return filled;
    if (attributeFilter === 'candidates') return candidate;
    if (attributeFilter === 'required') return requiredPending;
    if (attributeFilter === 'not_applicable') return !view.applicable;
    return filled || candidate || requiredPending;
  });
  const attributeCounts = {
    total: views.length,
    missing: views.filter((view) => view.required && !view.effectiveValue).length,
    check: views.filter((view) => view.evidence === 'check' || view.evidence === 'missing').length,
    edited: views.filter((view) => view.override).length,
  };
  const sheetIndex = visibleAttributes.findIndex((view) => view.code === sheetCode);
  const sheetAttribute = views.find((view) => view.code === sheetCode) ?? null;
  const openAttribute = (code: string, edit = false) => {
    setSheetEdit(edit);
    setSheetCode(code);
  };
  const attributeName = (code: string) => views.find((view) => view.code === code)?.name ?? code;
  const issueGroups = groupIssues(issues.data ?? []);
  const errorCount = (issues.data ?? []).filter((issue) => issue.severity === 'ERROR').length;
  const warningCount = (issues.data ?? []).length - errorCount;
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
      <Tabs value={tab} onValueChange={setTab}>
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
          <Card className="gap-0 overflow-hidden py-0">
            <CardHeader className="gap-4 border-b py-5">
              <div className="space-y-1.5">
                <CardTitle aria-level={2} role="heading">
                  {t('product:attributes.title')}
                </CardTitle>
                <p className="max-w-prose text-sm text-muted-foreground">{t('product:attributes.description')}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-full sm:w-64">
                  <Search aria-hidden className="absolute top-2 left-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    aria-label={t('product:attributes.search')}
                    className="pl-9"
                    placeholder={t('product:attributes.search')}
                    value={attributeSearch}
                    onChange={(event) => setAttributeSearch(event.target.value)}
                  />
                </div>
                <Select value={attributeFilter} onValueChange={(value) => setAttributeFilter(value as AttributeFilter)}>
                  <SelectTrigger className="w-full sm:w-56" aria-label={t('product:attributes.filterLabel')}>
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
                {attributeCounts.total ? (
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground lg:ml-auto">
                    <span className="tabular-nums">
                      {t('product:attributes.summary.total', { count: attributeCounts.total })}
                    </span>
                    {attributeCounts.missing ? (
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        <AlertCircle aria-hidden className="h-3.5 w-3.5 text-destructive" />
                        {t('product:attributes.summary.missing', { count: attributeCounts.missing })}
                      </span>
                    ) : null}
                    {attributeCounts.check ? (
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        <TriangleAlert aria-hidden className="h-3.5 w-3.5 text-warning" />
                        {t('product:attributes.summary.check', { count: attributeCounts.check })}
                      </span>
                    ) : null}
                    {attributeCounts.edited ? (
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        <PencilLine aria-hidden className="h-3.5 w-3.5 text-info" />
                        {t('product:attributes.summary.edited', { count: attributeCounts.edited })}
                      </span>
                    ) : null}
                  </p>
                ) : null}
              </div>
            </CardHeader>
            {attributes.loading && !attributes.data ? (
              <Skeleton className="m-6 h-60" />
            ) : !attributes.data?.length ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>{t('product:attributes.empty.title')}</EmptyTitle>
                  <EmptyDescription>{t('product:attributes.empty.description')}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : !visibleAttributes.length ? (
              <p className="px-6 py-5 text-sm text-muted-foreground">{t('product:attributes.noMatches')}</p>
            ) : (
              <>
                <ul aria-label={t('product:attributes.title')} className="divide-y lg:hidden">
                  {visibleAttributes.map((view) => (
                    <li className="relative space-y-2 px-4 py-3 hover:bg-muted/50 md:px-6" key={`mobile-${view.code}`}>
                      <button
                        className="text-left font-medium after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
                        type="button"
                        onClick={() => openAttribute(view.code)}
                      >
                        {view.name}
                      </button>
                      <p className={view.effectiveValue ? 'text-sm' : 'text-sm text-muted-foreground'}>
                        {view.effectiveValue ||
                          (view.candidateOnly
                            ? t('product:attributes.notPublished')
                            : t('product:attributes.notFound'))}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <AttributeTags attribute={view} />
                        <EvidenceTag attribute={view} />
                        {view.override ? (
                          <ToneBadge icon={PencilLine} tone="info">
                            {t('product:attributes.edited')}
                          </ToneBadge>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>

                <div className="hidden lg:block">
                  <Table className="table-fixed [&_td]:whitespace-normal">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[27%] pl-6">{t('product:attributes.table.attribute')}</TableHead>
                        <TableHead className="w-[29%]">{t('product:attributes.effectiveValue')}</TableHead>
                        <TableHead className="w-[17%]">{t('product:attributes.table.evidence')}</TableHead>
                        <TableHead className="w-[11%] text-right">{t('product:attributes.confidence')}</TableHead>
                        <TableHead className="w-[16%] pr-6 pl-6">{t('product:attributes.table.origin')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleAttributes.map((view) => (
                        <TableRow className="relative cursor-pointer hover:bg-muted/50" key={view.code}>
                          <TableCell className="pl-6 align-top">
                            {/* the name opens the attribute's review; its hit area covers the whole row */}
                            <button
                              className="text-left font-medium after:absolute after:inset-0 hover:text-primary hover:underline focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
                              type="button"
                              onClick={() => openAttribute(view.code)}
                            >
                              {view.name}
                            </button>
                            <div className="mt-1 flex flex-wrap gap-1">
                              <AttributeTags attribute={view} />
                            </div>
                            {view.issues.length ? (
                              <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                                <AlertCircle aria-hidden className="h-3.5 w-3.5 text-destructive" />
                                {t('product:attributes.checksFailed', { count: view.issues.length })}
                              </p>
                            ) : null}
                          </TableCell>
                          <TableCell className="align-top">
                            <p className={`break-words ${view.effectiveValue ? '' : 'text-muted-foreground'}`}>
                              {view.effectiveValue ||
                                (view.candidateOnly
                                  ? t('product:attributes.notPublished')
                                  : t('product:attributes.notFound'))}
                            </p>
                            {view.candidateOnly ? (
                              <p className="mt-1 text-xs text-muted-foreground">
                                {t('product:attributes.candidateValue', { value: view.aiValue })}
                              </p>
                            ) : view.override && view.aiValue && view.aiValue !== view.effectiveValue ? (
                              <p className="mt-1 text-xs text-muted-foreground">
                                {t('product:attributes.wasValue', { value: view.aiValue })}
                              </p>
                            ) : null}
                          </TableCell>
                          <TableCell className="align-top">
                            <div className="flex flex-wrap items-center gap-1">
                              <EvidenceTag attribute={view} />
                            </div>
                            {view.manualEvidence.length ? (
                              <p className="mt-1 text-xs text-muted-foreground">
                                {t('product:audit.manualCount', { count: view.manualEvidence.length })}
                              </p>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-right align-top tabular-nums">
                            {view.override ? (
                              <span className="text-muted-foreground">{t('product:attributes.curated')}</span>
                            ) : view.aiValue ? (
                              formatPercent(view.confidence)
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="pr-6 pl-6 align-top">
                            {view.override ? (
                              <>
                                <ToneBadge icon={PencilLine} tone="info">
                                  {t('product:attributes.edited')}
                                </ToneBadge>
                                <p
                                  className="mt-1 truncate text-xs text-muted-foreground"
                                  title={view.override.created_by}
                                >
                                  {view.override.created_by}
                                </p>
                              </>
                            ) : (
                              <span className="text-sm text-muted-foreground">{t('product:attributes.agent')}</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </Card>
        </TabsContent>
        <TabsContent value="evidence">
          <Card className="gap-0 overflow-hidden py-0">
            <CardHeader className="border-b py-5">
              <CardTitle aria-level={2} role="heading">
                {t('product:evidence.title')}
              </CardTitle>
              <p className="text-sm text-muted-foreground">{t('product:evidence.description')}</p>
            </CardHeader>
            {facts.loading && !facts.data ? (
              <Skeleton className="m-6 h-64" />
            ) : !facts.data?.length ? (
              <p className="px-6 py-5 text-sm text-muted-foreground">{t('product:evidence.empty')}</p>
            ) : (
              <ul className="divide-y">
                {facts.data.map((fact) => {
                  const evidence = parseJson<EvidenceItem[]>(fact.evidence_json, []);
                  return (
                    <li
                      className="grid gap-3 px-6 py-4 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] md:gap-8"
                      key={fact.fact_name}
                    >
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground">{fact.fact_name}</p>
                        <p className="font-medium break-words">{fact.normalized_value ?? fact.fact_value}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                          {t('product:evidence.confidence', { value: formatPercent(fact.confidence) })}
                        </p>
                      </div>
                      <ul className="min-w-0 space-y-2">
                        {evidence.map((item) => (
                          <li key={`${fact.fact_name}-${item.url}`}>
                            <a
                              className="inline-flex max-w-full items-center gap-1 text-sm font-medium [overflow-wrap:anywhere] text-primary underline-offset-4 hover:underline"
                              href={item.url}
                              rel="noreferrer"
                              target="_blank"
                            >
                              {item.source_title || hostname(item.url) || item.url}
                              <ExternalLink aria-hidden className="h-3 w-3 shrink-0" />
                            </a>
                            {item.excerpt ? (
                              <p className="mt-0.5 text-sm text-muted-foreground">“{item.excerpt}”</p>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </TabsContent>
        <TabsContent value="issues">
          <Card className="gap-0 overflow-hidden py-0">
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0 border-b py-5">
              <div className="space-y-1.5">
                <CardTitle aria-level={2} role="heading">
                  {t('product:issues.title')}
                </CardTitle>
                <p className="text-sm text-muted-foreground">{t('product:issues.description')}</p>
              </div>
              {issues.data?.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {errorCount ? (
                    <ToneBadge icon={AlertCircle} tone="danger">
                      {t('product:issues.errors', { count: errorCount })}
                    </ToneBadge>
                  ) : null}
                  {warningCount ? (
                    <ToneBadge icon={TriangleAlert} tone="warning">
                      {t('product:issues.warnings', { count: warningCount })}
                    </ToneBadge>
                  ) : null}
                </div>
              ) : null}
            </CardHeader>
            {issues.loading && !issues.data ? (
              <Skeleton className="m-6 h-48" />
            ) : !issues.data?.length ? (
              <div className="flex items-start gap-3 px-6 py-5">
                <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                <div>
                  <p className="text-sm font-medium">{t('product:issues.none.title')}</p>
                  <p className="text-sm text-muted-foreground">{t('product:issues.none.description')}</p>
                </div>
              </div>
            ) : (
              <ul className="divide-y">
                {issueGroups.map((group) => {
                  const error = group.severity === 'ERROR';
                  const Icon = error ? AlertCircle : TriangleAlert;
                  return (
                    <li className="flex gap-3 px-6 py-4" key={group.key}>
                      <Icon
                        aria-hidden
                        className={`mt-0.5 h-4 w-4 shrink-0 ${error ? 'text-destructive' : 'text-warning'}`}
                      />
                      <div className="min-w-0 flex-1 space-y-2">
                        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                          <span className="font-medium" title={group.code}>
                            {issueTitle(group.code)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {error ? t('product:issues.error') : t('product:issues.warning')}
                            {group.issues.length > 1
                              ? ` · ${t('product:issues.places', { count: group.issues.length })}`
                              : ''}
                          </span>
                        </p>
                        {group.issues.length === 1 ? (
                          <p className="text-sm text-muted-foreground">{issueMessage(group.issues[0])}</p>
                        ) : null}
                        <div className="flex flex-wrap gap-1.5">
                          {group.issues.map((issue, index) => {
                            const code = attributeCodeOf(issue.field);
                            return code ? (
                              <Button
                                className="h-7 px-2 text-xs"
                                key={`${code}-${index}`}
                                size="sm"
                                title={issueMessage(issue)}
                                variant="outline"
                                onClick={() => openAttribute(code)}
                              >
                                {attributeName(code)}
                              </Button>
                            ) : issue.field ? (
                              <Badge key={`${issue.field}-${index}`} title={issueMessage(issue)} variant="outline">
                                {fieldLabel(issue.field)}
                              </Badge>
                            ) : null;
                          })}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </TabsContent>
        <TabsContent value="review" className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
          <Card className="gap-0 overflow-hidden py-0">
            <CardHeader className="border-b py-5">
              <CardTitle aria-level={2} role="heading">
                {t('product:review.title')}
              </CardTitle>
              <p className="text-sm text-muted-foreground">{t('product:review.description')}</p>
            </CardHeader>
            {!reviewLoaded ? (
              <Skeleton className="m-6 h-56" />
            ) : (
              <>
                <CardContent className="space-y-5 py-5">
                  {isStaleDecision(reviewState.review) && reviewState.review ? (
                    <Alert>
                      <AlertDescription>
                        {t('product:review.staleDecision', {
                          status: t(`common:status.${reviewState.review.status}`),
                        })}
                      </AlertDescription>
                    </Alert>
                  ) : null}
                  {errorCount || warningCount || attributeCounts.missing ? (
                    <div className="flex flex-wrap items-center gap-3 rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning">
                      <TriangleAlert aria-hidden className="h-4 w-4 shrink-0" />
                      <p className="min-w-0 flex-1">
                        {t('product:review.readiness.open', {
                          errors: errorCount,
                          warnings: warningCount,
                          missing: attributeCounts.missing,
                        })}
                      </p>
                      <Button className="bg-background" size="sm" variant="outline" onClick={() => setTab('issues')}>
                        {t('product:review.readiness.see')}
                      </Button>
                    </div>
                  ) : (
                    <p className="flex items-center gap-2 rounded-lg bg-success-soft px-4 py-3 text-sm text-success">
                      <CircleCheck aria-hidden className="h-4 w-4 shrink-0" />
                      {t('product:review.readiness.clean')}
                    </p>
                  )}
                  <fieldset className="space-y-2">
                    <legend className="mb-2 text-sm font-medium">{t('product:review.status')}</legend>
                    <RadioGroup
                      className="grid gap-2 sm:grid-cols-2"
                      value={reviewStatus}
                      onValueChange={(value) => {
                        setReviewStatus(value as Review['status']);
                        setReviewSaved(false);
                      }}
                    >
                      {DECISIONS.map(({ status, icon: Icon, tone }) => (
                        <Label
                          className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal transition-colors hover:bg-muted/50 ${
                            reviewStatus === status ? 'border-ring ring-1 ring-ring' : ''
                          }`}
                          htmlFor={`decision-${status}`}
                          key={status}
                        >
                          <RadioGroupItem className="mt-0.5" id={`decision-${status}`} value={status} />
                          <span className="min-w-0 space-y-0.5">
                            <span className="flex items-center gap-1.5 text-sm font-medium">
                              {Icon ? <Icon aria-hidden className={`h-4 w-4 ${tone}`} /> : null}
                              {t(`common:status.${status}`)}
                            </span>
                            <span className="block text-xs leading-5 text-muted-foreground">
                              {t(`product:review.options.${status}`)}
                            </span>
                          </span>
                        </Label>
                      ))}
                    </RadioGroup>
                  </fieldset>
                  <div className="space-y-1.5">
                    <Label htmlFor="assignee">{t('product:review.assignee')}</Label>
                    <Input
                      id="assignee"
                      placeholder={t('product:review.assigneePlaceholder')}
                      value={assignee}
                      onChange={(event) => {
                        setAssignee(event.target.value);
                        setReviewSaved(false);
                      }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="notes">{t('product:review.notes')}</Label>
                    <Textarea
                      id="notes"
                      placeholder={t('product:review.notesPlaceholder')}
                      rows={4}
                      value={notes}
                      onChange={(event) => {
                        setNotes(event.target.value);
                        setReviewSaved(false);
                      }}
                    />
                  </div>
                  {decisionError ? (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{decisionError}</AlertDescription>
                    </Alert>
                  ) : null}
                </CardContent>
                <div className="flex flex-wrap items-center gap-3 border-t bg-muted/30 px-6 py-3">
                  <p className="min-w-0 flex-1 basis-48 text-xs text-muted-foreground" role="status">
                    {reviewSaved ? (
                      <span className="flex items-center gap-1.5 text-sm text-foreground">
                        <CheckCircle2 aria-hidden className="h-4 w-4 text-success" />
                        {t('product:review.saved')}
                      </span>
                    ) : nextProduct ? (
                      t('product:queue.afterDecision')
                    ) : null}
                  </p>
                  <Button disabled={savingReview} onClick={() => void saveReview()}>
                    <Save aria-hidden className="mr-2 h-4 w-4" />
                    {savingReview ? t('common:actions.saving') : t('product:review.save')}
                  </Button>
                </div>
              </>
            )}
          </Card>
          <Card className="gap-0 overflow-hidden py-0">
            <CardHeader className="border-b py-5">
              <CardTitle aria-level={2} role="heading">
                {t('product:history.title')}
              </CardTitle>
            </CardHeader>
            {!reviewState.events.length ? (
              <p className="px-6 py-5 text-sm text-muted-foreground">{t('product:history.empty')}</p>
            ) : (
              <ol className="max-h-[42rem] divide-y overflow-y-auto">
                {reviewState.events.map((event) => (
                  <li className="space-y-1 px-6 py-4" key={event.id}>
                    <p className="text-sm font-medium">
                      {AUDIT_EVENTS.has(event.event_type)
                        ? t(`product:history.events.${event.event_type}`)
                        : event.event_type}
                    </p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {formatDate(event.created_at)} · {event.actor}
                    </p>
                    {event.after_value ? (
                      <p className="text-sm break-words">
                        <span className="text-muted-foreground">
                          {event.field_key && attributeCodeOf(event.field_key)
                            ? attributeName(attributeCodeOf(event.field_key) ?? '')
                            : fieldLabel(event.field_key)}
                          :
                        </span>{' '}
                        {historyValue(t, event)}
                      </p>
                    ) : null}
                    {event.event_type === 'REVIEW_REOPENED' ? (
                      <p className="text-xs text-muted-foreground">{t('product:history.reopenedReason')}</p>
                    ) : event.reason ? (
                      <p className="text-xs break-words whitespace-pre-line text-foreground/80">“{event.reason}”</p>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      <AttributeSheet
        attribute={sheetAttribute}
        editRequested={sheetEdit}
        open={sheetAttribute !== null}
        position={sheetIndex >= 0 ? { index: sheetIndex, count: visibleAttributes.length } : undefined}
        removingOverride={removingOverrideCode === sheetCode}
        onAddEvidence={
          sheetAttribute ? (draft) => addEvidence(sheetAttribute.code, sheetAttribute.name, draft) : undefined
        }
        onNext={
          sheetIndex >= 0 && sheetIndex < visibleAttributes.length - 1
            ? () => openAttribute(visibleAttributes[sheetIndex + 1].code)
            : undefined
        }
        onOpenChange={(open) => {
          if (!open) setSheetCode(null);
        }}
        onPrevious={sheetIndex > 0 ? () => openAttribute(visibleAttributes[sheetIndex - 1].code) : undefined}
        onRemoveEvidence={sheetAttribute ? (id) => removeEvidence(sheetAttribute.code, id) : undefined}
        onRemoveOverride={sheetAttribute?.override ? () => removeOverride(sheetAttribute.code) : undefined}
        onSaveEdit={
          sheetAttribute
            ? (value, reason, draft) => saveOverride(sheetAttribute.code, sheetAttribute.name, value, reason, draft)
            : undefined
        }
      />
    </div>
  );
}
