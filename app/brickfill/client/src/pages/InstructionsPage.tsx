import { useCallback, useEffect, useState } from 'react';
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
  Skeleton,
  Textarea,
} from '@databricks/appkit-ui/react';
import { AlertCircle, CircleCheck, CircleDot, Lock, RotateCcw, Save, ShieldCheck } from 'lucide-react';
import { useTranslation } from '../i18n/react';
import { PageHeader, RefreshButton } from '../components/PageHeader';
import { ToneBadge } from '../components/StatusBadge';
import { ApiError, errorText } from '../lib/api-errors';
import {
  loadInstructions,
  restoreInstructions,
  saveInstructions,
  type InstructionVersion,
  type InstructionsState,
} from '../lib/editors';
import { formatDate } from '../lib/formatters';

const isConflict = (error: unknown) =>
  error instanceof ApiError && (error.status === 409 || error.code === 'INSTRUCTIONS_VERSION_CONFLICT');

function VersionRow({
  item,
  canRestore,
  busy,
  onRestore,
}: {
  item: InstructionVersion;
  canRestore: boolean;
  busy: boolean;
  onRestore: (item: InstructionVersion) => void;
}) {
  const { t } = useTranslation();
  return (
    <li className="space-y-2 px-6 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium tabular-nums">
          {t('instructions:history.version', { version: item.version })}
        </span>
        {item.active ? (
          <ToneBadge icon={CircleCheck} tone="success">
            {t('instructions:history.active')}
          </ToneBadge>
        ) : null}
        {item.restoredFrom ? (
          <Badge variant="outline">{t('instructions:history.restoredFrom', { version: item.restoredFrom })}</Badge>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">
        {formatDate(item.createdAt)} · <span title={item.createdBy}>{item.createdBy}</span>
      </p>
      {item.reason ? <p className="text-xs text-foreground/80">“{item.reason}”</p> : null}
      <p className="line-clamp-6 rounded-md bg-muted/50 px-3 py-2 text-sm whitespace-pre-wrap break-words">
        {item.body || <span className="text-muted-foreground">{t('instructions:history.emptyBody')}</span>}
      </p>
      {canRestore && !item.active ? (
        <Button disabled={busy} size="sm" variant="outline" onClick={() => onRestore(item)}>
          <RotateCcw aria-hidden className="mr-1 h-3.5 w-3.5" />
          {t('instructions:history.restore')}
        </Button>
      ) : null}
    </li>
  );
}

/** The catalog team's additional instructions to the agent, versioned, after the fixed rules of the prompt. */
export function InstructionsPage() {
  const { t } = useTranslation();
  const [state, setState] = useState<InstructionsState | null>(null);
  const [draft, setDraft] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState(false);

  const reload = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const loaded = await loadInstructions(signal);
      if (signal?.aborted) return;
      setState(loaded);
      setDraft(loaded.active?.body ?? '');
      setConflict(false);
    } catch (caught) {
      if (!signal?.aborted) setError(errorText(caught, 'errors:INSTRUCTIONS_LOAD_FAILED'));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [reload]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await action();
      setReason('');
      setSaved(true);
      await reload();
    } catch (caught) {
      if (isConflict(caught)) setConflict(true);
      else setError(errorText(caught, 'errors:INSTRUCTIONS_SAVE_FAILED'));
    } finally {
      setBusy(false);
    }
  };

  const expectedVersion = state?.active?.version ?? 0;
  const maxLength = state?.maxLength ?? 4000;
  const changed = draft.trim() !== (state?.active?.body ?? '').trim();
  const tooLong = draft.length > maxLength;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <PageHeader
        actions={<RefreshButton busy={loading} label={t('instructions:reload')} onClick={() => void reload()} />}
        description={t('instructions:subtitle')}
        title={t('instructions:title')}
      />

      {conflict ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{t('errors:INSTRUCTIONS_VERSION_CONFLICT')}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            {t('instructions:conflict')}
            <Button size="sm" variant="outline" onClick={() => void reload()}>
              {t('common:actions.reload')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {state && !state.canEdit ? (
        <Alert>
          <Lock className="h-4 w-4" />
          <AlertTitle>{t('instructions:readOnly.title')}</AlertTitle>
          <AlertDescription>
            {state.editorsConfigured ? t('instructions:readOnly.description') : t('instructions:readOnly.noEditors')}
          </AlertDescription>
        </Alert>
      ) : null}

      {!state && loading ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <Skeleton className="h-96" />
          <Skeleton className="h-72" />
        </div>
      ) : state ? (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <Card className="gap-0 overflow-hidden py-0">
            <CardHeader className="py-5">
              <CardTitle aria-level={2} role="heading">
                {t('instructions:editor.title')}
              </CardTitle>
              <CardDescription className="max-w-prose">{t('instructions:editor.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 pb-5">
              <div className="flex items-baseline justify-between gap-3">
                <Label htmlFor="instructions-body">{t('instructions:editor.label')}</Label>
                <span
                  className={`text-xs tabular-nums ${tooLong ? 'text-destructive' : 'text-muted-foreground'}`}
                  id="instructions-count"
                >
                  {t('instructions:editor.count', { length: draft.length, max: maxLength })}
                </span>
              </div>
              <Textarea
                aria-describedby="instructions-count instructions-guard"
                aria-invalid={tooLong || undefined}
                className="min-h-72 leading-6"
                disabled={busy}
                id="instructions-body"
                readOnly={!state.canEdit}
                placeholder={t('instructions:editor.placeholder')}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
              <p className="flex items-start gap-2 text-xs text-muted-foreground" id="instructions-guard">
                <ShieldCheck aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {t('instructions:editor.guard')}
              </p>
            </CardContent>
            {state.canEdit ? (
              <div className="flex flex-wrap items-center gap-3 border-t bg-muted/30 px-6 py-3">
                <p aria-live="polite" className="flex min-w-0 flex-1 basis-48 items-center gap-2 text-sm">
                  {changed ? (
                    <>
                      <CircleDot aria-hidden className="h-4 w-4 shrink-0 text-warning" />
                      {t('instructions:editor.unsaved')}
                    </>
                  ) : saved ? (
                    <>
                      <CircleCheck aria-hidden className="h-4 w-4 shrink-0 text-success" />
                      <span className="text-muted-foreground">{t('instructions:saved')}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">{t('instructions:editor.noChanges')}</span>
                  )}
                </p>
                <Input
                  aria-label={t('settings:reason')}
                  className="w-full bg-background sm:w-64"
                  disabled={!changed}
                  maxLength={2000}
                  placeholder={t('settings:reasonPlaceholder')}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
                <Button
                  disabled={busy || !changed || tooLong}
                  onClick={() =>
                    void run(() =>
                      saveInstructions({ body: draft, expectedVersion, reason: reason.trim() || undefined })
                    )
                  }
                >
                  <Save aria-hidden className="mr-2 h-4 w-4" />
                  {busy ? t('common:actions.saving') : t('instructions:editor.save')}
                </Button>
              </div>
            ) : null}
          </Card>

          <Card className="gap-0 overflow-hidden py-0">
            <CardHeader className="border-b py-5">
              <CardTitle aria-level={2} role="heading">
                {t('instructions:history.title')}
              </CardTitle>
              <CardDescription>{t('instructions:history.description')}</CardDescription>
            </CardHeader>
            {!state.versions.length ? (
              <p className="px-6 py-5 text-sm text-muted-foreground">{t('instructions:history.empty')}</p>
            ) : (
              <ol className="max-h-[70vh] divide-y overflow-y-auto">
                {state.versions.map((item) => (
                  <VersionRow
                    busy={busy}
                    canRestore={state.canEdit}
                    item={item}
                    key={item.version}
                    onRestore={(version) =>
                      void run(() =>
                        restoreInstructions(version.version, { expectedVersion, reason: reason.trim() || undefined })
                      )
                    }
                  />
                ))}
              </ol>
            )}
          </Card>
        </div>
      ) : null}
    </div>
  );
}
