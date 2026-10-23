import type { ReactNode } from 'react';
import { Button } from '@databricks/appkit-ui/react';
import { RefreshCw } from 'lucide-react';

/** Page title and one-line description, with the page's actions on the title row (they wrap below on phones). */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
      <div className="min-w-0">
        <h1 className="text-[1.375rem] leading-7 font-semibold">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** The one refresh control of every page: an outline icon button, spinning while it reloads. */
export function RefreshButton({ label, busy, onClick }: { label: string; busy?: boolean; onClick: () => void }) {
  return (
    <Button aria-label={label} disabled={busy} size="icon" title={label} variant="outline" onClick={onClick}>
      <RefreshCw aria-hidden className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
    </Button>
  );
}
