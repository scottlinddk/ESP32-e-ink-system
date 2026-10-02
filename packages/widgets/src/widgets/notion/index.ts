import { z } from 'zod';
import type { Widget, PixelRegion, TypographyScale, RenderedWidget, WidgetResult } from '@esp32-eink/types';
import type { NotionConfig, NotionData } from './types';

import { fetchNotionRows, NotionSourceError } from './client';
import { normalizeNotionCredentials } from './credentials';

export const configSchema = z.unknown().transform((value, context) => {
  try { return normalizeNotionCredentials(value); }
  catch (error) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: error instanceof Error ? error.message : 'Invalid Notion configuration.' });
    return z.NEVER;
  }
});
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
      const data = await fetchNotionRows(config);
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err instanceof NotionSourceError ? err.message : 'Notion is unavailable. Try again later.' };
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
