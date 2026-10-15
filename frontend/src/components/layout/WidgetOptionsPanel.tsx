// =========================================================================
// WidgetOptionsPanel.tsx — display options for the widget selected in the layout editor
// =========================================================================
import React from 'react';
import type { CalendarView, EnergyView, TickerView, TickerWidgetSetting, WeatherView, WidgetLayout, WidgetOptions } from '../../types';
import { MAX_CALENDAR_DAYS, MAX_NEWS_COLUMNS, MAX_WIDGET_ITEMS, MIN_CALENDAR_DAYS, widgetAcceptsZoom, widgetOptionKind } from '../../lib/widgetOptions';
import { ZOOMS, zoomLabel } from '../../lib/zoom';
import { Card } from '../ui/card';
import { Field } from '../ui/Field';
import { Select } from '../ui/select';
import { Button } from '../ui/button';

interface WidgetOptionsPanelProps {
  widget: WidgetLayout;
  label: string;
  lang: 'da' | 'en';
  /** The ticker's own settings, used to name the default it falls back to. */
  ticker?: TickerWidgetSetting;
  /** Zoom the widget is drawn at when it has none of its own: the layout's, else the panel's automatic one. */
  inheritedZoom?: number;
  onChange: (change: WidgetOptions) => void;
  onClose: () => void;
}

const AUTO = 'auto';
/** The chart needs a header, bars and hour labels: two grid rows at the least. */
export const MIN_CHART_ROWS = 2;

function countOptions(autoLabel: string) {
  return [{ value: AUTO, label: autoLabel },
    ...Array.from({ length: MAX_WIDGET_ITEMS }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }))];
}

const parseCount = (value: string) => (value === AUTO ? undefined : Number(value));

function dayCountOptions(autoLabel: string) {
  return [{ value: AUTO, label: autoLabel },
    ...Array.from({ length: MAX_CALENDAR_DAYS - MIN_CALENDAR_DAYS + 1 }, (_, index) => ({ value: String(index + MIN_CALENDAR_DAYS), label: String(index + MIN_CALENDAR_DAYS) }))];
}

export function WidgetOptionsPanel({ widget, label, lang, ticker, inheritedZoom, onChange, onClose }: WidgetOptionsPanelProps) {
  const da = lang === 'da';
  const kind = widgetOptionKind(widget.i);
  const fieldId = `widget-options-${widget.i.replace(/[^a-z0-9]/gi, '-')}`;
  const items = widget.options?.items === undefined ? AUTO : String(widget.options.items);

  return (
    <Card icon="tune" title={label}
      action={<Button variant="text" size="sm" icon="close" onClick={onClose} aria-label={da ? 'Luk indstillinger' : 'Close options'} />}>
      <div className="flex flex-col gap-4">
        {kind === 'energy' && (() => {
          const view = (widget.options?.view ?? 'summary') as EnergyView;
          return (
            <Field label={da ? 'Visning' : 'View'} htmlFor={`${fieldId}-view`}
              helper={view !== 'summary' && widget.h < MIN_CHART_ROWS
                ? (da ? `Gør widgetten mindst ${MIN_CHART_ROWS} rækker høj for at vise søjler.` : `Make the widget at least ${MIN_CHART_ROWS} rows tall to show bars.`)
                : view !== 'summary' ? (da ? 'Den aktuelle time vises som en åben søjle, gennemsnittet som en prikket linje.' : 'The current hour is an outlined bar, the day\'s average a dotted line.') : undefined}>
              <Select id={`${fieldId}-view`} value={view}
                options={[
                  { value: 'summary', label: da ? 'Pris nu og gennemsnit' : 'Price now and average' },
                  { value: 'day', label: da ? 'Hele døgnet, time for time' : 'Whole day, hour by hour' },
                  { value: 'rest', label: da ? 'Fra nu og resten af dagen' : 'From now to the end of the day' },
                ]}
                onChange={(e) => onChange({ view: e.target.value === 'summary' ? undefined : e.target.value as EnergyView })} />
            </Field>
          );
        })()}

        {kind === 'weather' && (() => {
          const view = (widget.options?.view ?? 'summary') as WeatherView;
          const viewHelp: Record<WeatherView, string> = {
            summary: da ? 'Vejret og vinden på to linjer. Kræver kun den aktuelle måling.' : 'The weather and wind on two lines. Needs only the current reading.',
            current: da ? 'Stor temperatur med ikon, og føles som, luftfugtighed, vind og sol til siden eller nedenunder.' : 'A large temperature with an icon, and feels like, humidity, wind and sun beside or below it.',
            hours: da ? 'De næste tidspunkter som søjler med ikon, temperatur og regnrisiko. Prognosen er i trin på 3 timer.' : 'The next steps as columns with an icon, temperature and chance of rain. The forecast comes in 3-hour steps.',
            daily: da ? 'De kommende dage med ikon, højeste og laveste temperatur og regnrisiko. En bred, lav widget viser dagene side om side.' : 'The days ahead with an icon, high and low and chance of rain. A wide, short widget shows the days side by side.',
            details: da ? 'En liste over målinger: føles som, fugt, vind, vindstød, tryk, skydække, sigtbarhed, regn, sol og luftkvalitet. Det, der mangler, udelades.' : 'A list of readings: feels like, humidity, wind, gusts, pressure, cloud cover, visibility, rain, sun and air quality. What is missing is left out.',
          };
          const needsForecast = view === 'hours' || view === 'daily';
          return (
            <>
              <Field label={da ? 'Visning' : 'View'} htmlFor={`${fieldId}-view`}
                helper={`${viewHelp[view]} ${view !== 'summary' ? (da ? 'Brug «Vejr (2)» til «Vejr (4)» i paletten for at vise flere visninger i samme layout.' : 'Use Weather (2) to (4) in the palette to show several views in one layout.') : ''}`.trim()}>
                <Select id={`${fieldId}-view`} value={view}
                  options={[
                    { value: 'summary', label: da ? 'Kort: vejr og vind' : 'Brief: weather and wind' },
                    { value: 'current', label: da ? 'Nu: stor temperatur' : 'Now: large temperature' },
                    { value: 'hours', label: da ? 'Kommende timer' : 'Next hours' },
                    { value: 'daily', label: da ? 'Kommende dage' : 'Next days' },
                    { value: 'details', label: da ? 'Detaljer: målinger' : 'Details: readings' },
                  ]}
                  onChange={(e) => onChange({ view: e.target.value === 'summary' ? undefined : e.target.value as WeatherView })} />
              </Field>
              {needsForecast && (
                <Field label={view === 'hours' ? (da ? 'Antal tidspunkter' : 'Number of steps') : (da ? 'Antal dage' : 'Number of days')} htmlFor={`${fieldId}-items`}
                  helper={da ? 'Højst så mange som prognosen og pladsen rummer.' : 'At most as many as the forecast and the width allow.'}>
                  <Select id={`${fieldId}-items`} value={items} options={countOptions(da ? 'Så mange som muligt' : 'As many as fit')}
                    onChange={(e) => onChange({ items: parseCount(e.target.value) })} />
                </Field>
              )}
            </>
          );
        })()}

        {kind === 'calendar' && (() => {
          const view = (widget.options?.view ?? 'list') as CalendarView;
          const viewHelp: Record<CalendarView, string> = {
            list: da ? 'Kommende aftaler, samlet under en overskrift for hver dag.' : 'Upcoming events, grouped under a heading for each day.',
            day: da ? 'Ét døgn time for time, med aftalerne som blokke. Vises fra en time før nu.' : 'One day hour by hour, with the events as blocks. Starts an hour before now.',
            days: da ? 'Flere dage side om side, time for time. Vises fra en time før nu.' : 'Several days side by side, hour by hour. Starts an hour before now.',
            month: da ? 'Den aktuelle måned som et gitter. En prik pr. aftale på en dag, op til tre.' : 'The current month as a grid. One dot per event on a day, up to three.',
          };
          return (
            <>
              <Field label={da ? 'Visning' : 'View'} htmlFor={`${fieldId}-view`}
                helper={`${viewHelp[view]} ${da ? 'Er widgetten for lille, vises listen i stedet.' : 'A widget too small for the view shows the list instead.'}`}>
                <Select id={`${fieldId}-view`} value={view}
                  options={[
                    { value: 'list', label: da ? 'Liste' : 'List' },
                    { value: 'day', label: da ? 'Dag' : 'Day' },
                    { value: 'days', label: da ? 'Flere dage' : 'Several days' },
                    { value: 'month', label: da ? 'Måned' : 'Month' },
                  ]}
                  onChange={(e) => onChange({ view: e.target.value === 'list' ? undefined : e.target.value as CalendarView })} />
              </Field>
              {view === 'list' && (
                <Field label={da ? 'Antal begivenheder' : 'Number of events'} htmlFor={`${fieldId}-items`}
                  helper={da ? 'Højst så mange som hentes og kan være i widgetten.' : 'At most as many as are fetched and fit in the widget.'}>
                  <Select id={`${fieldId}-items`} value={items} options={countOptions(da ? 'Så mange som muligt' : 'As many as fit')}
                    onChange={(e) => onChange({ items: parseCount(e.target.value) })} />
                </Field>
              )}
              {view === 'days' && (
                <Field label={da ? 'Antal dage' : 'Number of days'} htmlFor={`${fieldId}-days`}
                  helper={da ? 'Hver dag skal være mindst fem tegn bred, ellers vises listen. Uden valg tilpasses antallet til bredden.' : 'Each day needs at least five characters of width, otherwise the list is shown. Left on automatic, the count follows the width.'}>
                  <Select id={`${fieldId}-days`} value={widget.options?.days === undefined ? AUTO : String(widget.options.days)}
                    options={dayCountOptions(da ? 'Så mange som der er plads til' : 'As many as fit')}
                    onChange={(e) => onChange({ days: parseCount(e.target.value) })} />
                </Field>
              )}
            </>
          );
        })()}

        {kind === 'list' && (
          <>
            <Field label={da ? 'Antal overskrifter' : 'Number of headlines'}
              htmlFor={`${fieldId}-items`}
              helper={da ? 'Højst så mange som hentes og kan være i widgetten.' : 'At most as many as are fetched and fit in the widget.'}>
              <Select id={`${fieldId}-items`} value={items} options={countOptions(da ? 'Så mange som muligt' : 'As many as fit')}
                onChange={(e) => onChange({ items: parseCount(e.target.value) })} />
            </Field>
            <Field label={da ? 'Antal kolonner' : 'Number of columns'} htmlFor={`${fieldId}-columns`}
              helper={da ? 'Overskrifterne fordeles ligeligt mellem kolonnerne. Er widgetten for smal, vises færre.' : 'Headlines are split evenly between the columns. A widget too narrow for that many shows fewer.'}>
              <Select id={`${fieldId}-columns`} value={String(widget.options?.columns ?? 1)}
                options={Array.from({ length: MAX_NEWS_COLUMNS }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }))}
                onChange={(e) => onChange({ columns: Number(e.target.value) === 1 ? undefined : Number(e.target.value) })} />
            </Field>
          </>
        )}

        {kind === 'ticker' && (() => {
          const ownView = ticker?.view ?? 'full';
          const viewName = (view: TickerView) => view === 'full' ? (da ? 'Én aktie' : 'Single stock') : (da ? 'Liste' : 'List');
          const view = widget.options?.view as TickerView | undefined;
          const effective = view ?? ownView;
          return (
            <>
              <Field label={da ? 'Visning' : 'View'} htmlFor={`${fieldId}-view`}>
                <Select id={`${fieldId}-view`} value={view ?? AUTO}
                  options={[
                    { value: AUTO, label: `${da ? 'Som widgetten' : 'Widget default'} (${viewName(ownView)})` },
                    { value: 'full', label: viewName('full') },
                    { value: 'condensed', label: viewName('condensed') },
                  ]}
                  onChange={(e) => onChange({ view: e.target.value === AUTO ? undefined : e.target.value as TickerView })} />
              </Field>
              {effective === 'condensed' && (
                <Field label={da ? 'Aktier pr. side' : 'Stocks per page'} htmlFor={`${fieldId}-items`}
                  helper={da ? 'Flere aktier end der er plads til vises på skiftende sider.' : 'More stocks than fit are shown on rotating pages.'}>
                  <Select id={`${fieldId}-items`} value={items}
                    options={countOptions(ticker?.per_page ? `${da ? 'Som widgetten' : 'Widget default'} (${ticker.per_page})` : (da ? 'Så mange som muligt' : 'As many as fit'))}
                    onChange={(e) => onChange({ items: parseCount(e.target.value) })} />
                </Field>
              )}
            </>
          );
        })()}

        {kind === 'ai-usage' && (
          <Field label={da ? 'Visning' : 'View'} htmlFor={`${fieldId}-view`}
            helper={da ? 'En lav widget viser færre detaljer, til sidst én linje pr. udbyder.' : 'A short widget shows less detail, down to one line per provider.'}>
            <Select id={`${fieldId}-view`} value={widget.options?.view === 'condensed' ? 'condensed' : 'full'}
              options={[
                { value: 'full', label: da ? 'Detaljeret: kvoter, tokens og pris' : 'Detailed: quota, token breakdown and cost' },
                { value: 'condensed', label: da ? 'Kompakt: kun kvoter' : 'Condensed: quota limits only' },
              ]}
              onChange={(e) => onChange({ view: e.target.value === 'condensed' ? 'condensed' : undefined })} />
          </Field>
        )}

        {kind === 'status' && (
          <Field label={da ? 'Visning' : 'View'} htmlFor={`${fieldId}-view`}
            helper={da ? 'Kompakt viser kun klokkeslættet og kan gøres smal. Brug et finere gitter for at gøre linjen lavere.'
              : 'Compact shows the time alone and can be made narrow. Choose a finer grid to make the bar shorter.'}>
            <Select id={`${fieldId}-view`} value={widget.options?.view === 'condensed' ? 'condensed' : 'full'}
              options={[
                { value: 'full', label: da ? 'Fuld: opdateringsinterval og klokkeslæt' : 'Full: refresh interval and time' },
                { value: 'condensed', label: da ? 'Kompakt: kun klokkeslæt' : 'Compact: time only' },
              ]}
              onChange={(e) => onChange({ view: e.target.value === 'condensed' ? 'condensed' : undefined })} />
          </Field>
        )}

        {widgetAcceptsZoom(widget.i) && (
          <Field label={da ? 'Tekststørrelse' : 'Text size'} htmlFor={`${fieldId}-zoom`}
            helper={da ? 'Forstørrer tekst og grafik i hele tal. Er widgetten for lille til størrelsen, bruges en mindre.'
              : 'Enlarges text and graphics in whole steps. A widget too small for the size uses a smaller one.'}>
            <Select id={`${fieldId}-zoom`} value={widget.options?.zoom === undefined ? AUTO : String(widget.options.zoom)}
              options={[
                { value: AUTO, label: `${da ? 'Som layoutet' : 'Follow layout'}${inheritedZoom ? ` (${zoomLabel(inheritedZoom)})` : ''}` },
                ...ZOOMS.map((zoom) => ({ value: String(zoom), label: zoomLabel(zoom) })),
              ]}
              onChange={(e) => onChange({ zoom: e.target.value === AUTO ? undefined : Number(e.target.value) })} />
          </Field>
        )}

        {!kind && !widgetAcceptsZoom(widget.i) && (
          <p className="text-sm text-fg2 m-0">
            {da ? 'Denne widget har ingen visningsindstillinger. Flyt eller tilpas størrelsen i gitteret.' : 'This widget has no display options. Move or resize it in the grid.'}
          </p>
        )}

        <p className="text-xs text-fg3 m-0">
          {da ? 'Gælder kun denne placering. Gem layoutet for at beholde ændringen.' : 'Applies to this placement only. Save the layout to keep the change.'}
        </p>
      </div>
    </Card>
  );
}
