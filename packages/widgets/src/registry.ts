import type {
  Widget,
  WidgetMeta,
  PixelRegion,
  TypographyScale,
  RenderedWidget,
  WidgetResult,
  Schema,
} from '@esp32-eink/types';

// Type-erased storage interface — widget generics are lost intentionally at the
// registry boundary. Callers recover types by going through configSchema.parse().
interface WidgetBox {
  meta: WidgetMeta;
  configSchema: Schema<unknown>;
  fetch(config: unknown, region: PixelRegion): Promise<WidgetResult<unknown>>;
  render(data: unknown, region: PixelRegion, typography: TypographyScale): RenderedWidget;
}

export class WidgetRegistry {
  private readonly widgets = new Map<string, WidgetBox>();

  register<TConfig, TData>(widget: Widget<TConfig, TData>): void {
    if (this.widgets.has(widget.meta.id)) {
      throw new Error(`Widget "${widget.meta.id}" is already registered`);
    }
    // Safe cast: we intentionally erase generics for heterogeneous storage.
    // Type safety is recovered at call sites via configSchema.parse().
    this.widgets.set(widget.meta.id, widget as unknown as WidgetBox);
  }

  get(id: string): WidgetBox | undefined {
    return this.widgets.get(id);
  }

  list(): WidgetBox[] {
    return [...this.widgets.values()];
  }

  listMeta(): WidgetMeta[] {
    return [...this.widgets.values()].map((w) => w.meta);
  }

  has(id: string): boolean {
    return this.widgets.has(id);
  }
}

export const widgetRegistry = new WidgetRegistry();
