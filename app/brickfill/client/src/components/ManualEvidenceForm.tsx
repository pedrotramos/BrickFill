import { useEffect, useId, useMemo, useState, type DragEvent } from 'react';
import { Button, Input, Label, Textarea } from '@databricks/appkit-ui/react';
import { CircleCheck, CircleDashed, ImagePlus, X } from 'lucide-react';
import { useTranslation } from '../i18n/react';
import { formatNumber } from '../lib/formatters';
import { ACCEPTED_IMAGE_TYPES, type ManualEvidenceDraft, draftProblem } from '../lib/manual-evidence';

interface ManualEvidenceFormProps {
  value: ManualEvidenceDraft;
  onChange: (value: ManualEvidenceDraft) => void;
  /** Shown above the fields, e.g. why the evidence is required. */
  description?: string;
}

const imageOf = (files: FileList | null | undefined) =>
  Array.from(files ?? []).find((item) => ACCEPTED_IMAGE_TYPES.includes(item.type)) ??
  Array.from(files ?? [])[0] ??
  null;

/**
 * Evidence a reviewer attaches: a screenshot (dropped, pasted or chosen), or the source URL with the excerpt that
 * shows the value; either one is enough. The status line says, as the reviewer types, whether it is.
 */
export function ManualEvidenceForm({ value, onChange, description }: ManualEvidenceFormProps) {
  const { t } = useTranslation();
  const id = useId();
  const [dragging, setDragging] = useState(false);
  const preview = useMemo(() => (value.file ? URL.createObjectURL(value.file) : null), [value.file]);
  const problem = draftProblem(value);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview]
  );

  const setFile = (file: File | null) => onChange({ ...value, file });
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = imageOf(event.dataTransfer.files);
    if (file) setFile(file);
  };

  return (
    <div
      className="space-y-4"
      onPaste={(event) => {
        const file = Array.from(event.clipboardData.files).find((item) => ACCEPTED_IMAGE_TYPES.includes(item.type));
        if (file) {
          event.preventDefault();
          setFile(file);
        }
      }}
    >
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-file`}>{t('product:evidenceForm.screenshot')}</Label>
        {preview && value.file ? (
          <div className="overflow-hidden rounded-lg border">
            <img
              alt={t('product:evidenceForm.previewAlt')}
              className="max-h-56 w-full bg-muted/40 object-contain"
              src={preview}
            />
            <div className="flex items-center gap-3 border-t px-3 py-2">
              <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={value.file.name}>
                {value.file.name} ·{' '}
                {t('product:evidenceForm.size', { size: formatNumber(Math.ceil(value.file.size / 1024)) })}
              </p>
              <Button size="sm" type="button" variant="ghost" onClick={() => setFile(null)}>
                <X aria-hidden className="mr-1 h-4 w-4" />
                {t('product:evidenceForm.removeScreenshot')}
              </Button>
            </div>
          </div>
        ) : (
          <label
            className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-dashed px-4 py-5 text-center transition-colors focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 hover:bg-muted/50 ${
              dragging ? 'border-ring bg-accent' : 'border-input'
            }`}
            htmlFor={`${id}-file`}
            onDragLeave={() => setDragging(false)}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDrop={onDrop}
          >
            <ImagePlus aria-hidden className="h-5 w-5 text-muted-foreground" />
            <span className="text-sm font-medium">{t('product:evidenceForm.dropTitle')}</span>
            <span className="text-xs text-muted-foreground">{t('product:evidenceForm.fileHint')}</span>
            <input
              accept={ACCEPTED_IMAGE_TYPES.join(',')}
              className="sr-only"
              id={`${id}-file`}
              type="file"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
        )}
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground" role="separator">
        <span className="h-px flex-1 bg-border" />
        {t('product:evidenceForm.or')}
        <span className="h-px flex-1 bg-border" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-url`}>{t('product:evidenceForm.sourceUrl')}</Label>
        <Input
          id={`${id}-url`}
          inputMode="url"
          placeholder={t('product:evidenceForm.sourceUrlPlaceholder')}
          value={value.sourceUrl}
          onChange={(event) => onChange({ ...value, sourceUrl: event.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-excerpt`}>{t('product:evidenceForm.excerpt')}</Label>
        <Textarea
          id={`${id}-excerpt`}
          placeholder={t('product:evidenceForm.excerptPlaceholder')}
          rows={3}
          value={value.excerpt}
          onChange={(event) => onChange({ ...value, excerpt: event.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-note`}>{t('product:evidenceForm.note')}</Label>
        <Textarea
          id={`${id}-note`}
          placeholder={t('product:evidenceForm.notePlaceholder')}
          rows={2}
          value={value.note}
          onChange={(event) => onChange({ ...value, note: event.target.value })}
        />
      </div>

      <p aria-live="polite" className="flex items-start gap-2 text-sm" role="status">
        {problem ? (
          <>
            <CircleDashed aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-muted-foreground">{t(problem)}</span>
          </>
        ) : (
          <>
            <CircleCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            <span>{t('product:evidenceForm.ready')}</span>
          </>
        )}
      </p>
    </div>
  );
}
