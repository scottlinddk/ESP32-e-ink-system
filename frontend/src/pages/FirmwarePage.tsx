import React, { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '../lib/appContext';
import { useAuth } from '../hooks/useAuth';
import { getFirmwareVersions, createFirmwareVersion, getFirmwareManifest } from '../lib/api';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Field } from '../components/ui/Field';
import { Input } from '../components/ui/input';
import { LoadBox } from '../components/ui/Spinner';
import { Empty } from '../components/ui/Empty';
import { Icon } from '../components/ui/Logo';
import type { FirmwareVersion } from '../types';
import 'esp-web-tools';

export function FirmwarePage() {
  const app = useApp();
  const t = app.t;
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ version: '', downloadPath: '', checksum: '', notes: '' });

  // Flash assistant state
  const [selectedFwId, setSelectedFwId] = useState('');
  const [manifestBlobUrl, setManifestBlobUrl] = useState<string | null>(null);
  const [manifestLoading, setManifestLoading] = useState(false);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const supportsWebSerial = 'serial' in navigator;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['firmware_versions'],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return getFirmwareVersions(token);
    },
  });

  const firmwareVersions = data?.firmware_versions ?? [];

  const createMutation = useMutation({
    mutationFn: async (payload: {
      version: string;
      download_path: string;
      checksum?: string;
      release_notes?: string;
    }) => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return createFirmwareVersion(token, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['firmware_versions'] });
      setForm({ version: '', downloadPath: '', checksum: '', notes: '' });
      app.toast({ type: 'success', title: t.fwVersionCreated });
    },
    onError: (err: Error) => {
      app.toast({ type: 'error', title: err.message });
    },
  });

  // Fetch manifest and convert to blob URL when version is selected
  useEffect(() => {
    if (!selectedFwId) {
      setManifestBlobUrl(null);
      return;
    }
    let cancelled = false;
    setManifestLoading(true);
    setManifestError(null);
    setManifestBlobUrl(null);
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    (async () => {
      try {
        const token = await getToken();
        if (!token) throw new Error('Not authenticated');
        const manifest = await getFirmwareManifest(token, selectedFwId);
        if (cancelled) return;
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(manifest)], { type: 'application/json' })
        );
        blobUrlRef.current = url;
        setManifestBlobUrl(url);
      } catch (err) {
        if (!cancelled) setManifestError((err as Error).message);
      } finally {
        if (!cancelled) setManifestLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedFwId]);

  // Revoke blob URL on unmount
  useEffect(() => () => {
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
  }, []);

  function submit() {
    createMutation.mutate({
      version: form.version,
      download_path: form.downloadPath,
      checksum: form.checksum || undefined,
      release_notes: form.notes || undefined,
    });
  }

  return (
    <div className="page">
      <header className="page__head">
        <div>
          <h1 className="page__title">{t.fwTitle}</h1>
          <p className="page__sub">{t.fwSub}</p>
        </div>
      </header>

      {/* Firmware versions list */}
      <Card flat>
        {isLoading ? (
          <LoadBox text={t.loadingFirmware} />
        ) : error ? (
          <Empty
            icon="wifi_off"
            title={t.fwFetchError}
            text={t.fwFetchErrorMsg}
            action={
              <Button icon="refresh" onClick={() => refetch()}>
                {t.retry}
              </Button>
            }
          />
        ) : firmwareVersions.length === 0 ? (
          <Empty
            icon="cloud_upload"
            title={t.fwEmpty}
            text={t.fwEmptyMsg}
            action={
              <Button onClick={() => setForm({ version: '1.0.1', downloadPath: '', checksum: '', notes: '' })}>
                {t.fwCreateFirst}
              </Button>
            }
          />
        ) : (
          firmwareVersions.map((item) => (
            <div className="device" key={item.id}>
              <div className="device__glyph">
                <Icon name="download" />
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="device__name">
                  {t.fwVersion} <b>{item.version}</b>
                  {item.active && <span className="chip chip--success">{t.fwActive}</span>}
                </div>
                <div className="device__rows">
                  <span className="device__kv">
                    {t.fwDownloadPath} <b>{item.download_path}</b>
                  </span>
                  <span className="device__kv">
                    {t.fwChecksum} <b>{item.checksum || t.fwNone}</b>
                  </span>
                  <span className="device__kv">
                    {t.fwCreatedAt} <b>{new Date(item.created_at).toLocaleString(app.t.locale)}</b>
                  </span>
                  {item.release_notes ? (
                    <span className="device__kv">
                      {t.fwNotes} <b>{item.release_notes}</b>
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          ))
        )}
      </Card>

      {/* Create release form */}
      <Card flat style={{ marginTop: 24 }}>
        <div className="stack">
          <Field label={t.fwFormVersion} htmlFor="fw-version">
            <Input
              id="fw-version"
              value={form.version}
              placeholder="1.0.1"
              onChange={(e) => setForm({ ...form, version: e.target.value })}
            />
          </Field>
          <Field label={t.fwFormDownloadPath} htmlFor="fw-download-path" helper={t.fwFormDownloadHint}>
            <Input
              id="fw-download-path"
              value={form.downloadPath}
              placeholder="https://cdn.example.com/firmware.bin"
              onChange={(e) => setForm({ ...form, downloadPath: e.target.value })}
            />
          </Field>
          <Field label={t.fwFormChecksum} htmlFor="fw-checksum">
            <Input
              id="fw-checksum"
              value={form.checksum}
              placeholder="Optional SHA256 checksum"
              onChange={(e) => setForm({ ...form, checksum: e.target.value })}
            />
          </Field>
          <Field label={t.fwFormNotes} htmlFor="fw-notes">
            <Input
              id="fw-notes"
              value={form.notes}
              placeholder={t.fwFormNotesPh}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Field>
          <Button onClick={submit} loading={createMutation.isPending}>
            {t.fwCreateRelease}
          </Button>
        </div>
      </Card>

      {/* Flash device assistant */}
      <Card flat style={{ marginTop: 24 }}>
        <div className="stack">
          <div>
            <div className="section__title">{t.fwFlashTitle}</div>
            <p className="muted" style={{ marginTop: 4 }}>{t.fwFlashSub}</p>
          </div>
          {!supportsWebSerial && (
            <div className="info-banner">
              <Icon name="warning" /> {t.fwFlashBrowserNote}
            </div>
          )}
          {firmwareVersions.length === 0 ? (
            <p className="muted">{t.fwFlashNoVersions}</p>
          ) : (
            <>
              <Field label={t.fwFlashSelectVersion} htmlFor="flash-version">
                <select
                  id="flash-version"
                  className="input"
                  value={selectedFwId}
                  onChange={(e) => setSelectedFwId(e.target.value)}
                >
                  <option value="">{t.fwFlashSelectPlaceholder}</option>
                  {firmwareVersions.map((fw) => (
                    <option key={fw.id} value={fw.id}>
                      v{fw.version}{fw.active ? ' ★' : ''}
                    </option>
                  ))}
                </select>
              </Field>
              <ol className="flash-steps">
                {[t.fwFlashStep1, t.fwFlashStep2, t.fwFlashStep3].map((step, i) => (
                  <li key={i} className="flash-step">
                    <span className="flash-step__num">{i + 1}</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
              {selectedFwId && (
                <div className="flash-action">
                  {manifestLoading && (
                    <span className="muted">{t.fwFlashManifestLoading}</span>
                  )}
                  {manifestError && (
                    <div className="info-banner">
                      <Icon name="error" /> {t.fwFlashManifestError}
                    </div>
                  )}
                  {manifestBlobUrl && !manifestLoading && (
                    <esp-web-install-button manifest={manifestBlobUrl} />
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
