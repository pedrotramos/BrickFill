import { useEffect, useId, useMemo } from 'react';
import { Button, Input, Label, Textarea } from '@databricks/appkit-ui/react';
import { ImagePlus, X } from 'lucide-react';
import { useTranslation } from '../i18n/react';
import { ACCEPTED_IMAGE_TYPES, type ManualEvidenceDraft, draftProblem } from '../lib/manual-evidence';

interface ManualEvidenceFormProps {
  value: ManualEvidenceDraft;
  onChange: (value: ManualEvidenceDraft) => void;
  /** Shown above the fields, e.g. why the evidence is required. */
  description?: string;
}

/** Source URL + excerpt and/or a screenshot (file picker or Ctrl+V), with a local preview before upload. */
export function ManualEvidenceForm({ value, onChange, description }: ManualEvidenceFormProps) {
  const { t } = useTranslation();
  const id = useId();
  const preview = useMemo(() => (value.file ? URL.createObjectURL(value.file) : null), [value.file]);
  const problem = draftProblem(value);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview]
  );

  const setFile = (file: File | null) => onChange({ ...value, file });

  return (
    <fieldset
      className="space-y-2 rounded-lg border p-3"
      onPaste={(event) => {
        const file = Array.from(event.clipboardData.files).find((item) => ACCEPTED_IMAGE_TYPES.includes(item.type));
        if (file) {
          event.preventDefault();
          setFile(file);
        }
      }}
    >
      <legend className="px-1 text-sm font-medium">{t('product:evidenceForm.legend')}</legend>
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      <Label htmlFor={`${id}-url`}>{t('product:evidenceForm.sourceUrl')}</Label>
      <Input
        id={`${id}-url`}
        inputMode="url"
        placeholder={t('product:evidenceForm.sourceUrlPlaceholder')}
        value={value.sourceUrl}
        onChange={(event) => onChange({ ...value, sourceUrl: event.target.value })}
      />
      <Label htmlFor={`${id}-excerpt`}>{t('product:evidenceForm.excerpt')}</Label>
      <Textarea
        id={`${id}-excerpt`}
        placeholder={t('product:evidenceForm.excerptPlaceholder')}
        value={value.excerpt}
        onChange={(event) => onChange({ ...value, excerpt: event.target.value })}
      />
      <Label htmlFor={`${id}-file`}>{t('product:evidenceForm.screenshot')}</Label>
      {preview ? (
        <div className="space-y-2">
          <img
            alt={t('product:evidenceForm.previewAlt')}
            className="max-h-48 w-full rounded-md border object-contain"
            src={preview}
          />
          <Button size="sm" type="button" variant="ghost" onClick={() => setFile(null)}>
            <X className="mr-1 h-4 w-4" />
            {t('product:evidenceForm.removeScreenshot')}
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <ImagePlus className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            accept={ACCEPTED_IMAGE_TYPES.join(',')}
            id={`${id}-file`}
            type="file"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t('product:evidenceForm.fileHint')}</p>
      <Label htmlFor={`${id}-note`}>{t('product:evidenceForm.note')}</Label>
      <Textarea
        id={`${id}-note`}
        placeholder={t('product:evidenceForm.notePlaceholder')}
        value={value.note}
        onChange={(event) => onChange({ ...value, note: event.target.value })}
      />
      {problem ? (
        <p className="text-xs text-muted-foreground" role="status">
          {t(problem)}
        </p>
      ) : null}
    </fieldset>
  );
}
