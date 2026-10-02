// =========================================================================
// DisplayCard.tsx — "What to display" source toggles
// =========================================================================
import React, { useEffect, useRef, useState, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useApp } from '../../lib/appContext';
import { usePreferences, useSavePreferences } from '../../hooks/usePreferences';
import type { Preferences } from '../../types';
import { sourcePreferences, sourcePreferencesToApi } from '../../lib/sourcePreferences';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Field } from '../ui/Field';
import { Input } from '../ui/input';
import { Select } from '../ui/select';
import { Checkbox } from '../ui/checkbox';
import { Skeleton } from '../ui/Spinner';
import { Icon } from '../ui/Logo';
import { EnergyPriceSettingsFields } from './EnergyPriceSettingsFields';
import { WeatherTest } from './WeatherTest';
import { formatWeatherCoordinates } from '../../lib/weatherTest';
import { energyPriceSettingsForSave, validEnergyPriceSettings } from '../../lib/energyPriceSettings';
const MONTA_FIELDS = [
  { id: 'charger_status', labelKey: 'evFieldChargerStatus' as const },
  { id: 'active_session', labelKey: 'evFieldActiveSession' as const },
  { id: 'today_stats',   labelKey: 'evFieldTodayStats' as const },
];

const ZAPTEC_FIELDS = [
  { id: 'charger_status',    labelKey: 'evFieldChargerStatus' as const },
  { id: 'active_session',    labelKey: 'evFieldActiveSession' as const },
  { id: 'installation_info', labelKey: 'evFieldInstallationInfo' as const },
];

interface SourceRowProps {
  icon: string;
  name: string;
  hint: string;
  checked: boolean;
  onToggle: () => void;
  children?: ReactNode;
}

function SourceRow({ icon, name, hint, checked, onToggle, children }: SourceRowProps) {
  const id = name.replace(/\s+/g, '-').toLowerCase();
  return (
    <div
      className={cn(
        'border rounded-md overflow-hidden transition-[border-color,background] duration-[225ms]',
        checked ? 'border-border-strong' : 'border-border'
      )}
    >
      <label
        className="flex items-start gap-3.5 px-4 py-3.5 cursor-pointer select-none hover:bg-black/[0.03]"
        htmlFor={id}
      >
        <Checkbox id={id} checked={checked} onChange={onToggle} label={name} />
        <span
          className={cn(
            'w-[38px] h-[38px] rounded-md flex-shrink-0 flex items-center justify-center [&_.material-symbols-outlined]:text-[21px]',
            checked ? 'bg-accent text-fg-on' : 'bg-black/[0.10] text-fg2'
          )}
        >
          <Icon name={icon} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-body font-medium">{name}</span>
          <span className="block text-sm text-fg2 mt-0.5">{hint}</span>
        </span>
      </label>
      {checked && <div className="px-4 pb-4 pl-[68px] grid gap-3.5">{children}</div>}
    </div>
  );
}

export function DisplayCard() {
  const app = useApp();
  const t = app.t;
  const query = usePreferences();
  const [draft, setDraft] = useState<Preferences | null>(null);
  const p = sourcePreferences(query.data, draft);
  const savePrefs = useSavePreferences();
  const [locating, setLocating] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const disabled = query.isPending || query.isError || !query.data || savePrefs.isPending;

  const set = (patch: Partial<Preferences>) => setDraft((current) => ({ ...sourcePreferences(query.data, current), ...patch }));

  function toggleEvField(
    provider: 'monta' | 'zaptec',
    fieldId: string
  ) {
    const current = p[provider].fields;
    const next = current.includes(fieldId)
      ? current.filter((f) => f !== fieldId)
      : [...current, fieldId];
    set({ [provider]: { ...p[provider], fields: next } });
  }

  function save() {
    if (disabled) return;
    if (p.energy.on && !validEnergyPriceSettings(p.energy.priceSettings ?? { mode: 'spot' })) {
      app.toast({ type: 'error', title: t.saveFailed, msg: app.lang === 'da'
        ? 'Vælg et netselskab med 13-cifret GLN, 1–5 forskellige tarifkoder (højst 20 tegn hver) og et tillæg mellem −1000 og 1000 øre/kWh.'
        : 'Choose a grid company with a 13-digit GLN, 1–5 unique tariff codes (up to 20 characters each), and a markup between −1000 and 1000 øre/kWh.' });
      return;
    }
    savePrefs.mutate(sourcePreferencesToApi(p), {
      onSuccess: () => {
        setDraft(null);
        app.toast({ type: 'success', title: t.saved, msg: t.savedMsg });
      },
      onError: (error) => {
        if (!app.online) {
          app.toast({
            type: 'error',
            title: t.saveFailed,
            msg: t.saveFailedMsg,
            persist: true,
            action: { label: t.retry, onClick: save },
          });
        } else {
          app.toast({ type: 'error', title: t.saveFailed, msg: error instanceof Error ? error.message : t.saveFailedMsg });
        }
      },
    });
  }

  function useLocation() {
    if (!navigator.geolocation) {
      app.toast({ type: 'error', title: t.locationUnavailable });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!mounted.current) return;
        const { latitude, longitude } = pos.coords;
        try {
          const location = formatWeatherCoordinates(latitude, longitude);
          setDraft((current) => {
            const value = sourcePreferences(query.data, current);
            return { ...value, weather: { ...value.weather, location } };
          });
        } catch { app.toast({ type: 'error', title: t.locationUnavailable }); }
        finally { setLocating(false); }
      },
      () => {
        if (!mounted.current) return;
        setLocating(false);
        app.toast({ type: 'error', title: t.locationUnavailable });
      },
      { timeout: 8000 }
    );
  }

  const saving = savePrefs.isPending;

  return (
    <Card
      icon="tune"
      title={t.displayTitle}
      desc={t.displayDesc}
      footer={
        <><Button variant="text" disabled={disabled || !draft} onClick={() => setDraft(null)}>{t.discardSourceChanges}</Button>
        <Button onClick={save} disabled={disabled || locating} loading={saving} icon={saving ? undefined : 'save'}>
          {saving ? t.saving : t.save}
        </Button></>
      }
    >
      {query.isError && <p role="alert" className="text-sm text-warning mt-0">{t.prefsError} <Button variant="text" onClick={() => query.refetch()}>{t.retry}</Button></p>}
      {!query.data ? (!query.isError &&
        <div className="flex flex-col gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex gap-3.5 items-center py-1.5">
              <Skeleton w={20} h={20} />
              <Skeleton w={38} h={38} style={{ borderRadius: 8 }} />
              <div className="flex-1">
                <Skeleton w="40%" h={14} />
                <Skeleton w="70%" h={11} style={{ marginTop: 7 }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <fieldset disabled={disabled} className="flex flex-col gap-3 border-0 m-0 p-0 min-w-0">
          <SourceRow
            icon="bolt"
            name={t.srcEnergy}
            hint={t.srcEnergyHint}
            checked={p.energy.on}
            onToggle={() => set({ energy: { ...p.energy, on: !p.energy.on,
              priceSettings: energyPriceSettingsForSave(!p.energy.on, p.energy.priceSettings) } })}
          >
            <div className="grid grid-cols-2 gap-3.5 max-[820px]:grid-cols-1">
              <Field label={t.zone} htmlFor="zone">
                <Select
                  id="zone"
                  value={p.energy.zone}
                  onChange={(e) => set({ energy: { ...p.energy, zone: e.target.value } })}
                  options={[
                    { value: 'DK1', label: t.zoneDK1 },
                    { value: 'DK2', label: t.zoneDK2 },
                  ]}
                />
              </Field>
            </div>
            <EnergyPriceSettingsFields settings={p.energy.priceSettings ?? { mode: 'spot' }}
              onChange={(priceSettings) => set({ energy: { ...p.energy, priceSettings } })}
              onZoneChange={(zone, priceSettings) => set({ energy: { ...p.energy, zone, priceSettings } })} />
            <div className="text-xs text-fg3 flex items-center gap-[5px] [&_.material-symbols-outlined]:text-[15px]">
              <Icon name="schedule" />
              {t.updateEvery}
            </div>
          </SourceRow>

          <SourceRow
            icon="partly_cloudy_day"
            name={t.srcWeather}
            hint={t.srcWeatherHint}
            checked={p.weather.on}
            onToggle={() => set({ weather: { ...p.weather, on: !p.weather.on } })}
          >
            <div className="grid grid-cols-2 gap-3.5 max-[820px]:grid-cols-1">
              <Field label={t.location} htmlFor="loc" helper={t.weatherLocationHelp}>
                <Input
                  id="loc"
                  mono
                  maxLength={64}
                  value={p.weather.location}
                  placeholder={t.locationPh}
                  onChange={(e) => set({ weather: { ...p.weather, location: e.target.value } })}
                />
              </Field>
              <Field label={' '}>
                <Button
                  variant="outlined"
                  icon={locating ? undefined : 'my_location'}
                  loading={locating}
                  onClick={useLocation}
                >
                  {locating ? t.locating : t.useMyLocation}
                </Button>
              </Field>
            </div>
            <WeatherTest location={p.weather.location} />
          </SourceRow>

          <SourceRow
            icon="article"
            name={t.srcNews}
            hint={t.srcNewsHint}
            checked={p.news.on}
            onToggle={() => set({ news: { ...p.news, on: !p.news.on } })}
          >
            <div className="grid grid-cols-2 gap-3.5 max-[820px]:grid-cols-1">
              {p.news.source !== 'rss' && <Field label={app.lang === 'da' ? 'NewsAPI-dækning' : 'NewsAPI coverage'} htmlFor="nl">
                <Select
                  id="nl"
                  value={p.news.lang}
                  onChange={(e) => set({ news: { ...p.news, lang: e.target.value } })}
                  options={[
                    { value: 'da', label: app.lang === 'da' ? 'Dansk (brug RSS)' : 'Danish (use RSS)' },
                    { value: 'fi', label: app.lang === 'da' ? 'Finsk (brug RSS)' : 'Finnish (use RSS)' },
                    { value: 'en', label: app.lang === 'da' ? 'Engelsk (USA)' : 'English (United States)' },
                    { value: 'de', label: app.lang === 'da' ? 'Tysk (Tyskland)' : 'German (Germany)' },
                    { value: 'sv', label: app.lang === 'da' ? 'Svensk (Sverige)' : 'Swedish (Sweden)' },
                    { value: 'no', label: app.lang === 'da' ? 'Norsk (Norge)' : 'Norwegian (Norway)' },
                  ]}
                />
              </Field>}
              <Field label={t.source} htmlFor="ns">
                <Select
                  id="ns"
                  value={p.news.source === 'rss' ? 'rss' : 'newsapi'}
                  onChange={(e) => set({ news: { ...p.news, source: e.target.value } })}
                  options={[
                    { value: 'newsapi', label: 'NewsAPI' },
                    { value: 'rss', label: 'RSS / Atom' },
                  ]}
                />
              </Field>
              {p.news.source !== 'rss' && !['en', 'de', 'sv', 'no'].includes(p.news.lang) && <p role="alert" className="text-xs text-fg2 m-0 col-span-full">{app.lang === 'da'
                ? 'NewsAPI understøtter ikke dansk eller finsk dækning. Vælg RSS / Atom og et offentligt feed fra dit nyhedsmedie, eller vælg en understøttet NewsAPI-dækning.'
                : 'NewsAPI does not support Danish or Finnish coverage. Select RSS / Atom and a public feed from your news publisher, or choose supported NewsAPI coverage.'}</p>}
              {p.news.source === 'rss' && <>
                <Field label={app.lang === 'da' ? 'Feed-adresse (HTTPS)' : 'Feed URL (HTTPS)'} htmlFor="news-feed-url">
                  <Input id="news-feed-url" type="url" maxLength={2048} value={p.news.feedUrl ?? ''}
                    placeholder="https://example.org/feed.xml"
                    onChange={(e) => set({ news: { ...p.news, feedUrl: e.target.value } })} />
                </Field>
                <Field label={app.lang === 'da' ? 'Antal overskrifter' : 'Headline limit'} htmlFor="news-item-limit">
                  <Select id="news-item-limit" value={String(p.news.itemLimit ?? 3)}
                    options={[1, 2, 3, 5, 10].map((value) => ({ value: String(value), label: String(value) }))}
                    onChange={(e) => set({ news: { ...p.news, itemLimit: Number(e.target.value) } })} />
                </Field>
                <p className="text-xs text-fg3 m-0 col-span-full">{app.lang === 'da'
                  ? 'Offentligt RSS- eller Atom-feed uden API-nøgle. Antallet på skærmen afhænger af widgetens plads.'
                  : 'Public RSS or Atom feed; no API key needed. Visible headlines depend on the space in your widget.'}</p>
              </>}
            </div>
          </SourceRow>

          <SourceRow
            icon="auto_stories"
            name={t.srcNotion}
            hint={t.srcNotionHint}
            checked={p.notion.on}
            onToggle={() => set({ notion: { ...p.notion, on: !p.notion.on } })}
          >
            <p className="text-xs text-fg3">{t.notionCredDesc}</p>
          </SourceRow>

          <SourceRow
            icon="electric_car"
            name={t.srcMonta}
            hint={t.srcMontaHint}
            checked={p.monta.on}
            onToggle={() => set({ monta: { ...p.monta, on: !p.monta.on } })}
          >
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-fg2">{t.evFieldsLabel}</span>
              {MONTA_FIELDS.map((f) => (
                <Checkbox
                  key={f.id}
                  id={`monta-${f.id}`}
                  checked={p.monta.fields.includes(f.id)}
                  onChange={() => toggleEvField('monta', f.id)}
                  label={t[f.labelKey]}
                />
              ))}
            </div>
          </SourceRow>

          <SourceRow
            icon="electric_car"
            name={t.srcZaptec}
            hint={t.srcZaptecHint}
            checked={p.zaptec.on}
            onToggle={() => set({ zaptec: { ...p.zaptec, on: !p.zaptec.on } })}
          >
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-fg2">{t.evFieldsLabel}</span>
              {ZAPTEC_FIELDS.map((f) => (
                <Checkbox
                  key={f.id}
                  id={`zaptec-${f.id}`}
                  checked={p.zaptec.fields.includes(f.id)}
                  onChange={() => toggleEvField('zaptec', f.id)}
                  label={t[f.labelKey]}
                />
              ))}
            </div>
          </SourceRow>
        </fieldset>
      )}
    </Card>
  );
}
