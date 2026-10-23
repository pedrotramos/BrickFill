import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@databricks/appkit-ui/react';
import { AlertCircle, Languages, Lock, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { useTranslation } from '../i18n/react';
import { PageHeader, RefreshButton } from '../components/PageHeader';
import { ApiError, errorText } from '../lib/api-errors';
import { useCatalogQuery } from '../lib/catalog-query';
import { formatDate } from '../lib/formatters';
import {
  cleanOverrides,
  loadSettings,
  removeCategorySetting,
  saveAppSettings,
  saveCategorySetting,
  type CategorySetting,
  type ContentManifest,
  type OverrideSpec,
  type Overrides,
  type SettingsState,
} from '../lib/settings';

const INHERIT = '__inherit__';
const NO_PARAMETERS = {};

function isConflict(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 409 || error.code === 'SETTINGS_VERSION_CONFLICT');
}

/** Display of a stored settings value (history before/after, defaults). */
function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.length ? value.join(' / ') : '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function useLabels(manifest: ContentManifest | undefined) {
  const { t, i18n } = useTranslation();
  return useMemo(() => {
    const languageName = (code: string | null | undefined) =>
      code ? (manifest?.languages.find((item) => item.code === code)?.name ?? code) : '';
    const profileName = (id: string | null | undefined) =>
      id
        ? i18n.exists(`settings:profiles.${id}`)
          ? t(`settings:profiles.${id}`)
          : (manifest?.profiles.find((item) => item.id === id)?.name ?? id)
        : '';
    const marketName = (code: string | null | undefined) =>
      code
        ? i18n.exists(`settings:markets.${code}`)
          ? t(`settings:markets.${code}`)
          : (manifest?.markets.find((item) => item.code === code)?.name ?? code)
        : '';
    const overrideLabel = (key: string) =>
      i18n.exists(`settings:overrides.${key}.label`) ? t(`settings:overrides.${key}.label`) : key;
    const fieldLabel = (key: string) => {
      if (key.startsWith('overrides.')) return overrideLabel(key.slice('overrides.'.length));
      return i18n.exists(`settings:fields.${key}`) ? t(`settings:fields.${key}`) : key;
    };
    return { languageName, profileName, marketName, overrideLabel, fieldLabel };
  }, [i18n, manifest, t]);
}

/** One input per overridable profile setting; empty means "use the profile value" (shown as the placeholder). */
function OverrideFields({
  manifest,
  profileId,
  value,
  onChange,
  disabled,
  idPrefix,
}: {
  manifest: ContentManifest;
  profileId: string;
  value: Overrides;
  onChange: (value: Overrides) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  const { t, i18n } = useTranslation();
  const { overrideLabel } = useLabels(manifest);
  const defaults = manifest.profile_defaults[profileId] ?? manifest.profile_defaults.default ?? {};
  const set = (key: string, next: unknown) => onChange({ ...value, [key]: next });

  const renderField = (key: string, spec: OverrideSpec) => {
    const id = `${idPrefix}-${key}`;
    const fallback = defaults[key];
    const current = value[key];
    switch (spec.type) {
      case 'integer':
        return (
          <Input
            disabled={disabled}
            id={id}
            inputMode="numeric"
            max={spec.maximum}
            min={spec.minimum}
            placeholder={t('settings:overrides.profileDefault', { value: displayValue(fallback) })}
            type="number"
            value={typeof current === 'number' ? String(current) : ''}
            onChange={(event) => set(key, event.target.value === '' ? undefined : Number(event.target.value))}
          />
        );
      case 'boolean':
        return (
          <Select
            disabled={disabled}
            value={typeof current === 'boolean' ? String(current) : INHERIT}
            onValueChange={(next) => set(key, next === INHERIT ? undefined : next === 'true')}
          >
            <SelectTrigger id={id}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={INHERIT}>
                {t('settings:overrides.profileDefault', {
                  value: fallback === undefined ? '—' : fallback ? t('settings:yes') : t('settings:no'),
                })}
              </SelectItem>
              <SelectItem value="true">{t('settings:yes')}</SelectItem>
              <SelectItem value="false">{t('settings:no')}</SelectItem>
            </SelectContent>
          </Select>
        );
      case 'enum': {
        const valueLabel = (item: string) =>
          i18n.exists(`settings:overrides.${key}.values.${item}`)
            ? t(`settings:overrides.${key}.values.${item}`)
            : item;
        return (
          <Select
            disabled={disabled}
            value={typeof current === 'string' ? current : INHERIT}
            onValueChange={(next) => set(key, next === INHERIT ? undefined : next)}
          >
            <SelectTrigger id={id}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={INHERIT}>
                {t('settings:overrides.profileDefault', {
                  value: typeof fallback === 'string' ? valueLabel(fallback) : '—',
                })}
              </SelectItem>
              {spec.values.map((item) => (
                <SelectItem key={item} value={item}>
                  {valueLabel(item)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      }
      case 'string_list':
        return (
          <Textarea
            disabled={disabled}
            id={id}
            placeholder={t('settings:overrides.listPlaceholder', { value: displayValue(fallback) })}
            rows={2}
            value={Array.isArray(current) ? current.join('\n') : ''}
            onChange={(event) => {
              const items = event.target.value
                .split('\n')
                .map((item) => item.slice(0, spec.max_length))
                .slice(0, spec.max_items);
              set(key, items.some((item) => item.trim()) ? items : undefined);
            }}
          />
        );
    }
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {Object.entries(manifest.overrides).map(([key, spec]) => (
        <div className="space-y-1.5" key={key}>
          <Label htmlFor={`${idPrefix}-${key}`}>{overrideLabel(key)}</Label>
          {renderField(key, spec)}
          {i18n.exists(`settings:overrides.${key}.help`) ? (
            <p className="text-xs text-muted-foreground">{t(`settings:overrides.${key}.help`)}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** Trims list entries and drops empty values before sending. */
function normalizeOverrides(overrides: Overrides): Overrides {
  const trimmed = Object.fromEntries(
    Object.entries(overrides).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : value,
    ])
  );
  return cleanOverrides(trimmed);
}

function GlobalSettingsCard({
  state,
  onSaved,
  onConflict,
}: {
  state: SettingsState;
  onSaved: () => Promise<void>;
  onConflict: () => void;
}) {
  const { t } = useTranslation();
  const { manifest, defaults, app, canEdit } = state;
  const { languageName, profileName, marketName } = useLabels(manifest);
  const [contentLanguage, setContentLanguage] = useState(app?.contentLanguage ?? defaults.contentLanguage);
  const [catalogLanguage, setCatalogLanguage] = useState<string | null>(
    app ? app.catalogLanguage : defaults.catalogLanguage
  );
  const [contentProfile, setContentProfile] = useState(app?.contentProfile ?? defaults.contentProfile);
  const [market, setMarket] = useState<string | null>(app ? app.market : defaults.market);
  const [overrides, setOverrides] = useState<Overrides>(app?.overrides ?? {});
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabled = !canEdit || saving;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveAppSettings({
        contentLanguage,
        catalogLanguage,
        contentProfile,
        market,
        overrides: normalizeOverrides(overrides),
        expectedVersion: app?.version ?? 0,
        reason: reason.trim() || undefined,
      });
      setReason('');
      await onSaved();
    } catch (caught) {
      if (isConflict(caught)) onConflict();
      else setError(errorText(caught, 'errors:SETTINGS_SAVE_FAILED'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle aria-level={2} role="heading" className="flex items-center gap-2">
          <Languages aria-hidden className="h-5 w-5 text-muted-foreground" />
          {t('settings:global.title')}
        </CardTitle>
        <CardDescription>
          {app
            ? t('settings:global.savedBy', {
                user: app.updatedBy,
                date: formatDate(app.updatedAt),
                version: app.version,
              })
            : t('settings:global.usingDefaults')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="content-language">{t('settings:fields.content_language')}</Label>
            <Select disabled={disabled} value={contentLanguage} onValueChange={setContentLanguage}>
              <SelectTrigger id="content-language">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {manifest.languages.map((language) => (
                  <SelectItem key={language.code} lang={language.code} value={language.code}>
                    {language.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t('settings:global.contentLanguageHelp')}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="catalog-language">{t('settings:fields.catalog_language')}</Label>
            <Select
              disabled={disabled}
              value={catalogLanguage ?? INHERIT}
              onValueChange={(next) => setCatalogLanguage(next === INHERIT ? null : next)}
            >
              <SelectTrigger id="catalog-language">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={INHERIT}>{t('settings:global.sameAsContent')}</SelectItem>
                {manifest.languages.map((language) => (
                  <SelectItem key={language.code} lang={language.code} value={language.code}>
                    {language.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t('settings:global.catalogLanguageHelp')}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="content-profile">{t('settings:fields.content_profile')}</Label>
            <Select disabled={disabled} value={contentProfile} onValueChange={setContentProfile}>
              <SelectTrigger id="content-profile">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {manifest.profiles.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profileName(profile.id)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t('settings:global.profileHelp')}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="market">{t('settings:fields.market')}</Label>
            <Select
              disabled={disabled}
              value={market ?? INHERIT}
              onValueChange={(next) => setMarket(next === INHERIT ? null : next)}
            >
              <SelectTrigger id="market">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={INHERIT}>{t('settings:global.noMarket')}</SelectItem>
                {manifest.markets.map((item) => (
                  <SelectItem key={item.code} value={item.code}>
                    {marketName(item.code)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t('settings:global.marketHelp')}</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold">{t('settings:global.rulesTitle')}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('settings:global.rulesHelp', { profile: profileName(contentProfile) })}
            </p>
          </div>
          <OverrideFields
            disabled={disabled}
            idPrefix="global"
            manifest={manifest}
            profileId={contentProfile}
            value={overrides}
            onChange={setOverrides}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="global-reason">{t('settings:reason')}</Label>
          <Input
            disabled={disabled}
            id="global-reason"
            placeholder={t('settings:reasonPlaceholder')}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {t('settings:global.deploymentDefaults', {
              language: languageName(defaults.contentLanguage),
              profile: profileName(defaults.contentProfile),
              market: marketName(defaults.market) || '—',
            })}
          </p>
          {canEdit ? (
            <Button disabled={saving} onClick={() => void save()}>
              <Save className="mr-2 h-4 w-4" />
              {saving ? t('common:actions.saving') : t('settings:global.save')}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

interface CategoryOption {
  id: string;
  name: string;
}

function CategoryOverrideDialog({
  state,
  categories,
  editing,
  open,
  onOpenChange,
  onSaved,
  onConflict,
}: {
  state: SettingsState;
  categories: CategoryOption[];
  editing: CategorySetting | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
  onConflict: () => void;
}) {
  const { t } = useTranslation();
  const { manifest, app, defaults } = state;
  const { languageName, profileName } = useLabels(manifest);
  const [categoryId, setCategoryId] = useState('');
  const [contentLanguage, setContentLanguage] = useState<string | null>(null);
  const [contentProfile, setContentProfile] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Overrides>({});
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCategoryId(editing?.scopeId ?? '');
    setContentLanguage(editing?.contentLanguage ?? null);
    setContentProfile(editing?.contentProfile ?? null);
    setOverrides(editing?.overrides ?? {});
    setReason('');
    setError(null);
  }, [editing, open]);

  const configured = new Set(state.categories.filter((item) => item.scope === 'category').map((item) => item.scopeId));
  const available = editing ? categories : categories.filter((item) => !configured.has(item.id));
  const inheritedLanguage = app?.contentLanguage ?? defaults.contentLanguage;
  const inheritedProfile = app?.contentProfile ?? defaults.contentProfile;
  const profileForDefaults = contentProfile ?? inheritedProfile;

  const save = async () => {
    if (!categoryId) return;
    setSaving(true);
    setError(null);
    try {
      await saveCategorySetting('category', categoryId, {
        scopeName: categories.find((item) => item.id === categoryId)?.name ?? editing?.scopeName ?? null,
        contentLanguage,
        contentProfile,
        overrides: normalizeOverrides(overrides),
        expectedVersion: editing?.version ?? 0,
        reason: reason.trim() || undefined,
      });
      onOpenChange(false);
      await onSaved();
    } catch (caught) {
      if (isConflict(caught)) {
        onOpenChange(false);
        onConflict();
      } else {
        setError(errorText(caught, 'errors:SETTINGS_SAVE_FAILED'));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{editing ? t('settings:categories.editTitle') : t('settings:categories.addTitle')}</DialogTitle>
          <DialogDescription>{t('settings:categories.dialogDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          {/* Same two columns as the rule fields below; triggers fill their cell so long values never overlap. */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="min-w-0 space-y-1.5 md:col-span-2">
              <Label htmlFor="category-override-category">{t('settings:categories.category')}</Label>
              <Select disabled={Boolean(editing)} value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger className="w-full md:w-[calc(50%-0.5rem)]" id="category-override-category">
                  <SelectValue placeholder={t('settings:categories.chooseCategory')} />
                </SelectTrigger>
                <SelectContent>
                  {editing && !categories.some((item) => item.id === editing.scopeId) ? (
                    <SelectItem value={editing.scopeId}>{editing.scopeName ?? editing.scopeId}</SelectItem>
                  ) : null}
                  {available.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="category-override-language">{t('settings:fields.content_language')}</Label>
              <Select
                value={contentLanguage ?? INHERIT}
                onValueChange={(next) => setContentLanguage(next === INHERIT ? null : next)}
              >
                <SelectTrigger className="w-full" id="category-override-language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={INHERIT}>
                    {t('settings:categories.inherit', { value: languageName(inheritedLanguage) })}
                  </SelectItem>
                  {manifest.languages.map((language) => (
                    <SelectItem key={language.code} lang={language.code} value={language.code}>
                      {language.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="category-override-profile">{t('settings:fields.content_profile')}</Label>
              <Select
                value={contentProfile ?? INHERIT}
                onValueChange={(next) => setContentProfile(next === INHERIT ? null : next)}
              >
                <SelectTrigger className="w-full" id="category-override-profile">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={INHERIT}>
                    {t('settings:categories.inherit', { value: profileName(inheritedProfile) })}
                  </SelectItem>
                  {manifest.profiles.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profileName(profile.id)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">{t('settings:categories.rulesHelp')}</p>
            <OverrideFields
              idPrefix="category"
              manifest={manifest}
              profileId={profileForDefaults}
              value={overrides}
              onChange={setOverrides}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="category-override-reason">{t('settings:reason')}</Label>
            <Input
              id="category-override-reason"
              placeholder={t('settings:reasonPlaceholder')}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button disabled={saving} variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common:actions.cancel')}
          </Button>
          <Button disabled={saving || !categoryId} onClick={() => void save()}>
            <Save className="mr-2 h-4 w-4" />
            {saving ? t('common:actions.saving') : t('common:actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CategoryOverridesCard({
  state,
  onSaved,
  onConflict,
}: {
  state: SettingsState;
  onSaved: () => Promise<void>;
  onConflict: () => void;
}) {
  const { t } = useTranslation();
  const { manifest, canEdit } = state;
  const { languageName, profileName, overrideLabel } = useLabels(manifest);
  const categoriesQuery = useCatalogQuery('categories', NO_PARAMETERS);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CategorySetting | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const categories = useMemo<CategoryOption[]>(() => {
    const options = new Map<string, string>();
    for (const row of categoriesQuery.data ?? []) {
      const id = (row as { category_id?: unknown }).category_id;
      const key = typeof id === 'string' && id ? id : row.category;
      if (key) options.set(key, row.category);
    }
    return Array.from(options, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [categoriesQuery.data]);

  const rows = state.categories.filter((item) => item.active);

  const remove = async (item: CategorySetting) => {
    setRemoving(item.scopeId);
    setError(null);
    try {
      await removeCategorySetting(item.scope, item.scopeId, item.version);
      await onSaved();
    } catch (caught) {
      if (isConflict(caught)) onConflict();
      else setError(errorText(caught, 'errors:SETTINGS_SAVE_FAILED'));
    } finally {
      setRemoving(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="space-y-1.5">
          <CardTitle aria-level={2} role="heading">
            {t('settings:categories.title')}
          </CardTitle>
          <CardDescription>{t('settings:categories.description')}</CardDescription>
        </div>
        {canEdit ? (
          <Button
            disabled={categoriesQuery.loading}
            size="sm"
            variant="outline"
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="mr-1 h-4 w-4" />
            {t('settings:categories.add')}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {!rows.length ? (
          <p className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">{t('settings:categories.empty')}</p>
        ) : (
          // stacked below 1024px (index.css), so edit and remove stay on screen
          <Table className="stack-table">
            <TableHeader>
              <TableRow>
                <TableHead>{t('settings:categories.category')}</TableHead>
                <TableHead>{t('settings:fields.content_language')}</TableHead>
                <TableHead>{t('settings:fields.content_profile')}</TableHead>
                <TableHead>{t('settings:categories.rules')}</TableHead>
                <TableHead>{t('settings:categories.updated')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('settings:categories.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((item) => {
                const ruleKeys = Object.keys(item.overrides);
                return (
                  <TableRow key={`${item.scope}-${item.scopeId}`}>
                    <TableCell>
                      <p className="font-medium">{item.scopeName ?? item.scopeId}</p>
                      <p className="text-xs text-muted-foreground">
                        {t(`settings:scopes.${item.scope}`, { defaultValue: item.scope })} · {item.scopeId}
                      </p>
                    </TableCell>
                    <TableCell data-label={t('settings:fields.content_language')}>
                      {item.contentLanguage ? (
                        <Badge variant="outline">{languageName(item.contentLanguage)}</Badge>
                      ) : (
                        <span className="text-muted-foreground">{t('settings:categories.inherited')}</span>
                      )}
                    </TableCell>
                    <TableCell data-label={t('settings:fields.content_profile')}>
                      {item.contentProfile ? (
                        profileName(item.contentProfile)
                      ) : (
                        <span className="text-muted-foreground">{t('settings:categories.inherited')}</span>
                      )}
                    </TableCell>
                    <TableCell data-label={t('settings:categories.rules')} className="max-w-64">
                      {ruleKeys.length ? (
                        <span className="text-xs">{ruleKeys.map(overrideLabel).join(', ')}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell data-label={t('settings:categories.updated')} className="text-xs text-muted-foreground">
                      {item.updatedBy}
                      <br />
                      {formatDate(item.updatedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      {canEdit ? (
                        <div className="flex justify-end gap-1">
                          <Button
                            aria-label={t('common:actions.edit')}
                            size="icon"
                            variant="ghost"
                            onClick={() => {
                              setEditing(item);
                              setDialogOpen(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                aria-label={t('common:actions.remove')}
                                disabled={removing === item.scopeId}
                                size="icon"
                                variant="ghost"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>{t('settings:categories.removeTitle')}</AlertDialogTitle>
                                <AlertDialogDescription>
                                  {t('settings:categories.removeDescription', {
                                    category: item.scopeName ?? item.scopeId,
                                  })}
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>{t('common:actions.cancel')}</AlertDialogCancel>
                                <AlertDialogAction onClick={() => void remove(item)}>
                                  {t('common:actions.remove')}
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <p className="text-xs text-muted-foreground">{t('settings:categories.precedence')}</p>
      </CardContent>
      <CategoryOverrideDialog
        categories={categories}
        editing={editing}
        onConflict={onConflict}
        onOpenChange={setDialogOpen}
        onSaved={onSaved}
        open={dialogOpen}
        state={state}
      />
    </Card>
  );
}

function HistoryCard({ state }: { state: SettingsState }) {
  const { t } = useTranslation();
  const { fieldLabel, languageName, profileName, marketName } = useLabels(state.manifest);
  const render = (fieldKey: string, value: unknown) => {
    if (typeof value === 'string') {
      if (fieldKey.endsWith('language')) return languageName(value);
      if (fieldKey === 'content_profile') return profileName(value);
      if (fieldKey === 'market') return marketName(value);
    }
    if (typeof value === 'boolean' && fieldKey === 'active') return value ? t('settings:yes') : t('settings:no');
    return displayValue(value);
  };
  const scopeName = (scope: string, scopeId: string) => {
    if (scope === 'global') return t('settings:scopes.global');
    const match = state.categories.find((item) => item.scope === scope && item.scopeId === scopeId);
    return `${t(`settings:scopes.${scope}`, { defaultValue: scope })} · ${match?.scopeName ?? scopeId}`;
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle aria-level={2} role="heading">
          {t('settings:history.title')}
        </CardTitle>
        <CardDescription>{t('settings:history.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!state.history.length ? (
          <p className="text-sm text-muted-foreground">{t('settings:history.empty')}</p>
        ) : (
          state.history.map((event) => (
            <div className="border-l-2 border-border pl-3" key={event.id}>
              <p className="text-sm">
                <span className="font-medium">{fieldLabel(event.fieldKey)}</span>{' '}
                <span className="text-muted-foreground">
                  {render(event.fieldKey, event.before)} → {render(event.fieldKey, event.after)}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                {scopeName(event.scope, event.scopeId)} · {event.actor} · {formatDate(event.createdAt)}
              </p>
              {event.reason ? <p className="mt-1 text-xs text-muted-foreground">{event.reason}</p> : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  const [state, setState] = useState<SettingsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  // Remounts the forms with the freshly loaded values after every save or reload.
  const [generation, setGeneration] = useState(0);

  const reload = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const loaded = await loadSettings(signal);
      if (signal?.aborted) return;
      setState(loaded);
      setConflict(false);
      setGeneration((value) => value + 1);
    } catch (caught) {
      if (signal?.aborted) return;
      setError(errorText(caught, 'errors:SETTINGS_LOAD_FAILED'));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [reload]);

  const refresh = useCallback(() => reload(), [reload]);
  const showConflict = useCallback(() => setConflict(true), []);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <PageHeader
        actions={<RefreshButton busy={loading} label={t('settings:reload')} onClick={() => void reload()} />}
        description={t('settings:subtitle')}
        title={t('settings:title')}
      />

      {conflict ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{t('errors:SETTINGS_VERSION_CONFLICT')}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            {t('settings:conflict')}
            <Button size="sm" variant="outline" onClick={() => void reload()}>
              {t('common:actions.reload')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{t('settings:loadError')}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {state && !state.canEdit ? (
        <Alert>
          <Lock className="h-4 w-4" />
          <AlertTitle>{t('settings:readOnly.title')}</AlertTitle>
          <AlertDescription>{t('settings:readOnly.description')}</AlertDescription>
        </Alert>
      ) : null}

      {!state && loading ? (
        <div className="space-y-4">
          <Skeleton className="h-80" />
          <Skeleton className="h-48" />
        </div>
      ) : state ? (
        <div className="space-y-6" key={generation}>
          <GlobalSettingsCard onConflict={showConflict} onSaved={refresh} state={state} />
          <CategoryOverridesCard onConflict={showConflict} onSaved={refresh} state={state} />
          <HistoryCard state={state} />
        </div>
      ) : null}
    </div>
  );
}
