import { describe, it, expect, beforeEach } from 'vitest';
import { WidgetRegistry } from '../registry';
import { energinetPricesWidget } from '../widgets/energinet/index';
import { weatherWidget } from '../widgets/weather/index';
import { newsWidget } from '../widgets/news/index';

describe('WidgetRegistry', () => {
  let registry: WidgetRegistry;

  beforeEach(() => {
    registry = new WidgetRegistry();
  });

  it('registers and retrieves a widget by id', () => {
    registry.register(energinetPricesWidget);
    expect(registry.get('energinet-prices')).toBe(energinetPricesWidget);
  });

  it('throws on duplicate registration', () => {
    registry.register(energinetPricesWidget);
    expect(() => registry.register(energinetPricesWidget)).toThrow(
      'Widget "energinet-prices" is already registered'
    );
  });

  it('returns undefined for unknown id', () => {
    expect(registry.get('does-not-exist')).toBeUndefined();
  });

  it('lists all registered widgets', () => {
    registry.register(energinetPricesWidget);
    registry.register(weatherWidget);
    registry.register(newsWidget);
    expect(registry.list()).toHaveLength(3);
  });

  it('listMeta returns correct meta ids', () => {
    registry.register(energinetPricesWidget);
    registry.register(weatherWidget);
    const ids = registry.listMeta().map((m) => m.id);
    expect(ids).toContain('energinet-prices');
    expect(ids).toContain('weather');
  });

  it('has() returns true only for registered widgets', () => {
    registry.register(newsWidget);
    expect(registry.has('news')).toBe(true);
    expect(registry.has('energinet-prices')).toBe(false);
  });
});
