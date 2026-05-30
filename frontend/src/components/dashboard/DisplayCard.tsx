// =========================================================================
// DisplayCard.tsx — "What to display" source toggles
// =========================================================================
import React, { useState, ReactNode } from 'react';
import { useApp } from '../../lib/appContext';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Field } from '../ui/Field';
import { Input } from '../ui/input';
import { Select } from '../ui/select';
import { Checkbox } from '../ui/checkbox';
import { Skeleton } from '../ui/Spinner';
import { Icon } from '../ui/Logo';

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
    <div className={'source' + (checked ? ' is-on' : '')}>
      <label className="source__top" htmlFor={id}>
        <Checkbox id={id} checked={checked} onChange={onToggle} label={name} />
        <span className="source__icon">
          <Icon name={icon} />
        </span>
        <span className="source__text">
          <span className="source__name">{name}</span>
          <span className="source__hint">{hint}</span>
        </span>
      </label>
      {checked && <div className="source__detail">{children}</div>}
    </div>
  );
}

export function DisplayCard({ loading }: { loading: boolean }) {
  const app = useApp();
  const t = app.t;
  const p = app.prefs;
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);

  const set = (patch: Partial<typeof p>) => app.setPrefs({ ...p, ...patch });

  function save() {
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      if (!app.online) {
        app.toast({
          type: 'error',
          title: t.saveFailed,
          msg: t.saveFailedMsg,
          persist: true,
          action: { label: t.retry, onClick: save },
        });
      } else {
        app.toast({ type: 'success', title: t.saved, msg: t.savedMsg });
      }
    }, 1300);
  }

  function useLocation() {
    setLocating(true);
    setTimeout(() => {
      setLocating(false);
      set({ weather: { ...p.weather, location: '57.05, 9.92' } });
    }, 1200);
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
        <div className="stack">
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
            <div className="source__detail-grid">
              <Field label={t.zone} htmlFor="zone">
                <Select
                  id="zone"
                  value={p.energy.zone}
                  onChange={(e) =>
                    set({ energy: { ...p.energy, zone: e.target.value } })
                  }
                  options={[
                    { value: 'DK1', label: 'DK1 — Vest for Storebælt' },
                    { value: 'DK2', label: 'DK2 — Øst for Storebælt' },
                  ]}
                />
              </Field>
            </div>
            <div className="helper">
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
            <div className="source__detail-grid">
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
              <Field label={' '}>
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
            <div className="source__detail-grid">
              <Field label={t.contentLang} htmlFor="nl">
                <Select
                  id="nl"
                  value={p.news.lang}
                  onChange={(e) =>
                    set({ news: { ...p.news, lang: e.target.value } })
                  }
                  options={[
                    { value: 'da', label: 'Dansk' },
                    { value: 'en', label: 'English' },
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
                    { value: 'dr', label: 'DR Nyheder' },
                    { value: 'pol', label: 'Politiken' },
                    { value: 'tv2', label: 'TV 2' },
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
