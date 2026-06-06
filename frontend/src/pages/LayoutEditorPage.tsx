// =========================================================================
// LayoutEditorPage.tsx — full-page drag-and-drop layout editor
// =========================================================================
import React, { useEffect, useState } from 'react';
import { useApp } from '../lib/appContext';
import { useAuth } from '../hooks/useAuth';
import { DisplayLayout, DEFAULT_LAYOUT, WidgetLayout } from '../types';
import { saveLayout, getPreferences } from '../lib/api';
import { GridEditor, WIDGET_META } from '../components/layout/GridEditor';
import { LayoutPreviewPane } from '../components/layout/LayoutPreviewPane';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { LoadBox } from '../components/ui/Spinner';
import { Icon } from '../components/ui/Logo';

const ALL_WIDGET_IDS = ['energy', 'weather', 'news'] as const;

export function LayoutEditorPage() {
  const app = useApp();
  const { getToken } = useAuth();
  const t = app.t;

  const widgetMeta: Record<string, WIDGET_META> = {
    energy:  { id: 'energy',  label: t.layoutWidgetEnergy,  icon: 'bolt' },
    weather: { id: 'weather', label: t.layoutWidgetWeather, icon: 'cloud' },
    news:    { id: 'news',    label: t.layoutWidgetNews,    icon: 'newspaper' },
    status:  { id: 'status',  label: t.layoutWidgetStatus,  icon: 'schedule' },
  };

  const [layout, setLayout] = useState<DisplayLayout>(DEFAULT_LAYOUT);
  const [token, setToken] = useState<string | null>(null);
  const [loadingPrefs, setLoadingPrefs] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => { getToken().then(setToken); }, [getToken]);

  useEffect(() => {
    if (!token) return;
    getPreferences(token)
      .then(({ preferences }) => { setLayout(preferences.layout ?? DEFAULT_LAYOUT); })
      .catch(() => setLayout(DEFAULT_LAYOUT))
      .finally(() => setLoadingPrefs(false));
  }, [token]);

  const activeWidgetIds = new Set(layout.widgets.map((w) => w.i));
  const availableWidgets = ALL_WIDGET_IDS.filter((id) => !activeWidgetIds.has(id));

  function handleRemoveWidget(widgetId: string) {
    setLayout((prev) => ({ ...prev, widgets: prev.widgets.filter((w) => w.i !== widgetId) }));
  }

  function handleAddWidget(widgetId: string) {
    const occupiedRows = new Set(layout.widgets.flatMap((w) => {
      const rows: number[] = [];
      for (let r = w.y; r < w.y + w.h; r++) rows.push(r);
      return rows;
    }));
    let freeRow = 0;
    for (let r = 0; r < 5; r++) { if (!occupiedRows.has(r)) { freeRow = r; break; } }
    const newWidget: WidgetLayout = { i: widgetId, x: 0, y: freeRow, w: 10, h: 1 };
    setLayout((prev) => ({ ...prev, widgets: [...prev.widgets, newWidget] }));
  }

  async function handleSave() {
    if (!token) return;
    setSaving(true);
    try {
      await saveLayout(token, layout);
      app.toast({ type: 'success', title: t.layoutSaved, msg: t.layoutSavedMsg });
      app.nav('dashboard');
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
          <Button variant="outlined" onClick={() => app.nav('dashboard')}>{t.layoutCancel}</Button>
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
            <div className="grid-editor-canvas">
              <GridEditor
                layout={layout}
                widgetMeta={widgetMeta}
                onLayoutChange={setLayout}
                onRemoveWidget={handleRemoveWidget}
              />
            </div>
          </div>
          <p className="flex items-center gap-1 text-xs text-fg3 mt-2 [&_.material-symbols-outlined]:text-[14px]">
            <Icon name="info" /> Grid: 10 columns × 6 rows · 250×122 px display
          </p>
        </div>

        {/* Sidebar: preview + palette */}
        <div className="sticky top-20 max-[900px]:static flex flex-col gap-4">
          <Card title={t.previewTitle} desc={t.previewSub}>
            <LayoutPreviewPane layout={layout} token={token} />
          </Card>

          {availableWidgets.length > 0 && (
            <Card title={t.layoutAvailable}>
              <div className="flex flex-col gap-2">
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
                        className="w-7 h-7 rounded-full border border-accent bg-transparent cursor-pointer text-accent flex items-center justify-center [&_.material-symbols-outlined]:text-[16px] hover:bg-accent hover:text-fg-on transition-[background,color] duration-[150ms]"
                        onClick={() => handleAddWidget(id)}
                        title={t.layoutAddWidget}
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
