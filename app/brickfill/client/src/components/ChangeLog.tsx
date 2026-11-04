import type { ReactNode } from 'react';
import { Minus, Plus } from 'lucide-react';
import { useTranslation } from '../i18n/react';
import { formatDate } from '../lib/formatters';
import { isEmpty, isRealChange, listDiff, type ChangeGroup } from '../lib/history';

/** A value as a reader expects it: lists as tags with what was added and removed, sections as "name: fields". */
export function ChangeValue({ before, after }: { before: unknown; after: unknown }) {
  const { t } = useTranslation();
  const diff = listDiff(before, after);
  if (diff) {
    if (!diff.length) return <span className="text-muted-foreground">{t('common:history.empty')}</span>;
    return (
      <ul className="flex flex-wrap gap-1">
        {diff.map(({ value, change }) => (
          <li
            className={`inline-flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-xs ${
              change === 'added'
                ? 'bg-success-soft text-success'
                : change === 'removed'
                  ? 'bg-danger-soft text-destructive line-through'
                  : 'bg-secondary text-secondary-foreground'
            }`}
            key={`${change}-${value}`}
          >
            {change === 'added' ? <Plus aria-label={t('common:history.added')} className="h-3 w-3" /> : null}
            {change === 'removed' ? <Minus aria-label={t('common:history.removed')} className="h-3 w-3" /> : null}
            {value}
          </li>
        ))}
      </ul>
    );
  }
  const show = (value: unknown): ReactNode => {
    if (isEmpty(value)) return <span className="text-muted-foreground">{t('common:history.empty')}</span>;
    if (typeof value === 'boolean') return value ? t('common:history.yes') : t('common:history.no');
    if (Array.isArray(value))
      return (
        <ul className="space-y-0.5">
          {value.map((item, index) => {
            const section = item as { section?: unknown; fields?: unknown };
            return (
              <li key={index}>
                {typeof section?.section === 'string' ? (
                  <>
                    <span className="font-medium">{section.section}</span>
                    {Array.isArray(section.fields) && section.fields.length ? (
                      <span className="text-muted-foreground">: {section.fields.join(', ')}</span>
                    ) : null}
                  </>
                ) : (
                  String(item)
                )}
              </li>
            );
          })}
        </ul>
      );
    if (typeof value === 'object') return <code className="text-xs">{JSON.stringify(value)}</code>;
    return String(value);
  };
  if (isEmpty(before)) return <div>{show(after)}</div>;
  return (
    <div className="grid gap-1">
      <div className="text-muted-foreground line-through decoration-muted-foreground/60">{show(before)}</div>
      <div>{show(after)}</div>
    </div>
  );
}

/**
 * The history of an editing screen, one row per save: what was changed (the record and its revision), who and when,
 * the reason, then each field with its new value against the old one.
 */
export function ChangeLog({
  groups,
  title,
  fieldLabel,
  renderValue,
  empty,
}: {
  groups: readonly ChangeGroup[];
  /** The changed record of a save (e.g. the template name). */
  title: (group: ChangeGroup) => ReactNode;
  fieldLabel: (fieldKey: string) => string;
  renderValue?: (fieldKey: string, before: unknown, after: unknown) => ReactNode;
  empty: string;
}) {
  const { t } = useTranslation();
  const shown = groups
    .map((group) => ({ ...group, events: group.events.filter((event) => isRealChange(event.before, event.after)) }))
    .filter((group) => group.events.length);
  if (!shown.length) return <p className="px-6 py-5 text-sm text-muted-foreground">{t(empty)}</p>;
  return (
    <ol className="divide-y">
      {shown.map((group) => (
        <li className="grid gap-3 px-6 py-4 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] md:gap-6" key={group.id}>
          <div className="min-w-0 space-y-0.5">
            <p className="truncate text-sm font-medium">{title(group)}</p>
            <p className="text-xs text-muted-foreground tabular-nums">
              {formatDate(group.createdAt)}
              {group.revision ? ` · ${t('common:history.revision', { revision: group.revision })}` : ''}
            </p>
            <p className="truncate text-xs text-muted-foreground" title={group.actor}>
              {group.actor}
            </p>
            {group.reason ? <p className="pt-1 text-xs text-foreground/80">“{group.reason}”</p> : null}
          </div>
          <dl className="grid min-w-0 gap-x-4 gap-y-2 text-sm sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
            {group.events.map((event) => (
              <div className="contents" key={event.id}>
                <dt className="text-xs leading-5 text-muted-foreground">{fieldLabel(event.fieldKey)}</dt>
                <dd className="min-w-0 break-words">
                  {renderValue ? (
                    renderValue(event.fieldKey, event.before, event.after)
                  ) : (
                    <ChangeValue after={event.after} before={event.before} />
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </li>
      ))}
    </ol>
  );
}
