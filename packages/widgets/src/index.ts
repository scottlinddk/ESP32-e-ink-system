export { widgetRegistry, WidgetRegistry } from './registry';
export { energinetPricesWidget } from './widgets/energinet/index';
export { weatherWidget } from './widgets/weather/index';
export { newsWidget } from './widgets/news/index';
export { montaWidget } from './widgets/monta/index';
export { zaptecWidget } from './widgets/zaptec/index';
export { icsCalendarWidget } from './widgets/ics-calendar/index';
export { notionWidget } from './widgets/notion/index';
export { stravaWidget } from './widgets/strava/index';
export { googleCalendarWidget } from './widgets/google-calendar/index';

// Auto-register all built-in widgets
import { widgetRegistry } from './registry';
import { energinetPricesWidget } from './widgets/energinet/index';
import { weatherWidget } from './widgets/weather/index';
import { newsWidget } from './widgets/news/index';
import { montaWidget } from './widgets/monta/index';
import { zaptecWidget } from './widgets/zaptec/index';
import { icsCalendarWidget } from './widgets/ics-calendar/index';
import { notionWidget } from './widgets/notion/index';
import { stravaWidget } from './widgets/strava/index';
import { googleCalendarWidget } from './widgets/google-calendar/index';

widgetRegistry.register(energinetPricesWidget);
widgetRegistry.register(weatherWidget);
widgetRegistry.register(newsWidget);
widgetRegistry.register(montaWidget);
widgetRegistry.register(zaptecWidget);
widgetRegistry.register(icsCalendarWidget);
widgetRegistry.register(notionWidget);
widgetRegistry.register(stravaWidget);
widgetRegistry.register(googleCalendarWidget);
