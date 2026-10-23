import { Popover, PopoverContent, PopoverTrigger } from '@databricks/appkit-ui/react';
import { Info } from 'lucide-react';
import { useTranslation } from '../i18n/react';

// Mirrors quality_score in src/brickfill/quality.py; change both together.
const WEIGHTS = [
  { key: 'required', weight: 35 },
  { key: 'published', weight: 25 },
  { key: 'sources', weight: 20 },
  { key: 'confidence', weight: 20 },
] as const;

/** Info button that explains the quality score and the required coverage, next to wherever they are shown. */
export function QualityInfo({ averaged = false }: { averaged?: boolean }) {
  const { t } = useTranslation();
  return (
    <Popover>
      <PopoverTrigger asChild>
        {/* -my-0.5: a 20px button in a 16px line, so the value next to it stays aligned with its neighbors */}
        <button
          aria-label={t('common:qualityInfo.label')}
          className="touch-target -my-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          type="button"
        >
          <Info aria-hidden className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="max-h-[var(--radix-popover-content-available-height)] w-80 space-y-2.5 overflow-y-auto text-xs leading-snug"
        collisionPadding={12}
      >
        <p className="text-sm font-semibold leading-snug">{t('common:qualityInfo.title')}</p>
        <p className="leading-snug text-muted-foreground">{t('common:qualityInfo.intro')}</p>
        <ul className="space-y-1">
          {WEIGHTS.map(({ key, weight }) => (
            <li className="flex gap-2" key={key}>
              <span className="w-8 shrink-0 font-semibold tabular-nums text-foreground">{weight}%</span>
              <span>{t(`common:qualityInfo.weights.${key}`)}</span>
            </li>
          ))}
        </ul>
        <p className="leading-snug text-muted-foreground">{t('common:qualityInfo.penalties')}</p>
        <p className="leading-snug text-muted-foreground">{t('common:qualityInfo.coverage')}</p>
        {averaged ? <p className="leading-snug text-muted-foreground">{t('common:qualityInfo.averaged')}</p> : null}
      </PopoverContent>
    </Popover>
  );
}
