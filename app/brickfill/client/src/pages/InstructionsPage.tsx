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
import { AlertCircle, History, Lock, RotateCcw, Save } from 'lucide-react';
import { useTranslation } from '../i18n/react';
import { PageHeader, RefreshButton } from '../components/PageHeader';
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
    <div className="space-y-2 border-l-2 border-border pl-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{t('instructions:history.version', { version: item.version })}</span>
        {item.active ? <Badge>{t('instructions:history.active')}</Badge> : null}
        {item.restoredFrom ? (
          <Badge variant="outline">{t('instructions:history.restoredFrom', { version: item.restoredFrom })}</Badge>
        ) : null}
        <span className="text-xs text-muted-foreground">
          {item.createdBy} · {formatDate(item.createdAt)}
        </span>
      </div>
      {item.reason ? <p className="text-xs text-muted-foreground">{item.reason}</p> : null}
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-xs">
        {item.body || t('instructions:history.emptyBody')}
      </pre>
      {canRestore && !item.active ? (
        <Button disabled={busy} size="sm" variant="outline" onClick={() => onRestore(item)}>
          <RotateCcw className="mr-1 h-3.5 w-3.5" />
          {t('instructions:history.restore')}
        </Button>
      ) : null}
    </div>
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
    <div className="mx-auto w-full max-w-5xl space-y-6">
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
        <Skeleton className="h-80" />
      ) : state ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle aria-level={2} role="heading">
                {t('instructions:editor.title')}
              </CardTitle>
              <CardDescription>{t('instructions:editor.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="instructions-body">{t('instructions:editor.label')}</Label>
                <Textarea
                  disabled={!state.canEdit || busy}
                  id="instructions-body"
                  placeholder={t('instructions:editor.placeholder')}
                  rows={12}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                />
                <p className={`text-xs ${tooLong ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {t('instructions:editor.count', { count: draft.length, max: maxLength })}
                </p>
              </div>
              {state.canEdit ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="instructions-reason">{t('settings:reason')}</Label>
                    <Input
                      id="instructions-reason"
                      maxLength={2000}
                      placeholder={t('settings:reasonPlaceholder')}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      disabled={busy || !changed || tooLong}
                      onClick={() =>
                        void run(() =>
                          saveInstructions({ body: draft, expectedVersion, reason: reason.trim() || undefined })
                        )
                      }
                    >
                      <Save className="mr-2 h-4 w-4" />
                      {busy ? t('common:actions.saving') : t('instructions:editor.save')}
                    </Button>
                    {saved ? <span className="text-sm text-muted-foreground">{t('instructions:saved')}</span> : null}
                  </div>
                </>
              ) : null}
              <p className="text-xs text-muted-foreground">{t('instructions:editor.guard')}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle aria-level={2} className="flex items-center gap-2" role="heading">
                <History aria-hidden className="h-4 w-4" />
                {t('instructions:history.title')}
              </CardTitle>
              <CardDescription>{t('instructions:history.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!state.versions.length ? (
                <p className="text-sm text-muted-foreground">{t('instructions:history.empty')}</p>
              ) : (
                state.versions.map((item) => (
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
                ))
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
