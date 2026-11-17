import React, { useState } from 'react';
import { Button } from '../ui/button';
import { buildPluginZip, canPickDirectory, PLUGIN_DIR, validateKindleSettings, writePluginToKindle, type DirectoryLike, type KindleSettings } from '../../lib/kindle/plugin';

const GUIDE = 'https://github.com/scottlinddk/ESP32-e-ink-system/blob/main/docs/KINDLE_KOREADER.md';

/**
 * Builds the KOReader plugin with this device's settings filled in. The token is only known right after
 * it was created, so this is shown next to it. Nothing here is sent anywhere: the archive is built in the browser.
 */
export function KindleSetupCard({ apiUrl, deviceId, token, da }: KindleSettings & { da: boolean }) {
  const settings = { apiUrl, deviceId, token };
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const invalid = validateKindleSettings(settings);
  const report = (text: string, error = false) => { setMessage(text); setFailed(error); };

  function download() {
    try {
      const url = URL.createObjectURL(new Blob([buildPluginZip(settings) as BlobPart], { type: 'application/zip' }));
      const link = document.createElement('a');
      link.href = url; link.download = `${PLUGIN_DIR}.zip`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      report(da ? 'Pakken er hentet. Udpak den, og læg mappen i koreader/plugins på Kindle.' : 'Downloaded. Unzip it and put the folder in koreader/plugins on the Kindle.');
    } catch (error) { report((error as Error).message, true); }
  }

  async function copy() {
    try {
      const picker = (window as unknown as { showDirectoryPicker: (options: { mode: 'readwrite' }) => Promise<DirectoryLike> }).showDirectoryPicker;
      const picked = await picker.call(window, { mode: 'readwrite' });
      const count = await writePluginToKindle(picked, settings);
      report(da ? `${count} filer er skrevet til Kindle. Skub Kindle ud, og genstart KOReader.` : `${count} files written to the Kindle. Eject it and restart KOReader.`);
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      report(`${(error as Error).message} ${da ? 'Hent pakken som ZIP i stedet.' : 'Download the ZIP instead.'}`, true);
    }
  }

  return (
    <div className="grid gap-2 border border-divider rounded-md p-3">
      <strong>{da ? 'Kindle Paperwhite og andre KOReader-læsere' : 'Kindle Paperwhite and other KOReader e-readers'}</strong>
      <p className="m-0 text-fg2">{da
        ? 'En jailbroken Kindle med KOReader kan vise dette display. Pakken indeholder pluginet med API URL, UUID og token allerede udfyldt, så intet skal skrives på Kindle.'
        : 'A jailbroken Kindle running KOReader can show this display. The package contains the plugin with the API URL, UUID and token already filled in, so nothing needs typing on the Kindle.'}</p>
      <p className="m-0 text-fg2">{da
        ? 'Sæt skærmprofilen til Kindles skærm (Paperwhite 5: 1236 × 1648) under Skærmstørrelse og orientering.'
        : 'Set the display profile to the Kindle screen (Paperwhite 5: 1236 × 1648) under Display size and orientation.'}</p>
      <div className="flex gap-2 flex-wrap">
        <Button size="sm" disabled={Boolean(invalid)} onClick={download}>{da ? 'Hent Kindle-pakke (ZIP)' : 'Download Kindle package (ZIP)'}</Button>
        {canPickDirectory() && <Button size="sm" variant="text" disabled={Boolean(invalid)} onClick={() => { void copy(); }}>{da ? 'Kopiér direkte til Kindle…' : 'Copy straight to the Kindle…'}</Button>}
      </div>
      {invalid && <p role="alert" className="m-0">{invalid}</p>}
      {message && <p role={failed ? 'alert' : 'status'} className="m-0">{message}</p>}
      <p className="m-0 text-fg2">{da
        ? 'Filen config.txt indeholder tokenet. Del den ikke. Pakken bygges i browseren og sendes ingen steder hen.'
        : 'The config.txt file contains the token. Do not share it. The package is built in your browser and sent nowhere.'}</p>
      <a className="text-accent underline" href={GUIDE} target="_blank" rel="noreferrer">{da ? 'Vejledning: jailbreak, KOReader og plugin' : 'Guide: jailbreak, KOReader and the plugin'}</a>
    </div>
  );
}
