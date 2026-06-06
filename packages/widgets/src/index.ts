export { widgetRegistry, WidgetRegistry } from './registry';
export { energinetPricesWidget } from './widgets/energinet/index';
export { weatherWidget } from './widgets/weather/index';
export { newsWidget } from './widgets/news/index';

// Auto-register all built-in widgets
import { widgetRegistry } from './registry';
import { energinetPricesWidget } from './widgets/energinet/index';
import { weatherWidget } from './widgets/weather/index';
import { newsWidget } from './widgets/news/index';

widgetRegistry.register(energinetPricesWidget);
widgetRegistry.register(weatherWidget);
widgetRegistry.register(newsWidget);
