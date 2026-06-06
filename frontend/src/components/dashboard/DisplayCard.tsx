// =========================================================================
// DisplayCard.tsx — "What to display" source toggles
// =========================================================================
import React, { useState, ReactNode } from 'react';
import { useApp } from '../../lib/appContext';
import { useSavePreferences } from '../../hooks/usePreferences';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Field } from '../ui/Field';
import { Input } from '../ui/input';
import { Select } from '../ui/select';
import { Checkbox } from '../ui/checkbox';
import { Skeleton } from '../ui/Spinner';
import { Icon } from '../ui/Logo';
import { cn } from '../../lib/utils';

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
        'border border-[var(--color-border)] rounded-lg overflow-hidden transition-colors duration-[225ms] [&+&]:mt-3',
        checked && 'border-border-strong',
      )}
    >
      <label
        className="flex items-start gap-[14px] px-4 py-[14px] cursor-pointer select-none hover:bg-[rgba(128,128,128,0.03)]"
        htmlFor={id}
      >
        <Checkbox id={id} checked={checked} onChange={onToggle} label={name} />
        <span
          className={cn(
            'w-[38px] h-[38px] rounded-lg flex-shrink-0 flex items-center justify-center bg-[rgba(128,128,128,0.1)] text-fg-2 [&_.material-symbols-outlined]:text-[21px]',
            checked && 'bg-accent text-fg-on',
          )}
        >
          <Icon name={icon} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="text-base font-medium block">{name}</span>
          <span className="text-sm text-fg-2 mt-0.5 block">{hint}</span>
        </span>
      </label>
      {checked && (
        <div className="px-4 pb-4 pl-[68px] grid gap-[14px] max-[820px]:pl-4">
          {children}
        </div>
      )}
    </div>
  );
}

export function DisplayCard({ loading }: { loading: boolean }) {
  const app = useApp();
  const t = app.t;
  const p = app.prefs;
  const [locating, setLocating] = useState(false);
  const { mutateAsync: savePrefs, isPending: saving } = useSavePreferences();

  const set = (patch: Partial<typeof p>) => app.setPrefs({ ...p, ...patch });

  async function save() {
    try {
      await savePrefs({
        show_energy_price: p.energy.on,
        energy_price_location: p.energy.zone,
        show_weather: p.weather.on,
        weather_location: p.weather.location,
        show_news: p.news.on,
        news_language: p.news.lang,
      });
      app.toast({ type: 'success', title: t.saved, msg: t.savedMsg });
    } catch {
      app.toast({
        type: 'error',
        title: t.saveFailed,
        msg: t.saveFailedMsg,
        persist: true,
        action: { label: t.retry, onClick: save },
      });
    }
  }

  function useLocation() {
    if (!navigator.geolocation) {
      app.toast({ type: 'error', title: t.saveFailed, msg: 'Geolocation is not supported by your browser.' });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude.toFixed(4);
        const lng = pos.coords.longitude.toFixed(4);
        set({ weather: { ...p.weather, location: `${lat}, ${lng}` } });
        setLocating(false);
      },
      () => {
        app.toast({ type: 'error', title: t.saveFailed, msg: 'Could not get your location. Check browser permissions.' });
        setLocating(false);
      },
      { timeout: 8000 }
    );
  }

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
            <div
              key={i}
              style={{ display: 'flex', gap: 14, alignItems: 'center', padding: '6px 0' }}
            >
              <Skeleton w={20} h={20} />
              <Skeleton w={38} h={38} style={{ borderRadius: 8 }} />
              <div style={{ flex: 1 }}>
                <Skeleton w="40%" h={14} />
                <Skeleton w="70%" h={11} style={{ marginTop: 7 }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          <SourceRow
            icon="bolt"
            name={t.srcEnergy}
            hint={t.srcEnergyHint}
            checked={p.energy.on}
            onToggle={() => set({ energy: { ...p.energy, on: !p.energy.on } })}
          >
            <div className="grid grid-cols-2 gap-[14px] max-[820px]:grid-cols-1">
              <Field label={t.zone} htmlFor="zone">
                <Select
                  id="zone"
                  value={p.energy.zone}
                  onChange={(e) =>
                    set({ energy: { ...p.energy, zone: e.target.value } })
                  }
                  options={[
                    { value: 'DK1', label: t.zoneDK1 },
                    { value: 'DK2', label: t.zoneDK2 },
                  ]}
                />
              </Field>
            </div>
            <div className="text-xs text-fg-3 flex items-center gap-[5px] [&_.material-symbols-outlined]:text-[15px]">
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
            <div className="grid grid-cols-2 gap-[14px] max-[820px]:grid-cols-1">
              <Field label={t.location} htmlFor="loc">
                <Input
                  id="loc"
                  mono
                  value={p.weather.location}
                  placeholder={t.locationPh}
                  onChange={(e) =>
                    set({ weather: { ...p.weather, location: e.target.value } })
                  }
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
            <div className="grid grid-cols-2 gap-[14px] max-[820px]:grid-cols-1">
              <Field label={t.contentLang} htmlFor="nl">
                <Select
                  id="nl"
                  value={p.news.lang}
                  onChange={(e) =>
                    set({ news: { ...p.news, lang: e.target.value } })
                  }
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
                  onChange={(e) =>
                    set({ news: { ...p.news, source: e.target.value } })
                  }
                  options={[
                    { value: 'dr', label: t.newsSrcDR },
                    { value: 'pol', label: t.newsSrcPolitiken },
                    { value: 'tv2', label: t.newsSrcTV2 },
                  ]}
                />
              </Field>
            </div>
          </SourceRow>
        </>
      )}
    </Card>
  );
}
