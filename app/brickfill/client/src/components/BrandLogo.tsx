import { cn } from '../lib/utils';

/**
 * The BrickFill mark: three brick courses filled from the bottom up (the catalog gaining content).
 * The empty courses follow the text color and the filled ones use --brand-fill, so it works on both themes.
 */
export function BrandMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      aria-hidden={title ? undefined : true}
      className={cn('h-8 w-8 shrink-0', className)}
      fill="none"
      role={title ? 'img' : undefined}
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
    >
      {title ? <title>{title}</title> : null}
      <rect fill="currentColor" fillOpacity="0.18" height="12" rx="3" width="44" x="10" y="10" />
      <rect fill="currentColor" fillOpacity="0.18" height="12" rx="3" width="44" x="10" y="26" />
      <rect fill="var(--brand-fill)" height="12" rx="3" width="28" x="10" y="26" />
      <rect fill="var(--brand-fill)" height="12" rx="3" width="44" x="10" y="42" />
    </svg>
  );
}

/** Wordmark: "BrickFill" in extra bold, in the text color; inherits the page font. */
export function BrandWordmark({ className }: { className?: string }) {
  return <span className={cn('text-lg leading-none font-extrabold tracking-tight', className)}>BrickFill</span>;
}

export function BrandLogo({ className, markClassName }: { className?: string; markClassName?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <BrandMark className={markClassName} />
      <BrandWordmark />
    </span>
  );
}
