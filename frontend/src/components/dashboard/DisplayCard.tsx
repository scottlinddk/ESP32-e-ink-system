// =========================================================================
// DisplayCard.tsx — "What to display" source toggles
// =========================================================================
import React, { useState, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useApp } from '../../lib/appContext';
import { useSavePreferences } from '../../hooks/usePreferences';
import type { UserPreferences } from '../../types';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Field } from '../ui/Field';
import { Input } from '../ui/input';
import { Select } from '../ui/select';
import { Checkbox } from '../ui/checkbox';
import { Skeleton } from '../ui/Spinner';
import { Icon } from '../ui/Logo';

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

export function DisplayCard({ loading }: { loading: boolean }) {
  const app = useApp();
  const t = app.t;
  const rawPrefs = app.prefs;
  // Ensure EV and calendar prefs always exist, even if loaded from stale localStorage
  const p = {
    ...rawPrefs,
    monta: rawPrefs.monta ?? { on: false, fields: ['charger_status', 'active_session'] },
    zaptec: rawPrefs.zaptec ?? { on: false, fields: ['charger_status', 'active_session'] },
    calendar: rawPrefs.calendar ?? { on: false, url: '' },
    notion: rawPrefs.notion ?? { on: false },
  };
  const savePrefs = useSavePreferences();
  const [locating, setLocating] = useState(false);

  const set = (patch: Partial<typeof p>) => app.setPrefs({ ...p, ...patch });

  function prefsToApi(prefs: typeof p): Partial<UserPreferences> {
    return {
      show_energy_price: prefs.energy.on,
      energy_price_location: prefs.energy.zone,
      show_weather: prefs.weather.on,
      weather_location: prefs.weather.location,
      show_news: prefs.news.on,
      news_language: prefs.news.lang,
      show_monta: prefs.monta.on,
      monta_fields: prefs.monta.fields,
      show_zaptec: prefs.zaptec.on,
      zaptec_fields: prefs.zaptec.fields,
      show_calendar: prefs.calendar.on,
      ics_calendar_url: prefs.calendar.url || undefined,
      show_notion: prefs.notion.on,
    };
  }

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
    savePrefs.mutate(prefsToApi(p), {
      onSuccess: () => {
        app.toast({ type: 'success', title: t.saved, msg: t.savedMsg });
      },
      onError: () => {
        if (!app.online) {
          app.toast({
            type: 'error',
            title: t.saveFailed,
            msg: t.saveFailedMsg,
            persist: true,
            action: { label: t.retry, onClick: save },
          });
        } else {
          app.toast({ type: 'error', title: t.saveFailed, msg: t.saveFailedMsg });
        }
      },
    });
  }

  function useLocation() {
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        set({ weather: { ...p.weather, location: `${latitude.toFixed(2)}, ${longitude.toFixed(2)}` } });
        setLocating(false);
      },
      () => {
        setLocating(false);
        app.toast({ type: 'error', title: 'Location unavailable' });
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
        <Button onClick={save} loading={saving} icon={saving ? undefined : 'save'}>
          {saving ? t.saving : t.save}
        </Button>
      }
    >
      {loading ? (
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
        <div className="flex flex-col gap-3">
          <SourceRow
            icon="bolt"
            name={t.srcEnergy}
            hint={t.srcEnergyHint}
            checked={p.energy.on}
            onToggle={() => set({ energy: { ...p.energy, on: !p.energy.on } })}
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
              <Field label={t.location} htmlFor="loc">
                <Input
                  id="loc"
                  mono
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
          </SourceRow>

          <SourceRow
            icon="article"
            name={t.srcNews}
            hint={t.srcNewsHint}
            checked={p.news.on}
            onToggle={() => set({ news: { ...p.news, on: !p.news.on } })}
          >
            <div className="grid grid-cols-2 gap-3.5 max-[820px]:grid-cols-1">
              <Field label={t.contentLang} htmlFor="nl">
                <Select
                  id="nl"
                  value={p.news.lang}
                  onChange={(e) => set({ news: { ...p.news, lang: e.target.value } })}
                  options={[
                    { value: 'da', label: t.langDanish },
                    { value: 'en', label: t.langEnglish },
                  ]}
                />
              </Field>
              <Field label={t.source} htmlFor="ns">
                <Select
                  id="ns"
                  value={p.news.source}
                  onChange={(e) => set({ news: { ...p.news, source: e.target.value } })}
                  options={[
                    { value: 'dr', label: t.newsSrcDR },
                    { value: 'pol', label: t.newsSrcPolitiken },
                    { value: 'tv2', label: t.newsSrcTV2 },
                  ]}
                />
              </Field>
            </div>
          </SourceRow>

          <SourceRow
            icon="calendar_month"
            name={t.srcCalendar}
            hint={t.srcCalendarHint}
            checked={p.calendar.on}
            onToggle={() => set({ calendar: { ...p.calendar, on: !p.calendar.on } })}
          >
            <div className="flex flex-col gap-2">
              <Field label={t.calendarUrl} htmlFor="ics-url">
                <Input
                  id="ics-url"
                  mono
                  value={p.calendar.url}
                  placeholder={t.calendarUrlPh}
                  onChange={(e) => set({ calendar: { ...p.calendar, url: e.target.value } })}
                />
              </Field>
              <p className="text-xs text-fg3">{t.calendarUrlHint}</p>
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
        </div>
      )}
    </Card>
  );
}
