import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '../lib/appContext';
import { useAuth } from '../hooks/useAuth';
import { getFirmwareVersions, createFirmwareVersion } from '../lib/api';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Field } from '../components/ui/Field';
import { Input } from '../components/ui/input';
import { LoadBox } from '../components/ui/Spinner';
import { Empty } from '../components/ui/Empty';
import { Icon } from '../components/ui/Logo';
import type { FirmwareVersion } from '../types';

export function FirmwarePage() {
  const app = useApp();
  const t = app.t;
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ version: '', downloadPath: 'firmware.bin', checksum: '', notes: '' });

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
      setForm({ version: '', downloadPath: 'firmware.bin', checksum: '', notes: '' });
      app.toast({ type: 'success', title: t.fwVersionCreated });
    },
    onError: (err: Error) => {
      app.toast({ type: 'error', title: err.message });
    },
  });

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
              <Button onClick={() => setForm({ version: '1.0.1', downloadPath: 'firmware.bin', checksum: '', notes: '' })}>
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
              placeholder="firmware.bin"
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
    </div>
  );
}
