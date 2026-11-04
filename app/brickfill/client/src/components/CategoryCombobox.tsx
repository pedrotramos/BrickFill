import { useMemo, useState } from 'react';
import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@databricks/appkit-ui/react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useTranslation } from '../i18n/react';
import type { CategoryOption } from '../lib/category-tree';
import { matchesSearch } from '../lib/search';

/** Most options rendered at once; the search narrows a catalog with thousands of subcategories. */
const MAX_VISIBLE = 200;

/**
 * Searchable category picker: finds an option by name, identifier or synonym, ignoring accents and case. `allLabel`
 * adds a first option that clears the choice (e.g. "All categories").
 */
export function CategoryCombobox({
  id,
  label,
  options,
  value,
  onChange,
  placeholder,
  allLabel,
  disabled,
  className,
}: {
  id?: string;
  /** Accessible name when no visible label points at `id`. */
  label?: string;
  options: readonly CategoryOption[];
  value: string | null;
  onChange: (value: string | null, option: CategoryOption | null) => void;
  placeholder: string;
  allLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selected = options.find((option) => option.id === value) ?? null;
  const matches = useMemo(
    () => options.filter((option) => matchesSearch(search, [option.name, option.id, option.path, ...option.synonyms])),
    [options, search]
  );
  const choose = (option: CategoryOption | null) => {
    onChange(option?.id ?? null, option);
    setOpen(false);
    setSearch('');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          aria-expanded={open}
          aria-label={label}
          className={`w-full justify-between font-normal ${className ?? ''}`}
          disabled={disabled}
          id={id}
          role="combobox"
          variant="outline"
        >
          <span className={`truncate ${selected ? '' : 'text-muted-foreground'}`}>
            {selected?.name ?? (value ? value : (allLabel ?? placeholder))}
          </span>
          <ChevronsUpDown aria-hidden className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(28rem,calc(100vw-2rem))] p-0">
        {/* filtering is ours (accents, ids, synonyms), not cmdk's */}
        <Command shouldFilter={false}>
          <CommandInput placeholder={t('common:categoryPicker.search')} value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>{t('common:categoryPicker.empty')}</CommandEmpty>
            <CommandGroup>
              {allLabel ? (
                <CommandItem value="__all__" onSelect={() => choose(null)}>
                  <Check aria-hidden className={`mr-2 h-4 w-4 ${value ? 'opacity-0' : 'opacity-100'}`} />
                  {allLabel}
                </CommandItem>
              ) : null}
              {matches.slice(0, MAX_VISIBLE).map((option) => (
                <CommandItem key={option.id} value={option.id} onSelect={() => choose(option)}>
                  <Check
                    aria-hidden
                    className={`mr-2 h-4 w-4 shrink-0 ${option.id === value ? 'opacity-100' : 'opacity-0'}`}
                  />
                  <span className="min-w-0">
                    <span className="block truncate">{option.name}</span>
                    {option.path || option.synonyms.length ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {[option.path, option.synonyms.join(', ')].filter(Boolean).join(' · ')}
                      </span>
                    ) : null}
                  </span>
                </CommandItem>
              ))}
              {matches.length > MAX_VISIBLE ? (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">
                  {t('common:categoryPicker.more', { count: matches.length - MAX_VISIBLE })}
                </p>
              ) : null}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
