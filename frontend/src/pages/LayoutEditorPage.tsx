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
import { Button } from '../components/ui/button';
import { Spinner } from '../components/ui/Spinner';
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

  // Load token once
  useEffect(() => {
    getToken().then(setToken);
  }, [getToken]);

  // Load current preferences on mount
  useEffect(() => {
    if (!token) return;
    getPreferences(token)
      .then(({ preferences }) => {
        setLayout(preferences.layout ?? DEFAULT_LAYOUT);
      })
      .catch(() => setLayout(DEFAULT_LAYOUT))
      .finally(() => setLoadingPrefs(false));
  }, [token]);

  const activeWidgetIds = new Set(layout.widgets.map((w) => w.i));
  const availableWidgets = ALL_WIDGET_IDS.filter((id) => !activeWidgetIds.has(id));

  function handleRemoveWidget(widgetId: string) {
    setLayout((prev) => ({
      ...prev,
      widgets: prev.widgets.filter((w) => w.i !== widgetId),
    }));
  }

  function handleAddWidget(widgetId: string) {
    // Find the lowest free row to place the new widget
    const occupiedRows = new Set(layout.widgets.flatMap((w) => {
      const rows: number[] = [];
      for (let r = w.y; r < w.y + w.h; r++) rows.push(r);
      return rows;
    }));
    let freeRow = 0;
    for (let r = 0; r < 5; r++) {
      if (!occupiedRows.has(r)) { freeRow = r; break; }
    }
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

  function handleReset() {
    setLayout(DEFAULT_LAYOUT);
  }

  if (loadingPrefs) {
    return (
      <div className="page">
        <div className="loadbox">
          <Spinner />
          <span>{t.loading}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="page layout-editor-page">
      {/* Header */}
      <div className="layout-editor-header">
        <div>
          <h1 className="page-title">{t.layoutTitle}</h1>
          <p className="page-sub">{t.layoutSub}</p>
        </div>
        <div className="layout-editor-actions">
          <Button variant="outlined" onClick={handleReset} icon="restart_alt">
            {t.layoutReset}
          </Button>
          <Button variant="outlined" onClick={() => app.nav('dashboard')}>
            {t.layoutCancel}
          </Button>
          <Button variant="contained" onClick={handleSave} disabled={saving} loading={saving}>
            {saving ? t.layoutSaving : t.layoutSave}
          </Button>
        </div>
      </div>

      {/* Main layout */}
      <div className="layout-editor-body">
        {/* Left: grid canvas */}
        <div className="layout-editor-main">
          <GridEditor
            layout={layout}
            widgetMeta={widgetMeta}
            onLayoutChange={setLayout}
            onRemoveWidget={handleRemoveWidget}
          />
          <p className="layout-editor-hint">
            <Icon name="info" /> Grid: 10 columns × 6 rows · 250×122 px display
          </p>
        </div>

        {/* Right: preview + palette */}
        <div className="layout-editor-sidebar">
          <div className="card">
            <div className="card__head">
              <div className="card__head-text">
                <span className="card__title">{t.previewTitle}</span>
                <span className="card__desc">{t.previewSub}</span>
              </div>
            </div>
            <div className="card__body">
              <LayoutPreviewPane layout={layout} token={token} />
            </div>
          </div>

          {availableWidgets.length > 0 && (
            <div className="card" style={{ marginTop: 16 }}>
              <div className="card__head">
                <div className="card__head-text">
                  <span className="card__title">{t.layoutAvailable}</span>
                </div>
              </div>
              <div className="card__body">
                <div className="layout-palette">
                  {availableWidgets.map((id) => {
                    const meta = widgetMeta[id];
                    return (
                      <div key={id} className="palette-item">
                        <Icon name={meta.icon} />
                        <span>{meta.label}</span>
                        <button
                          className="palette-add-btn"
                          onClick={() => handleAddWidget(id)}
                          title={t.layoutAddWidget}
                        >
                          <Icon name="add" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
