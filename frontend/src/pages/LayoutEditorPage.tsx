// =========================================================================
// LayoutEditorPage.tsx — full-page drag-and-drop layout editor
// =========================================================================
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useApp } from '../lib/appContext';
import { useAuth } from '../hooks/useAuth';
import { DisplayLayout, DEFAULT_LAYOUT, NewsFeed, TickerWidgetSetting, WidgetOptions } from '../types';
import { saveLayout, getPreferences, savePreferences } from '../lib/api';
import { findWidgetSpace, layoutProblem } from '../lib/layoutPlacement';
import { GridEditor, WIDGET_META } from '../components/layout/GridEditor';
import { LayoutPreviewPane } from '../components/layout/LayoutPreviewPane';
import { WidgetOptionsPanel } from '../components/layout/WidgetOptionsPanel';
import { updateWidgetOptions } from '../lib/widgetOptions';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { LoadBox } from '../components/ui/Spinner';
import { Empty } from '../components/ui/Empty';
import { Icon } from '../components/ui/Logo';
import { getDevices } from '../lib/api';
import { deviceDashboardPath } from '../lib/deviceLayouts';
import { newsFeedIdFromWidget, newsFeedLabel, newsFeedWidgetId } from '../lib/newsFeeds';
import { tickerIdFromWidget, tickerLabel, tickerWidgetId } from '../lib/tickerWidgets';

const ALL_WIDGET_IDS = ['energy', 'weather', 'news', 'monta', 'zaptec', 'notion', 'custom-text', 'custom-image', 'custom-webhook', 'calendar', 'week-number', 'status'] as const;

export function LayoutEditorPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  return <LayoutEditorWorkspace key={`${user?.id}:${params.get('device') ?? 'shared'}:${params.get('page') ?? 'base'}`} />;
}

function LayoutEditorWorkspace() {
  const app = useApp();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const pageId = searchParams.get('page');
  const deviceId = searchParams.get('device') ?? undefined;
  const queryClient = useQueryClient();
  const { getToken, user } = useAuth();
  const t = app.t;

  const widgetMeta: Record<string, WIDGET_META> = {
    energy:  { id: 'energy',  label: t.layoutWidgetEnergy,  icon: 'bolt' },
    weather: { id: 'weather', label: t.layoutWidgetWeather, icon: 'cloud' },
    news:    { id: 'news',    label: t.layoutWidgetNews,    icon: 'newspaper' },
    monta:   { id: 'monta',   label: t.srcMonta,            icon: 'electric_car' },
    zaptec:  { id: 'zaptec',  label: t.srcZaptec,           icon: 'electric_car' },
    notion:  { id: 'notion',  label: t.srcNotion,           icon: 'auto_stories' },
    calendar: { id: 'calendar', label: app.lang === 'da' ? 'Kalender' : 'Calendar', icon: 'calendar_month' },
    'week-number': { id: 'week-number', label: app.lang === 'da' ? 'Ugenummer' : 'Week number', icon: 'date_range' },
    status:  { id: 'status',  label: t.layoutWidgetStatus,  icon: 'schedule' },
    'custom-text': { id: 'custom-text', label: 'My note', icon: 'notes' },
    'custom-image': { id: 'custom-image', label: 'My image', icon: 'image' },
    'custom-webhook': { id: 'custom-webhook', label: 'Custom sensors', icon: 'sensors' },
  };

  const [layout, setLayout] = useState<DisplayLayout>(DEFAULT_LAYOUT);
  const [loadingPrefs, setLoadingPrefs] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [pageName, setPageName] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [newsFeeds, setNewsFeeds] = useState<NewsFeed[]>([]);
  const [tickers, setTickers] = useState<TickerWidgetSetting[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadingPrefs(true);
    setLoadError(false);
    if (deviceId === '') { setLoadError(true); setLoadingPrefs(false); return; }
    getToken().then(async (authToken) => {
      if (!authToken) throw new Error('Not authenticated');
      const [{ preferences }, devices] = await Promise.all([getPreferences(authToken, deviceId), deviceId ? getDevices(authToken) : Promise.resolve(null)]);
      if (cancelled) return;
      setNewsFeeds(preferences.news_feeds ?? []);
      setTickers(preferences.ticker_widgets ?? []);
      if (deviceId) {
        const device = devices?.devices.find((item) => item.id === deviceId);
        if (!device) throw new Error('Device no longer exists');
        setDeviceName(device.device_name);
      }
      if (pageId) {
        const page = preferences.display_schedule?.pages.find((item) => item.id === pageId);
        if (!page) throw new Error('Scheduled page no longer exists');
        setPageName(page.name);
        setLayout(page.layout);
      } else {
        setPageName(null);
        setLayout(preferences.layout ?? DEFAULT_LAYOUT);
      }
    }).catch(() => {
      if (!cancelled) setLoadError(true);
    }).finally(() => {
      if (!cancelled) setLoadingPrefs(false);
    });
    return () => { cancelled = true; };
  }, [getToken, loadAttempt, pageId, deviceId]);

  // Each additional news feed is its own widget, listed right after the main news widget.
  for (const feed of newsFeeds) {
    const id = newsFeedWidgetId(feed.id);
    widgetMeta[id] = { id, label: `${t.layoutWidgetNews}: ${newsFeedLabel(feed)}`, icon: 'newspaper' };
  }
  // A placed widget whose feed was removed stays visible so it can be removed from the layout.
  for (const widget of layout.widgets) {
    if (!widgetMeta[widget.i] && newsFeedIdFromWidget(widget.i)) {
      widgetMeta[widget.i] = { id: widget.i, label: `${t.layoutWidgetNews}: ${app.lang === 'da' ? 'fjernet feed' : 'removed feed'}`, icon: 'newspaper' };
    }
  }
  // Stock tickers are listed after the other widgets.
  const stocksLabel = app.lang === 'da' ? 'Aktier' : 'Stocks';
  for (const ticker of tickers) {
    const id = tickerWidgetId(ticker.id);
    widgetMeta[id] = { id, label: `${stocksLabel}: ${tickerLabel(ticker)}`, icon: 'show_chart' };
  }
  // A placed widget whose ticker was removed stays visible so it can be removed from the layout.
  for (const widget of layout.widgets) {
    if (!widgetMeta[widget.i] && tickerIdFromWidget(widget.i)) {
      widgetMeta[widget.i] = { id: widget.i, label: `${stocksLabel}: ${app.lang === 'da' ? 'fjernet widget' : 'removed widget'}`, icon: 'show_chart' };
    }
  }
  const allWidgetIds = [
    ...ALL_WIDGET_IDS.flatMap((id) => id === 'news' ? [id, ...newsFeeds.map((feed) => newsFeedWidgetId(feed.id))] : [id]),
    ...tickers.map((ticker) => tickerWidgetId(ticker.id)),
  ];
  const activeWidgetIds = new Set(layout.widgets.map((w) => w.i));
  const availableWidgets = allWidgetIds.filter((id) => !activeWidgetIds.has(id));
  const hasSpace = findWidgetSpace(layout) !== null;
  // A removed or reset widget closes its options.
  const selectedWidget = layout.widgets.find((widget) => widget.i === selectedId);
  const selectedTickerId = selectedWidget ? tickerIdFromWidget(selectedWidget.i) : null;

  function handleWidgetOptions(change: WidgetOptions) {
    if (selectedId) setLayout((prev) => updateWidgetOptions(prev, selectedId, change));
  }

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
    const problem = layoutProblem(layout);
    if (problem) {
      // The editor should never allow this; stop here with a clear message instead of a server error.
      app.toast({ type: 'error', title: t.layoutSaveFailed, msg: app.lang === 'da'
        ? 'Widgets skal ligge inden for gitteret på 10 × 6 og må ikke overlappe.'
        : 'Widgets must stay inside the 10 × 6 grid and must not overlap.' });
      return;
    }
    setSaving(true);
    try {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');
      if (pageId) {
        // Read the current schedule so editing one page preserves its current order
        // and the other pages, even if those changed after opening the editor.
        const { preferences } = await getPreferences(token, deviceId);
        const schedule = preferences.display_schedule;
        if (!schedule?.pages.some((page) => page.id === pageId)) throw new Error('Scheduled page no longer exists');
        await savePreferences(token, { display_schedule: {
          ...schedule, pages: schedule.pages.map((page) => page.id === pageId ? { ...page, layout } : page),
        } }, deviceId);
      } else {
        await saveLayout(token, layout, deviceId);
      }
      queryClient.invalidateQueries({ queryKey: deviceId ? ['preferences', user?.id, deviceId] : ['preferences', user?.id] });
      queryClient.invalidateQueries({ queryKey: deviceId ? ['preview', user?.id, deviceId] : ['preview', user?.id] });
      if (!mounted.current) return;
      app.toast({ type: 'success', title: t.layoutSaved, msg: t.layoutSavedMsg });
      navigate(deviceDashboardPath(deviceId));
    } catch {
      if (mounted.current) app.toast({ type: 'error', title: t.layoutSaveFailed });
    } finally {
      if (mounted.current) setSaving(false);
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
          <p className="text-sm text-fg2 mt-2">{deviceName ? `${app.lang === 'da' ? 'Enhed' : 'Device'}: ${deviceName}` : (app.lang === 'da' ? 'Fælles grundindstillinger for enheder uden egne indstillinger' : 'Shared defaults for devices without their own settings')}</p>
          {pageName && <p className="text-sm text-fg2 mt-2">{app.lang === 'da' ? 'Side' : 'Page'}: {pageName}</p>}
        </div>
        <div className="flex gap-2 flex-shrink-0 flex-wrap">
          <Button variant="outlined" onClick={handleReset} icon="restart_alt">{t.layoutReset}</Button>
          <Button variant="outlined" onClick={() => navigate(deviceDashboardPath(deviceId))}>{t.layoutCancel}</Button>
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
              selectedId={selectedWidget?.i ?? null}
              onSelectWidget={setSelectedId}
            />
          </div>
          {selectedWidget && (
            <div className="mt-3">
              <WidgetOptionsPanel
                key={selectedWidget.i}
                widget={selectedWidget}
                label={widgetMeta[selectedWidget.i]?.label ?? selectedWidget.i}
                lang={app.lang}
                ticker={selectedTickerId ? tickers.find((ticker) => ticker.id === selectedTickerId) : undefined}
                onChange={handleWidgetOptions}
                onClose={() => setSelectedId(null)}
              />
            </div>
          )}
          <div className="flex flex-col gap-0.5 mt-2 [&_.material-symbols-outlined]:text-[14px]">
            <p className="flex items-center gap-1 text-xs text-fg3 m-0">
              <Icon name="info" /> Grid: 10 columns × 6 rows · size and orientation from saved display profile
            </p>
            <p className="flex items-center gap-1 text-xs text-fg3 m-0">
              <Icon name="drag_indicator" /> Drag the handle to move · drag the bottom-right corner to resize
            </p>
            <p className="flex items-center gap-1 text-xs text-fg3 m-0">
              <Icon name="tune" /> {app.lang === 'da' ? 'Tryk på en widget for at vælge visning og antal' : 'Tap a widget to choose its view and how many items it shows'}
            </p>
            <p className="flex items-center gap-1 text-xs text-fg3 m-0">
              <Icon name="open_in_full" /> {app.lang === 'da'
                ? 'En widget stopper ved sine naboer. Gør en nabo mindre eller flyt den for at give plads.'
                : 'A widget stops at its neighbours. Shrink or move a neighbouring widget to make room.'}
            </p>
          </div>
        </div>

        {/* Sidebar: preview + palette */}
        <div className="sticky top-20 max-[900px]:static flex flex-col gap-4">
          <Card title={t.layoutPreviewTitle}>
            <LayoutPreviewPane layout={layout} deviceId={deviceId} />
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
