import 'esp-web-tools';
import { useEffect, useRef, useState } from 'react';

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'esp-web-install-button': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & { manifest?: string },
        HTMLElement
      >;
    }
  }
}

const steps = [
  'Install the USB driver for your board (see "Before you begin" above), then connect your ESP32 via USB.',
  'Click "Install Firmware" below.',
  'In the browser dialog, select the serial port — it will look like /dev/cu.usbserial-… on Mac or COM3 on Windows. Do not select a Bluetooth entry.',
  'Wait for the flash to complete (about 30 seconds).',
  'The device will reboot and broadcast a WiFi network named ESP32-Display-XXXXXX.',
  'Connect your phone or laptop to that network — a setup page opens automatically.',
  'Enter your home WiFi credentials and API URL, then tap Save.',
  'The device connects to WiFi, self-provisions with the backend, and starts updating within 60 seconds.',
];

export function FlashPage() {
  const webSerialSupported = 'serial' in navigator;
  const [manifestUrl, setManifestUrl] = useState<string>('/firmware/manifest.json');
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/firmware/public-manifest');
        if (!res.ok) throw new Error('Not available');
        const manifest = await res.json();
        if (cancelled) return;
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(manifest)], { type: 'application/json' })
        );
        blobUrlRef.current = url;
        setManifestUrl(url);
      } catch {
        // Fall back to static manifest
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => () => {
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
  }, []);

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '40px 16px', fontFamily: 'sans-serif' }}>
      <h1 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: 8 }}>
        Flash ESP32 E-Ink Display Firmware
      </h1>
      <p style={{ color: '#555', marginBottom: 32 }}>
        Install the latest firmware directly from your browser — no IDE required.
        Chrome or Edge on desktop required (Web Serial API).
      </p>

      {!webSerialSupported && (
        <div
          style={{
            background: '#fff3cd',
            border: '1px solid #ffc107',
            borderRadius: 6,
            padding: '12px 16px',
            marginBottom: 24,
            color: '#856404',
          }}
        >
          <strong>Browser not supported.</strong> Web Serial requires Chrome or Edge on
          desktop. Safari, Firefox, and mobile browsers are not supported.
        </div>
      )}

      <div
        style={{
          background: '#f0f4ff',
          border: '1px solid #c7d7ff',
          borderRadius: 8,
          padding: '16px 20px',
          marginBottom: 32,
        }}
      >
        <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 10px' }}>
          Before you begin — install the USB driver
        </h2>
        <p style={{ margin: '0 0 10px', color: '#333', fontSize: '0.9rem' }}>
          Most ESP32 boards use a CH340 or CP210x USB-to-serial chip. Without the driver,
          the device won't appear in the browser's port picker.
        </p>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #c7d7ff' }}>
              <th style={{ textAlign: 'left', padding: '4px 8px 4px 0', color: '#555' }}>Chip</th>
              <th style={{ textAlign: 'left', padding: '4px 8px', color: '#555' }}>macOS</th>
              <th style={{ textAlign: 'left', padding: '4px 8px', color: '#555' }}>Windows</th>
              <th style={{ textAlign: 'left', padding: '4px 8px', color: '#555' }}>Linux</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: '4px 8px 4px 0' }}>CH340 / CH341</td>
              <td style={{ padding: '4px 8px' }}>
                <a href="https://www.wch-ic.com/downloads/CH34XSER_MAC_ZIP.html" target="_blank" rel="noreferrer">
                  WCH CH34x driver
                </a>
              </td>
              <td style={{ padding: '4px 8px', color: '#555' }}>Auto via Windows Update</td>
              <td style={{ padding: '4px 8px', color: '#555' }}>Built-in</td>
            </tr>
            <tr>
              <td style={{ padding: '4px 8px 4px 0' }}>CP2102 / CP2104</td>
              <td style={{ padding: '4px 8px' }}>
                <a href="https://www.silabs.com/developer-tools/usb-to-uart-bridge-vcp-drivers" target="_blank" rel="noreferrer">
                  Silicon Labs driver
                </a>
              </td>
              <td style={{ padding: '4px 8px', color: '#555' }}>Auto via Windows Update</td>
              <td style={{ padding: '4px 8px', color: '#555' }}>Built-in</td>
            </tr>
          </tbody>
        </table>
        <p style={{ margin: '10px 0 0', fontSize: '0.85rem', color: '#555' }}>
          After installing, unplug and replug the USB cable, then come back here.
        </p>
      </div>

      <div style={{ marginBottom: 16 }}>
        <esp-web-install-button manifest={manifestUrl} />
      </div>

      <div
        style={{
          background: '#fffbe6',
          border: '1px solid #ffe58f',
          borderRadius: 6,
          padding: '10px 14px',
          marginBottom: 32,
          fontSize: '0.875rem',
          color: '#7d5800',
        }}
      >
        <strong>Don't see a serial port in the picker?</strong> Install the USB driver above, unplug
        and replug the cable, then try again. Make sure you're on Chrome or Edge and not selecting a
        Bluetooth entry.
      </div>

      <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 12 }}>Setup steps</h2>
      <ol style={{ paddingLeft: 20, lineHeight: 1.9, color: '#333' }}>
        {steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>

      <p style={{ marginTop: 24, fontSize: '0.85rem', color: '#888' }}>
        Re-flashing erases NVS storage, so you will need to go through WiFi setup again
        after each firmware update.
      </p>
    </div>
  );
}
