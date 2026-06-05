import { useEffect } from 'react';

const steps = [
  'Connect your ESP32 via USB to your computer.',
  'Click "Install Firmware" below.',
  'Select the correct serial port when the browser prompts you.',
  'Wait for the flash to complete (about 30 seconds).',
  'The device will reboot and broadcast a WiFi network named ESP32-Display-XXXXXX.',
  'Connect your phone or laptop to that network — a setup page opens automatically.',
  'Enter your home WiFi credentials and API URL, then tap Save.',
  'The device connects to WiFi, self-provisions with the backend, and starts updating within 60 seconds.',
];

export function FlashPage() {
  useEffect(() => { import('esp-web-tools'); }, []);
  const webSerialSupported = typeof navigator !== 'undefined' && 'serial' in navigator;

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

      <div style={{ marginBottom: 32 }}>
        <esp-web-install-button manifest="/firmware/manifest.json" />
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

export default FlashPage;
