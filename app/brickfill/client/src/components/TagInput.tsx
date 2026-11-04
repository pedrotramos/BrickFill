import { useId, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from '../i18n/react';

/** Splits typed or pasted text into items: one per line or comma. */
const split = (value: string) =>
  value
    .split(/[\n,;]/)
    .map((item) => item.trim())
    .filter(Boolean);

/**
 * A list of short values edited as tags inside one field: Enter, comma or Tab adds what was typed, pasting a list
 * adds every line, Backspace in the empty field removes the last tag. Duplicates are ignored (without regard to case).
 */
export function TagInput({
  id,
  label,
  values,
  onChange,
  placeholder,
  maxItems = 200,
  maxLength = 120,
  disabled,
  describedBy,
}: {
  id?: string;
  /** Accessible name of the field when no visible label points at `id`. */
  label?: string;
  values: readonly string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  maxItems?: number;
  maxLength?: number;
  disabled?: boolean;
  describedBy?: string;
}) {
  const { t } = useTranslation();
  const fallbackId = useId();
  const inputId = id ?? fallbackId;
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const full = values.length >= maxItems;

  const add = (items: string[]) => {
    const next = [...values];
    for (const item of items.map((value) => value.slice(0, maxLength))) {
      if (next.length >= maxItems) break;
      if (!next.some((value) => value.toLocaleLowerCase() === item.toLocaleLowerCase())) next.push(item);
    }
    if (next.length !== values.length) onChange(next);
    setText('');
  };
  const remove = (index: number) => {
    onChange(values.filter((_, i) => i !== index));
    input.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (
      (event.key === 'Enter' || event.key === ',' || (event.key === 'Tab' && text.trim())) &&
      !event.nativeEvent.isComposing
    ) {
      if (!text.trim()) return;
      event.preventDefault();
      add(split(text));
    } else if (event.key === 'Backspace' && !text && values.length) {
      event.preventDefault();
      remove(values.length - 1);
    }
  };
  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text');
    if (!/[\n,;]/.test(pasted)) return;
    event.preventDefault();
    add(split(`${text}${pasted}`));
  };

  return (
    <div
      className={`flex min-h-8 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-background px-1.5 py-1 text-sm transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30 ${
        disabled ? 'pointer-events-none opacity-50' : 'cursor-text'
      }`}
      data-slot="tag-input"
      onClick={() => input.current?.focus()}
    >
      {values.length ? (
        <ul aria-label={label} className="contents">
          {values.map((value, index) => (
            <li
              className="inline-flex max-w-full items-center gap-1 rounded-[4px] bg-secondary py-0.5 pr-0.5 pl-2 text-xs font-medium text-secondary-foreground"
              key={`${value}-${index}`}
            >
              <span className="truncate">{value}</span>
              <button
                aria-label={t('common:tags.remove', { value })}
                className="touch-target inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                disabled={disabled}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  remove(index);
                }}
              >
                <X aria-hidden className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <input
        aria-describedby={describedBy}
        aria-label={id ? undefined : label}
        className="h-6 min-w-32 flex-1 bg-transparent px-1 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        disabled={disabled || full}
        id={inputId}
        maxLength={maxLength}
        placeholder={full ? t('common:tags.full', { count: maxItems }) : values.length ? '' : placeholder}
        value={text}
        onBlur={() => (text.trim() ? add(split(text)) : undefined)}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
      />
    </div>
  );
}
