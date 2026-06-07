export { widgetRegistry, WidgetRegistry } from './registry';
export { energinetPricesWidget } from './widgets/energinet/index';
export { weatherWidget } from './widgets/weather/index';
export { newsWidget } from './widgets/news/index';
export { montaWidget } from './widgets/monta/index';
export { zaptecWidget } from './widgets/zaptec/index';

// Auto-register all built-in widgets
import { widgetRegistry } from './registry';
import { energinetPricesWidget } from './widgets/energinet/index';
import { weatherWidget } from './widgets/weather/index';
import { newsWidget } from './widgets/news/index';
import { montaWidget } from './widgets/monta/index';
import { zaptecWidget } from './widgets/zaptec/index';

widgetRegistry.register(energinetPricesWidget);
widgetRegistry.register(weatherWidget);
widgetRegistry.register(newsWidget);
widgetRegistry.register(montaWidget);
widgetRegistry.register(zaptecWidget);
