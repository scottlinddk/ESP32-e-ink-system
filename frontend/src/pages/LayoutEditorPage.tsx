// =========================================================================
// LayoutEditorPage.tsx — full-page drag-and-drop layout editor
// =========================================================================
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useApp } from '../lib/appContext';
import { useAuth } from '../hooks/useAuth';
import { DisplayLayout, DEFAULT_LAYOUT } from '../types';
import { saveLayout, getPreferences } from '../lib/api';
import { findWidgetSpace } from '../lib/layoutPlacement';
import { GridEditor, WIDGET_META } from '../components/layout/GridEditor';
import { LayoutPreviewPane } from '../components/layout/LayoutPreviewPane';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { LoadBox } from '../components/ui/Spinner';
import { Empty } from '../components/ui/Empty';
import { Icon } from '../components/ui/Logo';

const ALL_WIDGET_IDS = ['energy', 'weather', 'news', 'monta', 'zaptec', 'notion', 'custom-text', 'custom-image'] as const;

export function LayoutEditorPage() {
  const app = useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { getToken } = useAuth();
  const t = app.t;

  const widgetMeta: Record<string, WIDGET_META> = {
    energy:  { id: 'energy',  label: t.layoutWidgetEnergy,  icon: 'bolt' },
    weather: { id: 'weather', label: t.layoutWidgetWeather, icon: 'cloud' },
    news:    { id: 'news',    label: t.layoutWidgetNews,    icon: 'newspaper' },
    monta:   { id: 'monta',   label: t.srcMonta,            icon: 'electric_car' },
    zaptec:  { id: 'zaptec',  label: t.srcZaptec,           icon: 'electric_car' },
    notion:  { id: 'notion',  label: t.srcNotion,           icon: 'auto_stories' },
    status:  { id: 'status',  label: t.layoutWidgetStatus,  icon: 'schedule' },
    'custom-text': { id: 'custom-text', label: 'My note', icon: 'notes' },
    'custom-image': { id: 'custom-image', label: 'My image', icon: 'image' },
  };

  const [layout, setLayout] = useState<DisplayLayout>(DEFAULT_LAYOUT);
  const [loadingPrefs, setLoadingPrefs] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadingPrefs(true);
    setLoadError(false);
    getToken().then(async (authToken) => {
      if (!authToken) throw new Error('Not authenticated');
      const { preferences } = await getPreferences(authToken);
      if (cancelled) return;
      setLayout(preferences.layout ?? DEFAULT_LAYOUT);
    }).catch(() => {
      if (!cancelled) setLoadError(true);
    }).finally(() => {
      if (!cancelled) setLoadingPrefs(false);
    });
    return () => { cancelled = true; };
  }, [getToken, loadAttempt]);

  const activeWidgetIds = new Set(layout.widgets.map((w) => w.i));
  const availableWidgets = ALL_WIDGET_IDS.filter((id) => !activeWidgetIds.has(id));
  const hasSpace = findWidgetSpace(layout) !== null;

  function handleRemoveWidget(widgetId: string) {
    setLayout((prev) => ({ ...prev, widgets: prev.widgets.filter((w) => w.i !== widgetId) }));
  }

  function handleAddWidget(widgetId: string) {
    setLayout((prev) => {
      const space = findWidgetSpace(prev);
      if (!space || prev.widgets.some((widget) => widget.i === widgetId)) return prev;
      return { ...prev, widgets: [...prev.widgets, { i: widgetId, ...space }] };
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      await saveLayout(token, layout);
      queryClient.invalidateQueries({ queryKey: ['preferences'] });
      queryClient.invalidateQueries({ queryKey: ['preview'] });
      app.toast({ type: 'success', title: t.layoutSaved, msg: t.layoutSavedMsg });
      navigate('/dashboard');
    } catch {
      app.toast({ type: 'error', title: t.layoutSaveFailed });
    } finally {
      setSaving(false);
    }
  }

  if (loadingPrefs) {
    return (
      <div className="max-w-[1200px] mx-auto px-6 pt-6">
        <LoadBox text={t.loading} />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-[1200px] mx-auto px-6 pt-6">
        <Empty icon="cloud_off" title={t.prefsError} text={t.previewErrorMsg}
          action={<Button icon="refresh" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>{t.retry}</Button>} />
      </div>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto px-6 pt-6 pb-20 animate-fade-up max-[820px]:px-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
        <div>
          <h1 className="text-h2 font-light tracking-tight m-0 mb-1.5">{t.layoutTitle}</h1>
          <p className="text-fg2 text-body m-0">{t.layoutSub}</p>
        </div>
        <div className="flex gap-2 flex-shrink-0 flex-wrap">
          <Button variant="outlined" onClick={handleReset} icon="restart_alt">{t.layoutReset}</Button>
          <Button variant="outlined" onClick={() => navigate('/dashboard')}>{t.layoutCancel}</Button>
          <Button onClick={handleSave} disabled={saving} loading={saving}>
            {saving ? t.layoutSaving : t.layoutSave}
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="grid grid-cols-[1fr_300px] gap-5 items-start max-[900px]:grid-cols-1">
        {/* Grid canvas */}
        <div className="min-w-0">
          <div className="overflow-x-auto">
            <GridEditor
              layout={layout}
              widgetMeta={widgetMeta}
              onLayoutChange={setLayout}
              onRemoveWidget={handleRemoveWidget}
            />
          </div>
          <div className="flex flex-col gap-0.5 mt-2 [&_.material-symbols-outlined]:text-[14px]">
            <p className="flex items-center gap-1 text-xs text-fg3 m-0">
              <Icon name="info" /> Grid: 10 columns × 6 rows · size and orientation from saved display profile
            </p>
            <p className="flex items-center gap-1 text-xs text-fg3 m-0">
              <Icon name="drag_indicator" /> Drag the handle to move · drag the bottom-right corner to resize
            </p>
          </div>
        </div>

        {/* Sidebar: preview + palette */}
        <div className="sticky top-20 max-[900px]:static flex flex-col gap-4">
          <Card title={t.layoutPreviewTitle}>
            <LayoutPreviewPane layout={layout} />
          </Card>

          {availableWidgets.length > 0 && (
            <Card title={t.layoutAvailable}>
              <div className="flex flex-col gap-2">
                {!hasSpace && <p className="text-xs text-fg2 m-0 mb-1">{t.layoutFull}</p>}
                {availableWidgets.map((id) => {
                  const meta = widgetMeta[id];
                  return (
                    <div
                      key={id}
                      className="flex items-center gap-2 px-2.5 py-2 bg-black/[0.04] border border-divider rounded-md"
                    >
                      <Icon name={meta.icon} className="!text-[18px] text-fg2" />
                      <span className="flex-1 text-sm">{meta.label}</span>
                      <button
                        className="w-7 h-7 rounded-full border border-accent bg-transparent cursor-pointer text-accent flex items-center justify-center [&_.material-symbols-outlined]:text-[16px] hover:bg-accent hover:text-fg-on transition-[background,color] duration-[150ms] disabled:opacity-40 disabled:cursor-default"
                        onClick={() => handleAddWidget(id)}
                        disabled={!hasSpace}
                        title={hasSpace ? t.layoutAddWidget : t.layoutFull}
                        aria-label={`${t.layoutAddWidget}: ${meta.label}`}
                      >
                        <Icon name="add" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );

  function handleReset() { setLayout(DEFAULT_LAYOUT); }
}
