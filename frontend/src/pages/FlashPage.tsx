import 'esp-web-tools';
import { useEffect, useRef, useState } from 'react';
import { loadPublicFirmwareManifest, type ElecrowPanel } from '../lib/firmwareManifest';

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'esp-web-install-button': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & { manifest?: string }, HTMLElement>;
    }
  }
}

export function FlashPage() {
  const secure = window.isSecureContext;
  const supported = 'serial' in navigator;
  const [panel, setPanel] = useState<ElecrowPanel | ''>('');
  const [manifestUrl, setManifestUrl] = useState<string | null>(null);
  const [version, setVersion] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setManifestUrl(null);
    setError('');
    setVersion('');
    if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
    if (panel) {
      loadPublicFirmwareManifest(panel, controller.signal).then(manifest => {
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: 'application/json' }));
        blobUrlRef.current = url;
        setManifestUrl(url);
        setVersion(manifest.version ?? '');
      }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Firmware download failed'); });
    }
    return () => { controller.abort(); };
  }, [panel, attempt]);
  useEffect(() => () => { if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current); }, []);

  return (
    <main className="max-w-[760px] mx-auto px-6 py-10 text-fg1">
      <h1 className="text-h2 mb-3">Install ESP32 E-Ink firmware</h1>
      <p className="mb-6 text-fg2">Flash your Elecrow CrowPanel 2.13-inch e-paper display through USB, then connect it to Wi-Fi for automatic dashboard updates.</p>

      {!secure ? <p role="alert" className="mb-5 text-error">Open this page over HTTPS or on localhost. Browsers block USB flashing on ordinary HTTP addresses, including a Raspberry Pi LAN address.</p>
        : !supported && <p role="alert" className="mb-5 text-error">Use Chrome or Edge on a desktop computer. This browser does not provide Web Serial.</p>}

      <section className="border border-divider rounded-md p-5 mb-6">
        <h2 className="text-h5 mb-3">1. Connect and select your hardware</h2>
        <p className="mb-3">Use a USB data cable and turn the display power switch on. Close Arduino, PlatformIO, and other serial monitors before connecting.</p>
        <label htmlFor="panel" className="block font-medium mb-2">Display revision</label>
        <select id="panel" value={panel} onChange={event => setPanel(event.target.value as ElecrowPanel | '')} className="select-native w-full p-3 border border-border-strong rounded-sm bg-surface text-fg1">
          <option value="">Check your board label and select a revision…</option>
          <option value="original">CrowPanel 2.13 original — SSD1680 (or ESP32 + Waveshare 2.13 V2)</option>
          <option value="v12">CrowPanel 2.13 V1.2 — JD79661</option>
        </select>
        <p className="mt-3 text-sm text-fg2">Both CrowPanel revisions use ESP32-S3. USB detection cannot distinguish their display controllers. Check the product revision before installing.</p>
        {panel && !manifestUrl && !error && <p role="status" className="mt-4">Checking the firmware release…</p>}
        {error && <div role="alert" className="mt-4"><p>{error}</p><button className="underline mt-2" onClick={() => setAttempt(value => value + 1)}>Retry</button></div>}
        {manifestUrl && secure && supported && <div className="mt-4"><p className="text-sm mb-3">Firmware: {version}. For a first installation or recovery, choose erase when prompted. These factory images replace saved Wi-Fi and device credentials even without erase. Keep your device UUID and token ready and repeat setup after installing.</p><esp-web-install-button key={panel} manifest={manifestUrl}><button slot="activate" className="bg-accent text-fg-on px-5 py-3 rounded-sm">Install firmware</button></esp-web-install-button></div>}
      </section>

      <section className="border border-divider rounded-md p-5 mb-6">
        <h2 className="text-h5 mb-3">2. Create your device credentials</h2>
        <p className="mb-3">On the <a className="underline" href="/devices">Devices page</a>, add a display. Expand <strong>Automatic updates</strong>, create a device token, and copy the API URL, device UUID, and token. The token is shown only once.</p>
        <p className="text-sm text-fg2">Keep these values ready before joining the display setup network, which has no internet access.</p>
      </section>

      <section className="border border-divider rounded-md p-5 mb-6">
        <h2 className="text-h5 mb-3">3. Configure Wi-Fi</h2>
        <ol className="list-decimal pl-5 space-y-2">
          <li>After installation, press RESET if the board remains in download mode.</li>
          <li>Join the display Wi-Fi network named <code>ESP32-Display-XXXXXX</code>. Stay connected when your computer or phone warns that it has no internet.</li>
          <li>Open <a className="underline" href="http://192.168.4.1" target="_blank" rel="noreferrer">http://192.168.4.1</a> if the setup page does not open automatically.</li>
          <li>Enter your 2.4 GHz Wi-Fi details and the API URL, device UUID, and device token from Automatic updates. Use Show Wi-Fi password to check your entry, then save to restart.</li>
          <li>Reconnect your computer to your normal network. Saving confirms that settings were stored; it does not verify the connection. Save your dashboard layout and check <strong>Last report</strong> under Devices → Automatic updates.</li>
        </ol>
        <p className="mt-3 text-sm text-fg2">If no report appears, open the USB installer's <strong>Logs &amp; Console</strong> at 115200 baud and reset the board. If the setup network returns, join it again to read the connection error. Authentication failures can mean an incorrect password or incompatible access point security settings.</p>
        <p className="mt-3 text-sm text-fg2">This firmware uses the Wi-Fi setup portal. Bluetooth configuration and “Push to Display” apply only to separately installed OpenDisplay firmware.</p>
      </section>

      <section className="border border-divider rounded-md p-5">
        <h2 className="text-h5 mb-3">If the serial connection fails</h2>
        <ul className="list-disc pl-5 space-y-2">
          <li>Try another data cable and USB port. Check Windows Device Manager or your system USB device list for a serial port.</li>
          <li>Hold BOOT, press and release RESET, then release BOOT. Click Install and select the newly appearing USB serial port. After flashing, press RESET with BOOT released.</li>
          <li>The CrowPanel USB-to-UART bridge may need a WCH driver. Match the detected bridge: <a className="underline" href="https://www.wch-ic.com/downloads/CH341SER_EXE.html" target="_blank" rel="noreferrer">CH340/CH341</a> or <a className="underline" href="https://www.wch-ic.com/downloads/CH343SER_EXE.html" target="_blank" rel="noreferrer">CH343/CH9102</a>. Other ESP32 boards may use <a className="underline" href="https://www.silabs.com/developer-tools/usb-to-uart-bridge-vcp-drivers" target="_blank" rel="noreferrer">CP210x</a>.</li>
          <li>If flashing completes but setup never appears, open the installer logs at 115200 baud after reset. Recheck the selected display revision.</li>
        </ul>
        <p className="mt-4 text-sm"><a className="underline" href="https://github.com/scottlinddk/ESP32-e-ink-system/tree/main/firmware" target="_blank" rel="noreferrer">Firmware source and hardware guide</a></p>
      </section>
    </main>
  );
}
