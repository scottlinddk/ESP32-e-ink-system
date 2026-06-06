import { useEffect, useRef, useState } from 'react';
import { useApp } from '../lib/appContext';

export function FlashPage() {
  const { t } = useApp();
  useEffect(() => { import('esp-web-tools'); }, []);

  const webSerialSupported = typeof navigator !== 'undefined' && 'serial' in navigator;

  const [manifestUrl, setManifestUrl] = useState('/firmware/manifest.json');
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/firmware/public-manifest');
        if (!res.ok) throw new Error('not ok');
        const manifest = await res.json();
        if (cancelled) return;
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(manifest)], { type: 'application/json' })
        );
        blobUrlRef.current = url;
        setManifestUrl(url);
      } catch {
        // Fall back to static manifest silently
      }
    })();
    return () => {
      cancelled = true;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  const steps = [
    t.flashStep1,
    t.flashStep2,
    t.flashStep3,
    t.flashStep4,
    t.flashStep5,
    t.flashStep6,
    t.flashStep7,
    t.flashStep8,
  ];

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '40px 16px', fontFamily: 'sans-serif' }}>
      <h1 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: 8 }}>
        {t.flashTitle}
      </h1>
      <p style={{ color: '#555', marginBottom: 32 }}>
        {t.flashSub}
      </p>

      {/* Before you begin: driver install */}
      <div
        style={{
          background: 'rgba(128,128,128,0.07)',
          border: '1px solid rgba(128,128,128,0.2)',
          borderRadius: 8,
          padding: '16px 20px',
          marginBottom: 24,
        }}
      >
        <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 8px' }}>
          {t.flashDriverTitle}
        </h2>
        <p style={{ margin: '0 0 10px', fontSize: '0.9rem', color: '#444' }}>
          {t.flashDriverBody}
        </p>
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: '0.875rem', lineHeight: 1.8 }}>
          <li>
            <strong>macOS:</strong>{' '}
            {t.flashDriverMac}{' '}
            <a href="https://www.wch-ic.com/downloads/CH34XSER_MAC_ZIP.html" target="_blank" rel="noopener noreferrer">
              CH34x (WCH)
            </a>
            {' / '}
            <a href="https://www.silabs.com/developer-tools/usb-to-uart-bridge-vcp-drivers" target="_blank" rel="noopener noreferrer">
              CP210x (Silicon Labs)
            </a>
          </li>
          <li><strong>Windows:</strong> {t.flashDriverWin}</li>
          <li><strong>Linux:</strong> {t.flashDriverLinux}</li>
        </ul>
        <p style={{ margin: '10px 0 0', fontSize: '0.875rem', color: '#666', fontStyle: 'italic' }}>
          {t.flashNoPortHint}
        </p>
      </div>

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
        <esp-web-install-button manifest={manifestUrl} />
      </div>

      <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 12 }}>{t.flashStepsTitle}</h2>
      <ol style={{ paddingLeft: 20, lineHeight: 1.9, color: '#333' }}>
        {steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>

      <p style={{ marginTop: 24, fontSize: '0.85rem', color: '#888' }}>
        {t.flashEraseNote}
      </p>
    </div>
  );
}

export default FlashPage;
