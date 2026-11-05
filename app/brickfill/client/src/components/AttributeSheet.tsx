import { useEffect, useState, type ReactNode } from 'react';
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
  Input,
  Label,
  ScrollArea,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Spinner,
  Textarea,
} from '@databricks/appkit-ui/react';
import {
  AlertCircle,
  Asterisk,
  BadgeCheck,
  Camera,
  CameraOff,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileCheck2,
  Image as ImageIcon,
  Info,
  Pencil,
  PencilLine,
  Plus,
  RotateCcw,
  Save,
  ShieldAlert,
  Trash2,
  TriangleAlert,
  UserCheck,
} from 'lucide-react';
import { useTranslation } from '../i18n/react';
import { formatDate, formatPercent } from '../lib/formatters';
import { captureReasonKey, evidenceFileUrl, hostname, type EvidenceState } from '../lib/evidence';
import { issueMessage, issueTitle, type IssueRow } from '../lib/issues';
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
  capture_code?: string | null;
  /** 1 = the most reputable source of the attribute (set by the job since reference captures). */
  source_rank?: number | null;
  /** The one capture shown for the value. */
  is_reference?: boolean | null;
}

export interface HumanOverride {
  value: string;
  reason: string;
  created_by: string;
  created_at: string;
}

/** Everything the review shows about one attribute of the product. */
export interface AttributeView {
  code: string;
  name: string;
  required: boolean;
  applicable: boolean;
  /** The agent found a value but could not publish it (no evidence, conflict, out of vocabulary). */
  candidateOnly: boolean;
  candidateLabel: string | null;
  aiValue: string | null;
  effectiveValue: string | null;
  confidence: number | string | null | undefined;
  override?: HumanOverride;
  /** Sources that back the value, most reputable first. */
  references: EvidenceReference[];
  /** The source whose crop is the value's reference capture, if any could show it. */
  reference: EvidenceReference | null;
  manualEvidence: ManualEvidence[];
  captureExpected: boolean;
  evidence: EvidenceState;
  observation: string | null;
  reasons: string[];
  issues: IssueRow[];
}

const SOURCE_TIERS = new Set(['official', 'authorized_distributor', 'recognized_retailer', 'other']);

/** The backing of a value as one tag: on the page, to check, by text, none. */
export function EvidenceTag({
  attribute,
}: {
  attribute: Pick<AttributeView, 'evidence' | 'references' | 'reference'>;
}) {
  const { t } = useTranslation();
  switch (attribute.evidence) {
    case 'captured': {
      const host = attribute.reference ? hostname(attribute.reference.url) : null;
      return (
        <span title={host ? t('product:evidenceState.capturedFrom', { host }) : undefined}>
          <ToneBadge icon={Camera} tone="success">
            {t('product:evidenceState.captured')}
          </ToneBadge>
        </span>
      );
    }
    case 'check':
      return (
        <ToneBadge icon={TriangleAlert} tone="warning">
          {t('product:evidenceState.check')}
        </ToneBadge>
      );
    case 'text':
      return (
        <ToneBadge icon={FileCheck2} tone="neutral">
          {t('product:audit.references', { count: attribute.references.length })}
        </ToneBadge>
      );
    case 'missing':
      return (
        <ToneBadge icon={ShieldAlert} tone="danger">
          {t('product:audit.noReference')}
        </ToneBadge>
      );
    default:
      return <span className="text-sm text-muted-foreground">—</span>;
  }
}

/** The tags beside an attribute's name: required, not applicable, why a candidate was not published. */
export function AttributeTags({ attribute }: { attribute: AttributeView }) {
  const { t } = useTranslation();
  return (
    <>
      {attribute.required ? (
        <ToneBadge icon={Asterisk} tone="quiet">
          {t('product:attributes.required')}
        </ToneBadge>
      ) : null}
      {!attribute.applicable ? <Badge variant="outline">{t('product:attributes.notApplicable')}</Badge> : null}
      {attribute.candidateLabel ? (
        <ToneBadge
          icon={attribute.candidateOnly ? TriangleAlert : undefined}
          tone={attribute.candidateOnly ? 'warning' : 'quiet'}
        >
          {attribute.candidateLabel}
        </ToneBadge>
      ) : null}
    </>
  );
}

function TierBadge({ tier }: { tier?: string | null }) {
  const { t } = useTranslation();
  if (!tier) return null;
  return (
    <ToneBadge icon={tier === 'official' ? BadgeCheck : undefined} tone={tier === 'official' ? 'success' : 'neutral'}>
      {SOURCE_TIERS.has(tier) ? t(`product:audit.sourceTier.${tier}`) : tier}
    </ToneBadge>
  );
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
      <p className="flex items-center gap-2 bg-muted/40 px-4 py-3 text-sm text-muted-foreground" role="alert">
        <ImageIcon aria-hidden className="h-4 w-4 shrink-0" />
        {t(`product:audit.image.${kind}.failed`)}
      </p>
    );
  }
  return (
    <a className="block bg-muted/40" href={url(path)} rel="noreferrer" target="_blank">
      {!loaded ? (
        <span className="block px-4 py-3 text-sm text-muted-foreground" role="status">
          {t(`product:audit.image.${kind}.loading`)}
        </span>
      ) : null}
      <img
        alt={t(`product:audit.image.${kind}.alt`, { attribute: attributeName })}
        className={`max-h-80 w-full object-contain ${loaded ? '' : 'h-0'}`}
        loading="lazy"
        src={url(path)}
        onError={() => setFailed(true)}
        onLoad={() => setLoaded(true)}
      />
    </a>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * The review of one attribute, in a side sheet: what the agent proposed and what is published, the checks it
 * failed, the one reference capture of the value (from its most reputable source that could show it), every source
 * that backs the value, the reviewer's own evidence, and the edit of the value with its evidence.
 * One sheet for the whole list: ‹ › walk through the attributes without closing it.
 */
export function AttributeSheet({
  attribute,
  open,
  onOpenChange,
  editRequested,
  position,
  onPrevious,
  onNext,
  onSaveEdit,
  onRemoveOverride,
  removingOverride = false,
  onAddEvidence,
  onRemoveEvidence,
}: {
  attribute: AttributeView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Open straight into editing (the row's Edit action). */
  editRequested?: boolean;
  position?: { index: number; count: number };
  onPrevious?: () => void;
  onNext?: () => void;
  /** These resolve to the error message to show in the sheet, or null when they succeeded. */
  onSaveEdit?: (value: string, reason: string, evidence: ManualEvidenceDraft) => Promise<string | null>;
  onRemoveOverride?: () => Promise<string | null>;
  removingOverride?: boolean;
  onAddEvidence?: (draft: ManualEvidenceDraft) => Promise<string | null>;
  onRemoveEvidence?: (id: number) => Promise<string | null>;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [editEvidence, setEditEvidence] = useState<ManualEvidenceDraft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ManualEvidenceDraft | null>(null);
  const [savingEvidence, setSavingEvidence] = useState(false);
  const [removingEvidence, setRemovingEvidence] = useState<number | null>(null);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const code = attribute?.code;
  const startEditing = () => {
    setValue(attribute?.effectiveValue ?? attribute?.aiValue ?? '');
    setReason('');
    setEditEvidence(emptyDraft);
    setEditError(null);
    setEditing(true);
  };
  // a new attribute (or reopening) starts from its own state, never from the previous one's draft
  useEffect(() => {
    setDraft(null);
    setEvidenceError(null);
    setEditError(null);
    if (open && editRequested && attribute) startEditing();
    else setEditing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when the attribute or the request changes
  }, [code, open, editRequested]);

  if (!attribute) return null;
  const notFound = t('product:attributes.notFound');
  const canSave =
    !saving && Boolean(value.trim()) && reason.trim().length >= 3 && !draftProblem(editEvidence) && Boolean(onSaveEdit);

  const save = async () => {
    if (!canSave || !onSaveEdit) return;
    setSaving(true);
    setEditError(null);
    try {
      const error = await onSaveEdit(value.trim(), reason.trim(), editEvidence);
      setEditError(error);
      if (!error) setEditing(false);
    } finally {
      setSaving(false);
    }
  };
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
  const restore = async () => {
    if (!onRemoveOverride) return;
    setRestoreError(null);
    const error = await onRemoveOverride();
    setRestoreError(error);
    if (!error) setRestoreOpen(false);
  };
  const reasonText = (source: EvidenceReference) => {
    const key = captureReasonKey(source);
    return key ? t(`product:audit.reason.${key}`) : '';
  };
  const reference = attribute.reference;
  const best = attribute.references[0];
  const referenceIndex = reference ? attribute.references.indexOf(reference) : -1;
  // an edited value is shown by the reviewer's own capture; so is an AI value no source could show
  const manualReference =
    attribute.override || !reference ? (attribute.manualEvidence.find((item) => item.screenshot_path) ?? null) : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-2xl">
        <SheetHeader className="space-y-3 border-b p-6 pr-12">
          {position && position.count > 1 ? (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Button
                aria-label={t('product:audit.previous')}
                className="size-7"
                disabled={!onPrevious || editing}
                size="icon"
                title={t('product:audit.previous')}
                variant="ghost"
                onClick={onPrevious}
              >
                <ChevronLeft aria-hidden className="h-4 w-4" />
              </Button>
              <Button
                aria-label={t('product:audit.next')}
                className="size-7"
                disabled={!onNext || editing}
                size="icon"
                title={t('product:audit.next')}
                variant="ghost"
                onClick={onNext}
              >
                <ChevronRight aria-hidden className="h-4 w-4" />
              </Button>
              <span className="ml-1 tabular-nums">
                {t('product:audit.position', { index: position.index + 1, count: position.count })}
              </span>
            </div>
          ) : null}
          <SheetTitle className="text-xl leading-7 break-words">{attribute.name}</SheetTitle>
          <div className="flex flex-wrap items-center gap-1.5">
            <AttributeTags attribute={attribute} />
            {attribute.evidence !== 'none' ? <EvidenceTag attribute={attribute} /> : null}
            {attribute.override ? (
              <ToneBadge icon={PencilLine} tone="info">
                {t('product:audit.humanOverride')}
              </ToneBadge>
            ) : null}
          </div>
          <SheetDescription className="sr-only">{t('product:audit.description')}</SheetDescription>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-8 p-6">
            {attribute.issues.length ? (
              <ul aria-label={t('product:audit.checks')} className="divide-y rounded-lg border">
                {attribute.issues.map((issue, index) => (
                  <li className="flex gap-3 px-4 py-3" key={`${issue.issue_code}-${index}`}>
                    {issue.severity === 'ERROR' ? (
                      <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    ) : (
                      <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                    )}
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-sm font-medium">{issueTitle(issue.issue_code)}</p>
                      <p className="text-sm text-muted-foreground">{issueMessage(issue)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}

            <Section
              action={
                !editing && onSaveEdit ? (
                  <Button size="sm" variant="outline" onClick={startEditing}>
                    <Pencil aria-hidden className="mr-1 h-3.5 w-3.5" />
                    {t('product:audit.editValue')}
                  </Button>
                ) : null
              }
              title={t('product:audit.value')}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1 rounded-lg border p-4">
                  <p className="text-xs text-muted-foreground">
                    {attribute.candidateOnly ? t('product:audit.candidateFound') : t('product:audit.aiValue')}
                  </p>
                  <p
                    className={`text-base font-semibold break-words ${attribute.aiValue ? '' : 'text-muted-foreground'}`}
                  >
                    {attribute.aiValue || notFound}
                  </p>
                  {attribute.aiValue ? (
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {t('product:audit.confidence', { value: formatPercent(attribute.confidence) })}
                    </p>
                  ) : null}
                </div>
                <div className={`space-y-1 rounded-lg p-4 ${attribute.override ? 'bg-info-soft/60' : 'border'}`}>
                  <p className="text-xs text-muted-foreground">{t('product:audit.published')}</p>
                  <p
                    className={`text-base font-semibold break-words ${attribute.effectiveValue ? '' : 'text-muted-foreground'}`}
                  >
                    {attribute.effectiveValue || t('product:attributes.notPublished')}
                  </p>
                  {attribute.override ? (
                    <p className="text-xs text-muted-foreground">
                      {t('product:audit.editedBy', {
                        actor: attribute.override.created_by,
                        date: formatDate(attribute.override.created_at),
                      })}
                    </p>
                  ) : null}
                </div>
              </div>
              {attribute.override && !editing ? (
                <div className="space-y-3 rounded-lg bg-muted/50 p-4">
                  <p className="text-sm">
                    <span className="font-medium">{t('product:audit.reasonLabel')}</span> {attribute.override.reason}
                  </p>
                  <p className="text-xs leading-5 text-muted-foreground">{t('product:audit.overrideNote')}</p>
                  {onRemoveOverride ? (
                    <AlertDialog
                      open={restoreOpen}
                      onOpenChange={(next) => {
                        setRestoreOpen(next);
                        if (next) setRestoreError(null);
                      }}
                    >
                      <AlertDialogTrigger asChild>
                        <Button className="bg-background" disabled={removingOverride} size="sm" variant="outline">
                          <RotateCcw aria-hidden className="mr-1 h-4 w-4" />
                          {t('product:audit.removeEdit')}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t('product:audit.restoreDialog.title')}</AlertDialogTitle>
                          <AlertDialogDescription>
                            {t('product:audit.restoreDialog.description', {
                              edited: attribute.override.value,
                              original: attribute.aiValue || notFound,
                            })}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        {restoreError ? (
                          <p className="text-sm text-destructive" role="alert">
                            {restoreError}
                          </p>
                        ) : null}
                        <AlertDialogFooter>
                          <AlertDialogCancel disabled={removingOverride}>
                            {t('common:actions.cancel')}
                          </AlertDialogCancel>
                          <AlertDialogAction asChild>
                            <Button
                              disabled={removingOverride}
                              variant="destructive"
                              onClick={(event) => {
                                event.preventDefault();
                                void restore();
                              }}
                            >
                              {removingOverride ? (
                                <Spinner className="mr-2" />
                              ) : (
                                <RotateCcw aria-hidden className="mr-1 h-4 w-4" />
                              )}
                              {removingOverride
                                ? t('product:audit.restoreDialog.restoring')
                                : t('product:audit.restoreDialog.confirm')}
                            </Button>
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : null}
                </div>
              ) : null}

              {editing ? (
                <div className="space-y-5 rounded-lg border p-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="attribute-new-value">{t('product:attributes.edit.newValue')}</Label>
                    <Input
                      autoFocus
                      id="attribute-new-value"
                      value={value}
                      onChange={(event) => setValue(event.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="attribute-reason">{t('product:attributes.edit.reason')}</Label>
                    <Textarea
                      id="attribute-reason"
                      placeholder={t('product:attributes.edit.reasonPlaceholder')}
                      rows={2}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                    />
                  </div>
                  <div className="space-y-3 border-t pt-4">
                    <h4 className="text-sm font-semibold">{t('product:evidenceForm.legend')}</h4>
                    <ManualEvidenceForm
                      description={t('product:attributes.edit.evidenceRequired')}
                      value={editEvidence}
                      onChange={setEditEvidence}
                    />
                  </div>
                </div>
              ) : null}
            </Section>

            {!editing ? (
              <>
                <Section title={t('product:audit.referenceCapture.title')}>
                  {manualReference?.screenshot_path ? (
                    <figure className="overflow-hidden rounded-lg border">
                      <EvidenceImage
                        attributeName={attribute.name}
                        key={manualReference.screenshot_path}
                        kind="manual"
                        path={manualReference.screenshot_path}
                        url={manualEvidenceFileUrl}
                      />
                      <figcaption className="space-y-2 border-t p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <ToneBadge icon={UserCheck} tone="info">
                            {t('product:audit.manual.badge')}
                          </ToneBadge>
                          <span className="text-xs text-muted-foreground">
                            {manualReference.created_by} · {formatDate(manualReference.created_at)}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {attribute.override
                            ? t('product:audit.referenceCapture.manualForEdit')
                            : t('product:audit.referenceCapture.manualForAi')}
                        </p>
                      </figcaption>
                    </figure>
                  ) : reference?.crop_path ? (
                    <figure className="overflow-hidden rounded-lg border">
                      <EvidenceImage
                        attributeName={attribute.name}
                        key={reference.crop_path}
                        path={reference.crop_path}
                      />
                      <figcaption className="space-y-2 border-t p-4">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <TierBadge tier={reference.source_tier} />
                          <span className="text-xs text-muted-foreground">
                            {hostname(reference.url) ?? t('product:audit.externalReference')}
                          </span>
                        </div>
                        <p className="text-sm font-medium leading-6">{reference.source_title || attribute.name}</p>
                        {best && best !== reference ? (
                          <p className="flex gap-2 text-xs leading-5 text-muted-foreground">
                            <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            {t('product:audit.referenceCapture.fallback', {
                              host: hostname(best.url) ?? t('product:audit.externalReference'),
                              reason: reasonText(best),
                            })}
                          </p>
                        ) : null}
                        <div className="flex flex-wrap items-center gap-x-1 gap-y-1 pt-1 text-xs text-muted-foreground">
                          <Button asChild className="-ml-2.5" size="sm" variant="ghost">
                            <a href={reference.url} rel="noreferrer" target="_blank">
                              {t('product:audit.openPage')}
                              <ExternalLink aria-hidden className="ml-1 h-3.5 w-3.5" />
                            </a>
                          </Button>
                          {reference.screenshot_path ? (
                            <Button asChild size="sm" variant="ghost">
                              <a href={evidenceFileUrl(reference.screenshot_path)} rel="noreferrer" target="_blank">
                                {t('product:audit.openScreenshot')}
                                <ExternalLink aria-hidden className="ml-1 h-3.5 w-3.5" />
                              </a>
                            </Button>
                          ) : null}
                          {reference.captured_at ? (
                            <span className="ml-auto tabular-nums">
                              {t('product:audit.capturedAt', { date: formatDate(reference.captured_at) })}
                            </span>
                          ) : null}
                        </div>
                      </figcaption>
                    </figure>
                  ) : attribute.references.length ? (
                    <div className="space-y-3 rounded-lg border border-dashed p-4">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        <CameraOff aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                        {t('product:audit.referenceCapture.none')}
                      </p>
                      <p className="text-sm leading-6 text-muted-foreground">
                        {attribute.captureExpected && best
                          ? t('product:audit.referenceCapture.noneReason', {
                              host: hostname(best.url) ?? t('product:audit.externalReference'),
                              reason: reasonText(best),
                            })
                          : t('product:audit.referenceCapture.legacy')}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {onAddEvidence ? (
                          <Button size="sm" variant="outline" onClick={() => setDraft(draft ?? emptyDraft)}>
                            <Plus aria-hidden className="mr-1 h-4 w-4" />
                            {t('product:audit.referenceCapture.attach')}
                          </Button>
                        ) : null}
                        {best?.screenshot_path ? (
                          <Button asChild size="sm" variant="ghost">
                            <a href={evidenceFileUrl(best.screenshot_path)} rel="noreferrer" target="_blank">
                              {t('product:audit.referenceCapture.openPageCapture', {
                                host: hostname(best.url) ?? t('product:audit.externalReference'),
                              })}
                              <ExternalLink aria-hidden className="ml-1 h-3.5 w-3.5" />
                            </a>
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <p className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
                      {t('product:audit.noUrls')}
                    </p>
                  )}
                </Section>

                {attribute.references.length ? (
                  <Section
                    action={
                      <span className="text-xs text-muted-foreground tabular-nums">{attribute.references.length}</span>
                    }
                    title={t('product:audit.sources.title')}
                  >
                    <p className="-mt-1 text-sm text-muted-foreground">{t('product:audit.sources.description')}</p>
                    <ol className="divide-y rounded-lg border">
                      {attribute.references.map((source, index) => {
                        const isReference = source === reference && !manualReference;
                        const failed = attribute.captureExpected && (referenceIndex < 0 || index < referenceIndex);
                        const host = hostname(source.url) ?? t('product:audit.externalReference');
                        return (
                          <li className="space-y-1.5 p-4" key={source.evidence_id ?? `${source.url}-${index}`}>
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                <span className="w-4 text-xs text-muted-foreground tabular-nums">{index + 1}</span>
                                <TierBadge tier={source.source_tier} />
                                <a
                                  className="inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
                                  href={source.url}
                                  rel="noreferrer"
                                  target="_blank"
                                >
                                  <span className="truncate">{host}</span>
                                  <ExternalLink aria-hidden className="h-3 w-3 shrink-0" />
                                </a>
                              </div>
                              {isReference ? (
                                <ToneBadge icon={Camera} tone="success">
                                  {t('product:audit.sources.reference')}
                                </ToneBadge>
                              ) : null}
                            </div>
                            {source.source_title ? (
                              <p className="pl-5.5 text-sm font-medium leading-6 break-words">{source.source_title}</p>
                            ) : null}
                            <div className="space-y-1.5 pl-5.5">
                              {source.fact_value ? (
                                <p className="text-sm text-muted-foreground">
                                  {t('product:audit.sourceValue', { value: source.fact_value })}
                                </p>
                              ) : null}
                              {source.excerpt ? (
                                <blockquote
                                  className="line-clamp-2 text-sm leading-6 text-foreground/80"
                                  title={source.excerpt}
                                >
                                  “{source.excerpt}”
                                </blockquote>
                              ) : null}
                              {failed && captureReasonKey(source) ? (
                                <p className="text-xs text-muted-foreground">
                                  {t('product:audit.sources.notCaptured', { reason: reasonText(source) })}
                                </p>
                              ) : null}
                              {failed && source.capture_error ? (
                                <details className="text-xs text-muted-foreground">
                                  <summary className="cursor-pointer select-none hover:text-foreground">
                                    {t('product:audit.sources.technical')}
                                  </summary>
                                  <p className="mt-1 font-mono break-words">{source.capture_error}</p>
                                </details>
                              ) : null}
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  </Section>
                ) : null}

                <Section
                  action={
                    onAddEvidence && !draft ? (
                      <Button size="sm" variant="outline" onClick={() => setDraft(emptyDraft)}>
                        <Plus aria-hidden className="mr-1 h-4 w-4" />
                        {t('product:audit.manual.add')}
                      </Button>
                    ) : null
                  }
                  title={t('product:audit.manual.title')}
                >
                  <p className="-mt-1 text-sm text-muted-foreground">
                    {attribute.override ? t('product:audit.manual.forEdit') : t('product:audit.manual.forAi')}
                  </p>
                  {attribute.manualEvidence.length ? (
                    <ul className="space-y-3">
                      {attribute.manualEvidence.map((item) => (
                        <li className="overflow-hidden rounded-lg border" key={item.id}>
                          {item.screenshot_path && item !== manualReference ? (
                            <EvidenceImage
                              attributeName={attribute.name}
                              kind="manual"
                              path={item.screenshot_path}
                              url={manualEvidenceFileUrl}
                            />
                          ) : null}
                          <div
                            className={`space-y-2 p-4 ${item.screenshot_path && item !== manualReference ? 'border-t' : ''}`}
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <ToneBadge icon={UserCheck} tone="info">
                                {t('product:audit.manual.badge')}
                              </ToneBadge>
                              {item === manualReference ? (
                                <ToneBadge icon={Camera} tone="success">
                                  {t('product:audit.sources.reference')}
                                </ToneBadge>
                              ) : null}
                              <span className="text-xs text-muted-foreground">
                                {item.created_by} · {formatDate(item.created_at)}
                              </span>
                            </div>
                            {item.excerpt ? (
                              <blockquote className="text-sm leading-6 text-foreground/80">“{item.excerpt}”</blockquote>
                            ) : null}
                            {item.note ? <p className="text-sm text-muted-foreground">{item.note}</p> : null}
                            <div className="flex flex-wrap gap-1 pt-1">
                              {item.source_url ? (
                                <Button asChild className="-ml-2.5" size="sm" variant="ghost">
                                  <a href={item.source_url} rel="noreferrer" target="_blank">
                                    {hostname(item.source_url) ?? t('product:audit.externalReference')}
                                    <ExternalLink aria-hidden className="ml-1 h-3.5 w-3.5" />
                                  </a>
                                </Button>
                              ) : null}
                              {onRemoveEvidence ? (
                                <Button
                                  className="hover:text-destructive"
                                  disabled={removingEvidence === item.id}
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => void removeEvidence(item.id)}
                                >
                                  {removingEvidence === item.id ? (
                                    <Spinner className="mr-2" />
                                  ) : (
                                    <Trash2 aria-hidden className="mr-1 h-4 w-4" />
                                  )}
                                  {t('common:actions.remove')}
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : !draft ? (
                    <p className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
                      {t('product:audit.manual.none')}
                    </p>
                  ) : null}
                  {evidenceError ? (
                    <p className="text-sm text-destructive" role="alert">
                      {evidenceError}
                    </p>
                  ) : null}
                  {draft ? (
                    <div className="space-y-4 rounded-lg border p-4">
                      <ManualEvidenceForm value={draft} onChange={setDraft} />
                      <div className="flex justify-end gap-2 border-t pt-4">
                        <Button
                          disabled={savingEvidence}
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setDraft(null);
                            setEvidenceError(null);
                          }}
                        >
                          {t('common:actions.cancel')}
                        </Button>
                        <Button
                          disabled={savingEvidence || Boolean(draftProblem(draft))}
                          size="sm"
                          onClick={() => void saveEvidence()}
                        >
                          {savingEvidence ? <Spinner className="mr-2" /> : null}
                          {t('product:audit.manual.save')}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </Section>

                {attribute.observation || attribute.reasons.length ? (
                  <Section title={t('product:audit.researchNote')}>
                    <div className="space-y-2 rounded-lg bg-muted/50 p-4">
                      {attribute.reasons.map((item) => (
                        <p className="text-sm leading-6" key={item}>
                          {item}
                        </p>
                      ))}
                      {attribute.observation && !attribute.reasons.includes(attribute.observation) ? (
                        <p className="text-sm leading-6 text-muted-foreground">{attribute.observation}</p>
                      ) : null}
                    </div>
                  </Section>
                ) : null}
              </>
            ) : null}
          </div>
        </ScrollArea>

        {editing ? (
          <div className="flex flex-wrap items-center gap-3 border-t bg-background px-6 py-3">
            {editError ? (
              <p className="w-full text-sm text-destructive" role="alert">
                {editError}
              </p>
            ) : null}
            <p className="min-w-0 flex-1 text-xs text-muted-foreground">{t('product:audit.editNote')}</p>
            <Button disabled={saving} variant="outline" onClick={() => setEditing(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button disabled={!canSave} onClick={() => void save()}>
              {saving ? <Spinner className="mr-2" /> : <Save aria-hidden className="mr-2 h-4 w-4" />}
              {t('product:audit.saveEdit')}
            </Button>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
