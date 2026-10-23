import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Badge,
  Button,
  ScrollArea,
  Separator,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Spinner,
} from '@databricks/appkit-ui/react';
import {
  BadgeCheck,
  Camera,
  ChevronRight,
  ExternalLink,
  FileCheck2,
  PencilLine,
  Plus,
  RotateCcw,
  ShieldAlert,
  Trash2,
  TriangleAlert,
  UserCheck,
} from 'lucide-react';
import { useTranslation } from '../i18n/react';
import { formatDate } from '../lib/formatters';
import { evidenceFileUrl, hostname } from '../lib/evidence';
import {
  type ManualEvidence,
  type ManualEvidenceDraft,
  draftProblem,
  emptyDraft,
  manualEvidenceFileUrl,
} from '../lib/manual-evidence';
import { ManualEvidenceForm } from './ManualEvidenceForm';
import { ToneBadge } from './StatusBadge';

export interface EvidenceReference {
  url: string;
  source_title?: string;
  source_tier?: string;
  excerpt?: string;
  evidence_id?: string;
  fact_name?: string;
  fact_value?: string;
  captured_at?: string | null;
  screenshot_path?: string | null;
  crop_path?: string | null;
  capture_status?: string;
  capture_error?: string | null;
}

interface HumanOverride {
  value: string;
  reason: string;
  created_by: string;
  created_at: string;
}

interface AttributeAuditProps {
  attributeName: string;
  aiValue: string | null | undefined;
  observation: string | null | undefined;
  references: EvidenceReference[];
  override?: HumanOverride;
  /** The actions below resolve to the error message to show in the panel, or null when they succeeded. */
  onRemoveOverride?: () => Promise<string | null>;
  removingOverride?: boolean;
  candidateOnly?: boolean;
  captureExpected?: boolean;
  /** Localized reasons of the attribute state (rejection / applicability codes), shown with the research note. */
  reasons?: string[];
  /** Evidence reviewers attached to the current value (the edit, or the AI value when not edited). */
  manualEvidence?: ManualEvidence[];
  onAddEvidence?: (draft: ManualEvidenceDraft) => Promise<string | null>;
  onRemoveEvidence?: (id: number) => Promise<string | null>;
}

function EvidenceImage({
  path,
  attributeName,
  kind = 'crop',
  url = evidenceFileUrl,
}: {
  path: string;
  attributeName: string;
  kind?: 'crop' | 'page' | 'manual';
  url?: (path: string) => string;
}) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <p role="alert" className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
        {t(`product:audit.image.${kind}.failed`)}
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {!loaded ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t(`product:audit.image.${kind}.loading`)}
        </p>
      ) : null}
      <a href={url(path)} rel="noreferrer" target="_blank">
        <img
          alt={t(`product:audit.image.${kind}.alt`, { attribute: attributeName })}
          className="max-h-96 w-full rounded-lg border bg-background object-contain"
          loading="lazy"
          src={url(path)}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      </a>
    </div>
  );
}

const SOURCE_TIERS = new Set(['official', 'authorized_distributor', 'recognized_retailer', 'other']);

/** Why a value has no crop (capture_status written by the enrichment job); translated under product:audit.capture. */
const CAPTURE_STATUSES = new Set([
  'NOT_VISIBLE',
  'NO_MATCH',
  'AMBIGUOUS',
  'SCREENSHOT_ONLY',
  'UNSUPPORTED',
  'NOT_CAPTURED',
  'FAILED',
]);

export function AttributeAudit({
  attributeName,
  aiValue,
  observation,
  references,
  override,
  onRemoveOverride,
  removingOverride = false,
  candidateOnly = false,
  captureExpected = false,
  manualEvidence = [],
  reasons = [],
  onAddEvidence,
  onRemoveEvidence,
}: AttributeAuditProps) {
  const { t } = useTranslation();
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [draft, setDraft] = useState<ManualEvidenceDraft | null>(null);
  const [savingEvidence, setSavingEvidence] = useState(false);
  const [removingEvidence, setRemovingEvidence] = useState<number | null>(null);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const hasUnsupportedValue = Boolean(aiValue) && references.length === 0 && manualEvidence.length === 0;

  const saveEvidence = async () => {
    if (!draft || !onAddEvidence || draftProblem(draft)) return;
    setSavingEvidence(true);
    setEvidenceError(null);
    try {
      const error = await onAddEvidence(draft);
      setEvidenceError(error);
      if (!error) setDraft(null);
    } finally {
      setSavingEvidence(false);
    }
  };
  const removeEvidence = async (id: number) => {
    if (!onRemoveEvidence) return;
    setRemovingEvidence(id);
    setEvidenceError(null);
    try {
      setEvidenceError(await onRemoveEvidence(id));
    } finally {
      setRemovingEvidence(null);
    }
  };

  const referenceBadge = references.length ? (
    <Badge variant="outline">
      <FileCheck2 className="mr-1 h-3 w-3" />
      {t('product:audit.references', { count: references.length })}
    </Badge>
  ) : (
    <ToneBadge icon={ShieldAlert} tone={hasUnsupportedValue ? 'danger' : 'quiet'}>
      {hasUnsupportedValue ? t('product:audit.noReference') : t('product:attributes.notFound')}
    </ToneBadge>
  );
  const captureLabel = (reference: EvidenceReference) => {
    if (reference.capture_status === 'COMPLETE') return t('product:audit.capture.COMPLETE');
    if (!reference.capture_status && !captureExpected) return t('product:audit.capture.LEGACY');
    return CAPTURE_STATUSES.has(reference.capture_status ?? '')
      ? t(`product:audit.capture.${reference.capture_status}`)
      : t('product:audit.capture.INCOMPLETE');
  };
  const notFound = t('product:attributes.notFound');

  const removeOverride = async () => {
    if (!onRemoveOverride) return;
    setOverrideError(null);
    const error = await onRemoveOverride();
    setOverrideError(error);
    if (!error) setRemoveDialogOpen(false);
  };

  return (
    <Sheet>
      <div className="flex min-w-52 flex-wrap items-center gap-2">
        {referenceBadge}
        {manualEvidence.length ? (
          <Badge variant="outline">
            <UserCheck className="mr-1 h-3 w-3" />
            {t('product:audit.manualCount', { count: manualEvidence.length })}
          </Badge>
        ) : null}
        <SheetTrigger asChild>
          <Button size="sm" variant="ghost">
            {t('product:audit.open')}
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </SheetTrigger>
      </div>

      <SheetContent className="w-full gap-0 sm:max-w-xl">
        <SheetHeader className="border-b p-6 pr-12">
          <div className="flex flex-wrap items-center gap-2">
            {referenceBadge}
            {override ? (
              <ToneBadge icon={PencilLine} tone="info">
                {t('product:audit.humanOverride')}
              </ToneBadge>
            ) : null}
          </div>
          <SheetTitle className="text-xl">{t('product:audit.title', { attribute: attributeName })}</SheetTitle>
          <SheetDescription>{t('product:audit.description')}</SheetDescription>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-6 p-6">
            <section
              className="space-y-2"
              aria-label={candidateOnly ? t('product:audit.candidateFound') : t('product:audit.aiValue')}
            >
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {candidateOnly ? t('product:audit.candidateFound') : t('product:audit.aiValue')}
              </p>
              <p className="text-lg font-semibold">{aiValue || notFound}</p>
            </section>

            {override ? (
              <section className="space-y-3 rounded-lg bg-muted/50 p-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t('product:audit.curatedValue')}
                  </p>
                  <p className="mt-1 font-semibold">{override.value}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    {override.created_by} · {formatDate(override.created_at)}
                  </p>
                  <p className="mt-2 text-sm">
                    <span className="font-medium">{t('product:audit.reasonLabel')}</span> {override.reason}
                  </p>
                </div>
                <p className="text-xs leading-5 text-muted-foreground">{t('product:audit.overrideNote')}</p>
                {onRemoveOverride ? (
                  <AlertDialog
                    open={removeDialogOpen}
                    onOpenChange={(open) => {
                      setRemoveDialogOpen(open);
                      if (open) setOverrideError(null);
                    }}
                  >
                    <AlertDialogTrigger asChild>
                      <Button disabled={removingOverride} size="sm" variant="outline">
                        <RotateCcw className="mr-1 h-4 w-4" />
                        {t('product:audit.removeEdit')}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t('product:audit.restoreDialog.title')}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {t('product:audit.restoreDialog.description', {
                            edited: override.value,
                            original: aiValue || notFound,
                          })}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      {overrideError ? (
                        <p className="text-sm text-destructive" role="alert">
                          {overrideError}
                        </p>
                      ) : null}
                      <AlertDialogFooter>
                        <AlertDialogCancel disabled={removingOverride}>{t('common:actions.cancel')}</AlertDialogCancel>
                        <AlertDialogAction asChild>
                          <Button
                            disabled={removingOverride}
                            variant="destructive"
                            onClick={(event) => {
                              event.preventDefault();
                              void removeOverride();
                            }}
                          >
                            {removingOverride ? <Spinner className="mr-2" /> : <RotateCcw className="mr-1 h-4 w-4" />}
                            {removingOverride
                              ? t('product:audit.restoreDialog.restoring')
                              : t('product:audit.restoreDialog.confirm')}
                          </Button>
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                ) : null}
              </section>
            ) : null}

            <Separator />

            <section aria-label={t('product:audit.sources.title')}>
              <div className="mb-4">
                <h3 className="font-semibold">{t('product:audit.sources.title')}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{t('product:audit.sources.description')}</p>
              </div>

              {references.length ? (
                <div className="space-y-5">
                  {references.map((reference, index) => (
                    <div className="space-y-3" key={reference.evidence_id ?? `${reference.url}-${index}`}>
                      {index ? <Separator /> : null}
                      <div className="flex flex-wrap items-center gap-2">
                        {reference.source_tier ? (
                          <ToneBadge
                            icon={reference.source_tier === 'official' ? BadgeCheck : undefined}
                            tone={reference.source_tier === 'official' ? 'success' : 'neutral'}
                          >
                            {SOURCE_TIERS.has(reference.source_tier)
                              ? t(`product:audit.sourceTier.${reference.source_tier}`)
                              : reference.source_tier}
                          </ToneBadge>
                        ) : null}
                        <span className="text-xs text-muted-foreground">
                          {hostname(reference.url) ?? t('product:audit.externalReference')}
                        </span>
                      </div>
                      <p className="font-medium leading-6">{reference.source_title || attributeName}</p>
                      {/* a missing crop is something to check, not a failure: the text evidence is kept */}
                      {reference.capture_status === 'COMPLETE' ? (
                        <ToneBadge icon={Camera} tone="success">
                          {captureLabel(reference)}
                        </ToneBadge>
                      ) : reference.capture_status || captureExpected ? (
                        <ToneBadge icon={TriangleAlert} tone="warning">
                          {captureLabel(reference)}
                        </ToneBadge>
                      ) : (
                        <ToneBadge tone="quiet">{captureLabel(reference)}</ToneBadge>
                      )}
                      {reference.captured_at ? (
                        <p className="text-xs text-muted-foreground">
                          {t('product:audit.capturedAt', { date: formatDate(reference.captured_at) })}
                        </p>
                      ) : null}
                      {reference.fact_value ? (
                        <p className="text-sm text-muted-foreground">
                          {t('product:audit.sourceValue', { value: reference.fact_value })}
                        </p>
                      ) : null}
                      {reference.excerpt ? (
                        <blockquote className="text-sm leading-6 text-muted-foreground">
                          “{reference.excerpt}”
                        </blockquote>
                      ) : (
                        <p className="text-sm leading-6 text-muted-foreground">{t('product:audit.noExcerpt')}</p>
                      )}
                      {reference.crop_path ? (
                        <EvidenceImage
                          key={reference.crop_path}
                          attributeName={attributeName}
                          path={reference.crop_path}
                        />
                      ) : reference.screenshot_path ? (
                        <div className="space-y-2">
                          <p className="text-sm text-muted-foreground">{t('product:audit.noCropSeePage')}</p>
                          <EvidenceImage
                            key={reference.screenshot_path}
                            attributeName={attributeName}
                            kind="page"
                            path={reference.screenshot_path}
                          />
                        </div>
                      ) : reference.capture_status || captureExpected ? (
                        <p className="text-sm text-muted-foreground">{t('product:audit.noCropTextKept')}</p>
                      ) : null}
                      {reference.capture_error ? (
                        <p className="text-xs text-muted-foreground">
                          {t('product:audit.technicalDetail', { detail: reference.capture_error })}
                        </p>
                      ) : null}
                      {reference.screenshot_path ? (
                        <Button asChild size="sm" variant="outline">
                          <a href={evidenceFileUrl(reference.screenshot_path)} rel="noreferrer" target="_blank">
                            {t('product:audit.openScreenshot')}
                            <ExternalLink className="ml-1 h-3.5 w-3.5" />
                          </a>
                        </Button>
                      ) : null}
                      <Button asChild size="sm" variant="outline">
                        <a href={reference.url} rel="noreferrer" target="_blank">
                          {t('product:audit.openReference')}
                          <ExternalLink className="ml-1 h-3.5 w-3.5" />
                        </a>
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg bg-muted/50 p-4 text-sm leading-6 text-muted-foreground">
                  {t('product:audit.noUrls')}
                </div>
              )}
            </section>

            <Separator />

            <section aria-label={t('product:audit.manual.title')} className="space-y-4">
              <div>
                <h3 className="font-semibold">{t('product:audit.manual.title')}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {override ? t('product:audit.manual.forEdit') : t('product:audit.manual.forAi')}
                </p>
              </div>
              {manualEvidence.map((item) => (
                <div className="space-y-2 rounded-lg border p-3" key={item.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Badge variant="secondary">
                      <UserCheck className="mr-1 h-3 w-3" />
                      {t('product:audit.manual.badge')}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {item.created_by} · {formatDate(item.created_at)}
                    </span>
                  </div>
                  {item.excerpt ? (
                    <blockquote className="text-sm leading-6 text-muted-foreground">“{item.excerpt}”</blockquote>
                  ) : null}
                  {item.note ? <p className="text-sm">{item.note}</p> : null}
                  {item.screenshot_path ? (
                    <EvidenceImage
                      attributeName={attributeName}
                      kind="manual"
                      path={item.screenshot_path}
                      url={manualEvidenceFileUrl}
                    />
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    {item.source_url ? (
                      <Button asChild size="sm" variant="outline">
                        <a href={item.source_url} rel="noreferrer" target="_blank">
                          {hostname(item.source_url) ?? t('product:audit.externalReference')}
                          <ExternalLink className="ml-1 h-3.5 w-3.5" />
                        </a>
                      </Button>
                    ) : null}
                    {onRemoveEvidence ? (
                      <Button
                        disabled={removingEvidence === item.id}
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          void removeEvidence(item.id);
                        }}
                      >
                        {removingEvidence === item.id ? (
                          <Spinner className="mr-2" />
                        ) : (
                          <Trash2 className="mr-1 h-4 w-4" />
                        )}
                        {t('common:actions.remove')}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
              {evidenceError ? (
                <p className="text-sm text-destructive" role="alert">
                  {evidenceError}
                </p>
              ) : null}
              {!manualEvidence.length && !draft ? (
                <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                  {t('product:audit.manual.none')}
                </p>
              ) : null}
              {onAddEvidence ? (
                draft ? (
                  <div className="space-y-2">
                    <ManualEvidenceForm value={draft} onChange={setDraft} />
                    <div className="flex gap-2">
                      <Button
                        disabled={savingEvidence || Boolean(draftProblem(draft))}
                        size="sm"
                        onClick={() => {
                          void saveEvidence();
                        }}
                      >
                        {savingEvidence ? <Spinner className="mr-2" /> : null}
                        {t('product:audit.manual.save')}
                      </Button>
                      <Button
                        disabled={savingEvidence}
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setDraft(null);
                          setEvidenceError(null);
                        }}
                      >
                        {t('common:actions.cancel')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setDraft(emptyDraft)}>
                    <Plus className="mr-1 h-4 w-4" />
                    {t('product:audit.manual.add')}
                  </Button>
                )
              ) : null}
            </section>

            {observation || reasons.length ? (
              <section className="space-y-2 rounded-lg bg-muted/50 p-4">
                <h3 className="text-sm font-semibold">{t('product:audit.researchNote')}</h3>
                {reasons.map((reason) => (
                  <p className="text-sm leading-6" key={reason}>
                    {reason}
                  </p>
                ))}
                {observation && !reasons.includes(observation) ? (
                  <p className="text-sm leading-6 text-muted-foreground">{observation}</p>
                ) : null}
              </section>
            ) : null}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
