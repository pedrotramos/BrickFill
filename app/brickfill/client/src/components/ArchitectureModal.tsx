import { useState, type ComponentType } from 'react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  ScrollArea,
} from '@databricks/appkit-ui/react';
import {
  AppWindow,
  ArrowRight,
  Bot,
  Camera,
  CheckCircle2,
  Code2,
  Crop,
  Database,
  FileOutput,
  FileSearch,
  Flame,
  Gauge,
  History,
  Layers,
  ListChecks,
  MousePointerClick,
  Network,
  PencilLine,
  Plug,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Table2,
  Workflow,
  Zap,
  type LucideProps,
} from 'lucide-react';
import { useTranslation } from '../i18n/react';
import { cn } from '../lib/utils';
import { BrandMark } from './BrandLogo';

/**
 * Databricks products used by BrickFill. Ids follow `system.billing.usage.billing_origin_product`, so the badges
 * match what FinOps sees in the billing tables; Unity Catalog and Volumes have no separate compute SKU.
 */
type SkuId = 'JOBS' | 'MODEL_SERVING' | 'LAKEBASE' | 'LAKEFLOW_CONNECT' | 'APPS' | 'UNITY_CATALOG' | 'VOLUMES';

interface Sku {
  id: SkuId;
  icon: ComponentType<LucideProps>;
  /** Shown as a code badge when it is a billing_origin_product value. */
  billingProduct?: string;
}

const SKUS: Sku[] = [
  { id: 'JOBS', icon: Workflow, billingProduct: 'JOBS' },
  { id: 'MODEL_SERVING', icon: Sparkles, billingProduct: 'MODEL_SERVING' },
  { id: 'LAKEBASE', icon: Database, billingProduct: 'LAKEBASE' },
  { id: 'LAKEFLOW_CONNECT', icon: Zap, billingProduct: 'LAKEFLOW_CONNECT / DLT' },
  { id: 'APPS', icon: AppWindow, billingProduct: 'APPS' },
  { id: 'UNITY_CATALOG', icon: ShieldCheck },
  { id: 'VOLUMES', icon: Layers },
];

type StageId = 'input' | 'research' | 'governance' | 'curation';
type NodeId =
  | 'source-contract'
  | 'settings'
  | 'daily-batch'
  | 'web-search'
  | 'firecrawl-capture'
  | 'foundation-model'
  | 'deterministic-rules'
  | 'history'
  | 'review-app'
  | 'decisions'
  | 'fast-reads'
  | 'publish';

interface ArchitectureNode {
  id: NodeId;
  icon: ComponentType<LucideProps>;
  skus: SkuId[];
  /** External partner that runs this step (shown with the partner style). */
  partner?: 'firecrawl';
}

interface ArchitectureStage {
  id: StageId;
  number: string;
  nodes: ArchitectureNode[];
}

const STAGES: ArchitectureStage[] = [
  {
    id: 'input',
    number: '01',
    nodes: [
      { id: 'source-contract', icon: Table2, skus: ['UNITY_CATALOG', 'JOBS'] },
      { id: 'settings', icon: SlidersHorizontal, skus: ['APPS', 'LAKEBASE'] },
      { id: 'daily-batch', icon: Layers, skus: ['JOBS'] },
    ],
  },
  {
    id: 'research',
    number: '02',
    nodes: [
      { id: 'web-search', icon: Search, skus: [], partner: 'firecrawl' },
      { id: 'firecrawl-capture', icon: FileSearch, skus: ['VOLUMES'], partner: 'firecrawl' },
      { id: 'foundation-model', icon: Sparkles, skus: ['MODEL_SERVING'] },
    ],
  },
  {
    id: 'governance',
    number: '03',
    nodes: [
      { id: 'deterministic-rules', icon: CheckCircle2, skus: ['JOBS'] },
      { id: 'history', icon: Database, skus: ['UNITY_CATALOG'] },
    ],
  },
  {
    id: 'curation',
    number: '04',
    nodes: [
      { id: 'review-app', icon: AppWindow, skus: ['APPS'] },
      { id: 'decisions', icon: History, skus: ['LAKEBASE'] },
      { id: 'fast-reads', icon: Zap, skus: ['LAKEBASE', 'LAKEFLOW_CONNECT'] },
      { id: 'publish', icon: FileOutput, skus: ['JOBS', 'UNITY_CATALOG'] },
    ],
  },
];

const NODES = STAGES.flatMap((stage) => stage.nodes);

/** Firecrawl capabilities BrickFill actually calls (see src/brickfill/research.py and visual_evidence.py). */
const FIRECRAWL_CAPABILITIES: Array<{ id: string; icon: ComponentType<LucideProps> }> = [
  { id: 'search', icon: Search },
  { id: 'scrape', icon: FileSearch },
  { id: 'actions', icon: MousePointerClick },
  { id: 'screenshot', icon: Camera },
  { id: 'domMap', icon: Crop },
  { id: 'mcp', icon: Plug },
  { id: 'limits', icon: Gauge },
];

/** Stages share one neutral chip: the order and the arrows carry the flow, color stays for actions and status. */
const STAGE_ICON = 'bg-secondary text-secondary-foreground';

function SkuBadge({ id, active, onClick }: { id: SkuId; active?: boolean; onClick?: () => void }) {
  const { t } = useTranslation();
  const label = t(`architecture:skus.${id}.short`);
  if (!onClick) {
    return (
      <Badge className="font-medium" variant={active ? 'default' : 'outline'}>
        {label}
      </Badge>
    );
  }
  return (
    <button
      aria-pressed={active}
      className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onClick}
      type="button"
    >
      <Badge className="cursor-pointer font-medium" variant={active ? 'default' : 'outline'}>
        {label}
      </Badge>
    </button>
  );
}

function FirecrawlMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md bg-orange-500/15 text-orange-600 dark:text-orange-400',
        className
      )}
    >
      <Flame className="h-4 w-4" />
    </span>
  );
}

export function ArchitectureModal() {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<NodeId>('web-search');
  const [highlightedSku, setHighlightedSku] = useState<SkuId | null>(null);
  const selected = NODES.find((node) => node.id === selectedId) ?? NODES[0];
  const toggleSku = (id: SkuId) => setHighlightedSku((current) => (current === id ? null : id));

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button aria-label={t('architecture:trigger')} size="sm" variant="outline">
          <Network className="h-4 w-4" />
          <span className="hidden lg:inline">{t('architecture:trigger')}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[94vh] w-[calc(100vw-1.5rem)] max-w-[1480px] gap-0 overflow-hidden p-0 sm:max-w-[1480px]">
        <DialogHeader className="border-b bg-muted/30 px-5 py-5 pr-14 text-left md:px-7">
          <div className="flex items-start gap-3">
            <BrandMark className="h-10 w-10" />
            <div>
              <DialogTitle className="text-xl">{t('architecture:title')}</DialogTitle>
              <DialogDescription className="mt-1 max-w-3xl leading-5">
                {t('architecture:description')}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(94vh-105px)]">
          <div className="space-y-6 p-5 md:p-7">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold">{t('architecture:flow.title')}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{t('architecture:flow.hint')}</p>
              </div>
              {highlightedSku ? (
                <Button size="sm" variant="ghost" onClick={() => setHighlightedSku(null)}>
                  {t('architecture:skuPanel.clear', { sku: t(`architecture:skus.${highlightedSku}.name`) })}
                </Button>
              ) : null}
            </div>

            <div className="grid gap-6 xl:gap-3 xl:grid-cols-[minmax(0,1fr)_24px_minmax(0,1.15fr)_24px_minmax(0,0.95fr)_24px_minmax(0,1fr)]">
              {STAGES.map((stage, index) => {
                return (
                  <div className="contents" key={stage.id}>
                    <section>
                      <div className="mb-3 flex items-start gap-3">
                        <span
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums ${STAGE_ICON}`}
                        >
                          {stage.number}
                        </span>
                        <div className="min-w-0">
                          <h4 className="text-base font-semibold leading-5">
                            {t(`architecture:stages.${stage.id}.title`)}
                          </h4>
                          <p className="mt-0.5 text-xs leading-4 text-muted-foreground">
                            {t(`architecture:stages.${stage.id}.subtitle`)}
                          </p>
                        </div>
                      </div>

                      <div className="space-y-2">
                        {stage.nodes.map((node) => {
                          const Icon = node.icon;
                          const isSelected = selected.id === node.id;
                          const dimmed = highlightedSku !== null && !node.skus.includes(highlightedSku);
                          const lit = highlightedSku !== null && node.skus.includes(highlightedSku);
                          return (
                            <button
                              aria-pressed={isSelected}
                              className={cn(
                                'w-full rounded-lg border p-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                isSelected
                                  ? 'border-primary bg-primary/5 shadow-sm'
                                  : 'border-border bg-card hover:border-primary/40 hover:bg-muted/50',
                                node.partner === 'firecrawl' && !isSelected && 'border-orange-500/40',
                                lit && 'ring-2 ring-primary',
                                dimmed && 'opacity-40'
                              )}
                              key={node.id}
                              onClick={() => setSelectedId(node.id)}
                              type="button"
                            >
                              <div className="flex items-start gap-2.5">
                                {node.partner === 'firecrawl' ? (
                                  <FirecrawlMark className="mt-0.5 h-7 w-7" />
                                ) : (
                                  <span className={`mt-0.5 rounded-md p-1.5 ${STAGE_ICON}`}>
                                    <Icon className="h-4 w-4" />
                                  </span>
                                )}
                                <div className="min-w-0">
                                  <p className="text-sm font-medium leading-5">
                                    {t(`architecture:nodes.${node.id}.title`)}
                                  </p>
                                  <p className="mt-1 text-xs leading-4 text-muted-foreground">
                                    {t(`architecture:nodes.${node.id}.summary`)}
                                  </p>
                                  <div className="mt-2 flex flex-wrap gap-1">
                                    {node.partner === 'firecrawl' ? (
                                      <Badge
                                        className="border-orange-500/40 text-orange-700 dark:text-orange-300"
                                        variant="outline"
                                      >
                                        Firecrawl
                                      </Badge>
                                    ) : null}
                                    {node.skus.map((sku) => (
                                      <SkuBadge active={highlightedSku === sku} id={sku} key={sku} />
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </section>

                    {index < STAGES.length - 1 ? (
                      <div
                        className="hidden items-center justify-center text-muted-foreground xl:flex"
                        aria-hidden="true"
                      >
                        <ArrowRight className="h-5 w-5" />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <section className="grid gap-4 rounded-xl border bg-muted/30 p-4 md:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.6fr)] md:p-5">
              <div>
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-primary/10 p-1.5 text-primary">
                    <Bot className="h-4 w-4" />
                  </span>
                  <h3 className="text-lg font-semibold">{t(`architecture:nodes.${selected.id}.title`)}</h3>
                </div>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  {t(`architecture:nodes.${selected.id}.detail`)}
                </p>
              </div>
              <div className="rounded-lg border bg-background p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('architecture:selected.runsOn')}
                </p>
                <p className="mt-2 text-sm font-medium leading-5">
                  {t(`architecture:nodes.${selected.id}.technology`)}
                </p>
                {selected.skus.length ? (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {selected.skus.map((sku) => (
                      <SkuBadge active={highlightedSku === sku} id={sku} key={sku} onClick={() => toggleSku(sku)} />
                    ))}
                  </div>
                ) : null}
                <div className="mt-4 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  {t('architecture:selected.traceable')}
                </div>
              </div>
            </section>

            <section
              aria-labelledby="firecrawl-band-title"
              className="overflow-hidden rounded-xl border border-orange-500/30 bg-card"
            >
              <div className="flex flex-col gap-3 border-b border-orange-500/20 p-4 md:flex-row md:items-center md:justify-between md:p-5">
                <div className="flex items-start gap-3">
                  <FirecrawlMark className="h-10 w-10" />
                  <div>
                    <h3 className="text-lg font-semibold" id="firecrawl-band-title">
                      {t('architecture:firecrawl.title')}
                    </h3>
                    <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                      {t('architecture:firecrawl.description')}
                    </p>
                  </div>
                </div>
                <div className="rounded-lg border border-orange-500/30 bg-background px-4 py-3 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('architecture:firecrawl.creditsLabel')}
                  </p>
                  <p className="mt-1 font-semibold">{t('architecture:firecrawl.credits')}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t('architecture:firecrawl.creditsDetail')}</p>
                </div>
              </div>
              <ul className="grid gap-px bg-orange-500/10 sm:grid-cols-2 lg:grid-cols-4">
                {FIRECRAWL_CAPABILITIES.map(({ id, icon: Icon }) => (
                  <li className="bg-card p-4" key={id}>
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                      <p className="text-sm font-medium">{t(`architecture:firecrawl.capabilities.${id}.title`)}</p>
                    </div>
                    <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                      {t(`architecture:firecrawl.capabilities.${id}.description`)}
                    </p>
                  </li>
                ))}
                <li className="flex items-center bg-card p-4">
                  <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                    <Code2 className="mt-0.5 h-4 w-4 shrink-0" />
                    {t('architecture:firecrawl.untrusted')}
                  </p>
                </li>
              </ul>
            </section>

            <section aria-labelledby="sku-panel-title" className="space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h3 className="text-lg font-semibold" id="sku-panel-title">
                    {t('architecture:skuPanel.title')}
                  </h3>
                  <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                    {t('architecture:skuPanel.description')}
                  </p>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {SKUS.map(({ id, icon: Icon, billingProduct }) => {
                  const active = highlightedSku === id;
                  return (
                    <button
                      aria-pressed={active}
                      className={cn(
                        'flex flex-col rounded-xl border bg-card p-4 text-left shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        active ? 'border-primary bg-primary/5' : 'hover:border-primary/40'
                      )}
                      key={id}
                      onClick={() => toggleSku(id)}
                      type="button"
                    >
                      <div className="flex w-full items-start justify-between gap-2">
                        <span className="flex items-center gap-2">
                          <span className="rounded-md bg-primary/10 p-1.5 text-primary">
                            <Icon className="h-4 w-4" />
                          </span>
                          <span className="text-sm font-semibold leading-5">{t(`architecture:skus.${id}.name`)}</span>
                        </span>
                      </div>
                      {billingProduct ? (
                        <code className="mt-2 w-fit rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          {billingProduct}
                        </code>
                      ) : null}
                      <dl className="mt-3 space-y-2 text-xs leading-5">
                        <div>
                          <dt className="font-medium">{t('architecture:skuPanel.billing')}</dt>
                          <dd className="text-muted-foreground">{t(`architecture:skus.${id}.billing`)}</dd>
                        </div>
                        <div>
                          <dt className="font-medium">{t('architecture:skuPanel.usedFor')}</dt>
                          <dd className="text-muted-foreground">{t(`architecture:skus.${id}.usedFor`)}</dd>
                        </div>
                        <div>
                          <dt className="font-medium">{t('architecture:skuPanel.costDriver')}</dt>
                          <dd className="text-muted-foreground">{t(`architecture:skus.${id}.costDriver`)}</dd>
                        </div>
                      </dl>
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">{t('architecture:skuPanel.footnote')}</p>
            </section>

            <section aria-labelledby="guarantees-title">
              <h3 className="mb-3 text-lg font-semibold" id="guarantees-title">
                {t('architecture:guarantees.title')}
              </h3>
              <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div className="flex items-center gap-2 rounded-lg border bg-card p-3">
                  <ListChecks className="h-4 w-4 text-primary" />
                  {t('architecture:guarantees.noEvidenceNoValue')}
                </div>
                <div className="flex items-center gap-2 rounded-lg border bg-card p-3">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  {t('architecture:guarantees.secrets')}
                </div>
                <div className="flex items-center gap-2 rounded-lg border bg-card p-3">
                  <Database className="h-4 w-4 text-primary" />
                  {t('architecture:guarantees.immutable')}
                </div>
                <div className="flex items-center gap-2 rounded-lg border bg-card p-3">
                  <PencilLine className="h-4 w-4 text-primary" />
                  {t('architecture:guarantees.editsNeedEvidence')}
                </div>
              </div>
            </section>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
