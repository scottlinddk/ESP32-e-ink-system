import { z } from 'zod';
import { Client } from '@notionhq/client';
import type { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import type { Widget, PixelRegion, TypographyScale, RenderedWidget, WidgetResult } from '@esp32-eink/types';
import type { NotionConfig, NotionData, NotionRow } from './types';

export const configSchema = z.object({
  token: z.string().min(1),
  databaseId: z.string().min(1),
  titleProperty: z.string().optional(),
  statusProperty: z.string().optional(),
  filterStatus: z.string().optional(),
  maxItems: z.number().int().min(1).max(10).optional(),
});

function extractTitle(page: PageObjectResponse, propName: string): string {
  const prop = page.properties[propName];
  if (!prop) return '(Untitled)';
  if (prop.type === 'title') {
    return prop.title.map((t) => t.plain_text).join('') || '(Untitled)';
  }
  return '(Untitled)';
}

function extractText(page: PageObjectResponse, propName: string): string | undefined {
  const prop = page.properties[propName];
  if (!prop) return undefined;
  switch (prop.type) {
    case 'select': return prop.select?.name ?? undefined;
    case 'status': return prop.status?.name ?? undefined;
    case 'rich_text': return prop.rich_text.map((t) => t.plain_text).join('') || undefined;
    case 'date': return prop.date?.start ?? undefined;
    case 'checkbox': return prop.checkbox ? '✓' : undefined;
    default: return undefined;
  }
}

function parseDatabaseId(raw: string): string {
  // Accept full Notion URL or bare 32-char hex ID
  const clean = raw.replace(/-/g, '').replace(/^.*\/([a-f0-9]{32})(\?.*)?$/, '$1');
  if (/^[a-f0-9]{32}$/i.test(clean)) {
    return `${clean.slice(0, 8)}-${clean.slice(8, 12)}-${clean.slice(12, 16)}-${clean.slice(16, 20)}-${clean.slice(20)}`;
  }
  return raw; // return as-is and let the API error if invalid
}

async function fetchRows(config: NotionConfig): Promise<NotionData> {
  const client = new Client({ auth: config.token, notionVersion: '2025-09-03' });
  const dbId = parseDatabaseId(config.databaseId);
  const titleProp = config.titleProperty ?? 'Name';
  const maxItems = config.maxItems ?? 4;

  const filter =
    config.filterStatus && config.statusProperty
      ? { property: config.statusProperty, status: { equals: config.filterStatus } }
      : undefined;

  const response = await client.dataSources.query({
    data_source_id: dbId,
    ...(filter ? { filter } : {}),
    page_size: maxItems,
  });

  const rows: NotionRow[] = response.results
    .filter((p): p is PageObjectResponse => (p as PageObjectResponse).object === 'page' && 'properties' in p)
    .map((page: PageObjectResponse) => ({
      id: page.id,
      title: extractTitle(page, titleProp).slice(0, 40),
      subtitle: config.statusProperty ? extractText(page, config.statusProperty) : undefined,
    }));

  return { rows };
}

export const notionWidget: Widget<NotionConfig, NotionData> = {
  meta: {
    id: 'notion',
    name: 'Notion Database',
    description: 'Rows from a Notion database (task list, reading list, etc.).',
    category: 'general',
  },

  configSchema,

  async fetch(config: NotionConfig, _region: PixelRegion): Promise<WidgetResult<NotionData>> {
    try {
      const data = await fetchRows(config);
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  render(data: NotionData, region: PixelRegion, typography: TypographyScale): RenderedWidget {
    const elements: RenderedWidget['elements'] = [];
    let y = 2;

    const header = data.databaseName ?? 'Notion';
    elements.push({ kind: 'text', text: header, x: 2, y, fontSize: typography.sm });
    y += typography.sm + 3;
    elements.push({ kind: 'hline', x: 0, y, width: region.widthPx });
    y += 3;

    if (data.rows.length === 0) {
      elements.push({ kind: 'text', text: 'No items', x: 2, y, fontSize: typography.sm });
    } else {
      for (const row of data.rows) {
        if (y + typography.sm > region.heightPx - 2) break;
        const line = row.subtitle ? `${row.title}  ${row.subtitle}` : row.title;
        elements.push({ kind: 'text', text: line, x: 2, y, fontSize: typography.sm });
        y += typography.sm + 2;
      }
    }

    return { region, elements };
  },
};
