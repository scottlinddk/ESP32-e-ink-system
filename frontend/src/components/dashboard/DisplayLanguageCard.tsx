import React, { useEffect, useState } from 'react';
import { usePreferences, useSavePreferences } from '../../hooks/usePreferences';
import { useApp } from '../../lib/appContext';
import {
  DISPLAY_LANGUAGES, DISPLAY_LANGUAGE_EXAMPLES, DISPLAY_LANGUAGE_NAMES, displayLanguageOf, type DisplayLanguage,
} from '../../lib/displayLanguage';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Select } from '../ui/select';

export function DisplayLanguageCard({ deviceId }: { deviceId?: string }) {
  const { lang } = useApp();
  const da = lang === 'da';
  const preferences = usePreferences(deviceId);
  const save = useSavePreferences(deviceId);
  const saved = displayLanguageOf(preferences.data?.display_language);
  const [language, setLanguage] = useState<DisplayLanguage>(saved);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (preferences.data && !dirty) setLanguage(displayLanguageOf(preferences.data.display_language));
  }, [preferences.data, dirty]);

  function change(value: string) {
    const next = displayLanguageOf(value);
    setLanguage(next); setDirty(next !== saved); setMessage(''); setError('');
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(''); setMessage('');
    try {
      await save.mutateAsync({ display_language: language });
      setDirty(false);
      setMessage(da ? 'Skærmens sprog er gemt. Det vises ved næste opdatering.' : 'Display language saved. It shows on the next update.');
    } catch (failure) { setError((failure as Error).message); }
  }
  const disabled = preferences.isPending || preferences.isError || save.isPending || !deviceId;
  const options = DISPLAY_LANGUAGES.map((value) => ({ value, label: DISPLAY_LANGUAGE_NAMES[value] }));

  return <Card icon="translate" title={da ? 'Skærmens sprog' : 'Display language'}
    desc={da ? 'Vælg sproget for teksten i widgets på denne enhed.' : 'Choose the language of the text in widgets on this device.'}>
    <form onSubmit={submit} className="grid gap-3">
      <fieldset disabled={disabled} className="border-0 p-0 m-0 grid gap-3">
        <label htmlFor="display-language" className="grid gap-1 text-sm">{da ? 'Sprog' : 'Language'}
          <Select id="display-language" value={language} options={options} onChange={(event) => change(event.target.value)} />
        </label>
        <p className="text-xs text-fg2 m-0" lang={language} data-testid="display-language-example">{DISPLAY_LANGUAGE_EXAMPLES[language]}</p>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={save.isPending} disabled={!dirty || disabled}>{da ? 'Gem sprog' : 'Save language'}</Button>
        </div>
      </fieldset>
      <p className="text-xs text-fg2 m-0">{da
        ? 'Gælder labels, fejlbeskeder, vejrforhold samt ugedage og måneder, og skifter tal til komma som decimaltegn. Nyhedsoverskrifter følger deres kilde, og egen tekst, aktiekurser og webappen ændres ikke.'
        : 'Applies to labels, error messages, weather conditions, weekday and month names, and switches numbers to a decimal comma. News headlines follow their source; your own text, stock tickers and the web app are not changed.'}</p>
      {preferences.isError && <p role="alert">{da ? 'Kunne ikke indlæse skærmens sprog.' : 'Could not load the saved display language.'}</p>}
      {error && <p role="alert" className="text-sm text-warning m-0">{error}</p>}
      {message && <p role="status" className="text-sm m-0">{message}</p>}
    </form>
  </Card>;
}
