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
import { Chip } from '../components/ui/Chip';
import type { FirmwareVersion } from '../types';

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
  const hasAutoSelected = useRef(false);
  useEffect(() => { import('esp-web-tools'); }, []);
  const supportsWebSerial = typeof navigator !== 'undefined' && 'serial' in navigator;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['firmware_versions'],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      return getFirmwareVersions(token);
    },
  });

  const firmwareVersions = data?.firmware_versions ?? [];
  const defaultFw = firmwareVersions.find((fw) => fw.is_default);
  const userVersions = firmwareVersions.filter((fw) => !fw.is_default);

  // Auto-select the active default firmware on first load so users can flash immediately.
  useEffect(() => {
    if (!hasAutoSelected.current && defaultFw?.active) {
      hasAutoSelected.current = true;
      setSelectedFwId('default');
    }
  }, [defaultFw?.active]);

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

  function renderFirmwareItem(item: FirmwareVersion) {
    return (
      <div
        className="grid grid-cols-[48px_1fr_auto] gap-4 px-5 py-4 items-center border-t border-divider first:border-t-0 max-[560px]:grid-cols-1"
        key={item.id}
      >
        <div className="w-12 h-12 rounded-lg bg-[rgba(128,128,128,0.1)] text-fg-2 flex items-center justify-center [&_.material-symbols-outlined]:text-2xl">
          <Icon name={item.is_default ? 'deployed_code' : 'download'} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="text-base font-medium flex items-center gap-[10px] flex-wrap">
            {t.fwVersion} <b>{item.version}</b>
            {item.is_default && (
              <Chip variant="info">{t.fwDefaultBadge}</Chip>
            )}
            {item.is_default && item.active && (
              <Chip variant="success">{t.fwDefaultReady}</Chip>
            )}
            {item.active && !item.is_default && (
              <Chip variant="success">{t.fwActive}</Chip>
            )}
            {item.is_default && !item.active && (
              <Chip variant="warning" title={t.fwDefaultNotBuilt}>
                {t.fwDefaultNotBuilt}
              </Chip>
            )}
          </div>
          <div className="flex flex-wrap gap-x-[18px] gap-y-1 mt-1.5">
            <span className="text-xs text-fg-2 flex items-center gap-1.5 [&_b]:font-normal [&_b]:text-fg-1 [&_b]:font-mono">
              {t.fwDownloadPath} <b>{item.download_path}</b>
            </span>
            {!item.is_default && (
              <span className="text-xs text-fg-2 flex items-center gap-1.5 [&_b]:font-normal [&_b]:text-fg-1 [&_b]:font-mono">
                {t.fwChecksum} <b>{item.checksum || t.fwNone}</b>
              </span>
            )}
            {!item.is_default && (
              <span className="text-xs text-fg-2 flex items-center gap-1.5 [&_b]:font-normal [&_b]:text-fg-1 [&_b]:font-mono">
                {t.fwCreatedAt} <b>{new Date(item.created_at).toLocaleString(app.t.locale)}</b>
              </span>
            )}
            {item.release_notes ? (
              <span className="text-xs text-fg-2 flex items-center gap-1.5 [&_b]:font-normal [&_b]:text-fg-1 [&_b]:font-mono">
                {t.fwNotes} <b>{item.release_notes}</b>
              </span>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1180px] mx-auto px-6 pt-8 pb-20 animate-page-enter">
      <header className="mb-5">
        <div>
          <h1 className="text-[2rem] font-light tracking-tight m-0 mb-1.5">{t.fwTitle}</h1>
          <p className="text-fg-2 text-base m-0">{t.fwSub}</p>
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
        ) : (
          <>
            {defaultFw && renderFirmwareItem(defaultFw)}
            {userVersions.length === 0 && !defaultFw ? (
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
              userVersions.map((item) => renderFirmwareItem(item))
            )}
          </>
        )}
      </Card>

      {/* Create release form */}
      <Card flat style={{ marginTop: 24 }}>
        <div className="flex flex-col gap-4">
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
        <div className="flex flex-col gap-4">
          <div>
            <div className="text-base font-medium">{t.fwFlashTitle}</div>
            <p className="text-fg-2 text-sm m-0" style={{ marginTop: 4 }}>{t.fwFlashSub}</p>
          </div>
          {!supportsWebSerial && (
            <div className="flex gap-[10px] items-start px-[14px] py-3 rounded bg-info/[0.08] text-fg-2 text-sm leading-[1.5] [&_.material-symbols-outlined]:text-[19px] [&_.material-symbols-outlined]:text-info [&_.material-symbols-outlined]:flex-shrink-0 [&_.material-symbols-outlined]:mt-[1px]">
              <Icon name="warning" /> {t.fwFlashBrowserNote}
            </div>
          )}
          {!firmwareVersions.some((fw) => fw.active) ? (
            <p className="text-fg-2 text-sm m-0">{t.fwFlashNoVersions}</p>
          ) : (
            <>
              <Field label={t.fwFlashSelectVersion} htmlFor="flash-version">
                <select
                  id="flash-version"
                  className="select-native font-sans text-sm text-fg-1 px-3 py-[10px] min-h-[42px] rounded border border-border-strong bg-surface outline-none w-full transition-colors focus:border-accent focus:ring-1 focus:ring-accent appearance-none cursor-pointer"
                  value={selectedFwId}
                  onChange={(e) => setSelectedFwId(e.target.value)}
                >
                  <option value="">{t.fwFlashSelectPlaceholder}</option>
                  {firmwareVersions.map((fw) => (
                    <option key={fw.id} value={fw.id} disabled={fw.is_default && !fw.active}>
                      {fw.is_default
                        ? `v${fw.version} — ${t.fwDefault}${fw.active ? '' : ' ⚠'}`
                        : `v${fw.version}${fw.active ? ' ★' : ''}`}
                    </option>
                  ))}
                </select>
              </Field>
              <ol className="list-none m-0 p-0 flex flex-col gap-3">
                {[t.fwFlashStep1, t.fwFlashStep2, t.fwFlashStep3].map((step, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm text-fg-2">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent text-fg-on flex items-center justify-center text-xs font-medium">
                      {i + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
              {selectedFwId && (
                <div className="flex items-center gap-3 flex-wrap">
                  {manifestLoading && (
                    <span className="text-fg-2 text-sm">{t.fwFlashManifestLoading}</span>
                  )}
                  {manifestError && (
                    <div className="flex gap-[10px] items-start px-[14px] py-3 rounded bg-info/[0.08] text-fg-2 text-sm leading-[1.5] [&_.material-symbols-outlined]:text-[19px] [&_.material-symbols-outlined]:text-info [&_.material-symbols-outlined]:flex-shrink-0 [&_.material-symbols-outlined]:mt-[1px]">
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
