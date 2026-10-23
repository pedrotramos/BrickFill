import type { ReactNode } from 'react';
import { Badge } from '@databricks/appkit-ui/react';
import { CircleCheck, CircleDashed, CircleX, Eye, Sparkles, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useTranslation } from '../i18n/react';

/** Status tones of index.css. The action blue (primary) is kept for actions, so no status is drawn in it. */
export type Tone = 'neutral' | 'quiet' | 'info' | 'success' | 'warning' | 'danger';

const TONE_CLASSES: Record<Tone, string> = {
  neutral: '',
  quiet: 'border-transparent bg-secondary text-secondary-foreground',
  info: 'border-transparent bg-info-soft text-info',
  success: 'border-transparent bg-success-soft text-success',
  warning: 'border-transparent bg-warning-soft text-warning',
  danger: 'border-transparent bg-danger-soft text-destructive',
};

/** A badge in one of the status tones, with its icon: color is never the only cue. */
export function ToneBadge({
  tone,
  icon: Icon,
  className = '',
  title,
  children,
}: {
  tone: Tone;
  icon?: LucideIcon;
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <Badge className={`${TONE_CLASSES[tone]} ${className}`.trim()} title={title} variant="outline">
      {Icon ? <Icon aria-hidden /> : null}
      {children}
    </Badge>
  );
}

/** Enrichment status (pipeline) and review decision: each state has its own tone and icon. */
const STATUSES: Record<string, { tone: Tone; icon: LucideIcon }> = {
  PENDING: { tone: 'neutral', icon: CircleDashed },
  ENRICHED: { tone: 'info', icon: Sparkles },
  REVIEW_REQUIRED: { tone: 'warning', icon: TriangleAlert },
  IN_REVIEW: { tone: 'quiet', icon: Eye },
  APPROVED: { tone: 'success', icon: CircleCheck },
  REJECTED: { tone: 'danger', icon: CircleX },
};

export function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const known = STATUSES[status];
  return (
    <ToneBadge icon={known?.icon} tone={known?.tone ?? 'neutral'}>
      {known ? t(`common:status.${status}`) : status}
    </ToneBadge>
  );
}
