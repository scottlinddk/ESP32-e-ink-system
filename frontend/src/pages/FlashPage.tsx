import 'esp-web-tools';
import { useEffect, useRef, useState } from 'react';
import { BleDeviceConfig } from '../components/BleDeviceConfig';

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
  'Install the USB driver for your board (see "Before you begin" above), then connect your ESP32-S3 via USB.',
  'Click "Install Firmware" below.',
  'In the browser dialog, select the serial port — it will look like /dev/cu.usbserial-… on Mac or COM3 on Windows.',
  'Wait for the flash to complete (about 30 seconds). The device reboots and begins BLE advertising as "OD…".',
  'Click "Configure via Bluetooth" below, enter your WiFi credentials, and select the device from the browser Bluetooth picker.',
  'The device connects to your WiFi network within ~10 seconds.',
  'Add your device on the Devices page using the BLE name shown (e.g. OD4A2B3C).',
  'Use "Push to Display" on the Dashboard to send your first image over Bluetooth.',
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
        // Only use the dynamic manifest if it covers ESP32-S3; otherwise the
        // static fallback (which pins a known-good release with both chips) is safer.
        const hasS3 = Array.isArray(manifest.builds) &&
          manifest.builds.some((b: { chipFamily?: string }) => b.chipFamily === 'ESP32-S3');
        if (!hasS3) throw new Error('ESP32-S3 build missing from dynamic manifest');
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
        Flash OpenDisplay Firmware
      </h1>
      <p style={{ color: '#555', marginBottom: 32 }}>
        Install OpenDisplay firmware on your ESP32-S3 directly from your browser,
        then configure WiFi over Bluetooth. Chrome or Edge on desktop required.
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

      <div style={{ marginBottom: 32 }}>
        <p style={{ marginBottom: 8, fontWeight: 600, fontSize: '0.95rem' }}>
          Step 2 — Configure WiFi over Bluetooth
        </p>
        <p style={{ color: '#555', fontSize: '0.875rem', marginBottom: 12 }}>
          After flashing, use the button below to send your WiFi credentials to the device via Web Bluetooth.
          The device must be powered on and BLE advertising (name starts with "OD").
        </p>
        <BleDeviceConfig />
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
        Re-flashing erases the device config, so you will need to re-send WiFi credentials
        via "Configure via Bluetooth" after each firmware update.
      </p>
    </div>
  );
}
