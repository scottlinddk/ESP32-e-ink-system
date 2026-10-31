import type { DisplayLayout, LayoutOutline, WidgetAlign, WidgetOutline } from '../types';

// Mirrors backend/src/utils/widgetFrame.ts: where a widget's content sits in its area, and the
// outline drawn around it. The outline can be set for the whole layout and overridden per widget.

/** Row by row, as the 3 × 3 picker shows them. `top-left` is where widgets draw on their own, so it is not stored. */
export const WIDGET_ALIGNMENTS: readonly WidgetAlign[] = [
  'top-left', 'top-center', 'top-right',
  'middle-left', 'middle-center', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right',
];
export const DEFAULT_ALIGN: WidgetAlign = 'top-left';
/** Mirrors the backend: the status widget sits bottom right unless it is given another position. */
export const defaultAlignFor = (widgetId: string): WidgetAlign => (widgetId === 'status' ? 'bottom-right' : DEFAULT_ALIGN);
export const LAYOUT_OUTLINES: readonly LayoutOutline[] = ['thin', 'thick', 'rounded', 'dashed'];

const ALIGN_LABELS: Record<WidgetAlign, { en: string; da: string }> = {
  'top-left': { en: 'Top left', da: 'Øverst til venstre' },
  'top-center': { en: 'Top centre', da: 'Øverst i midten' },
  'top-right': { en: 'Top right', da: 'Øverst til højre' },
  'middle-left': { en: 'Left', da: 'Til venstre' },
  'middle-center': { en: 'Centre', da: 'I midten' },
  'middle-right': { en: 'Right', da: 'Til højre' },
  'bottom-left': { en: 'Bottom left', da: 'Nederst til venstre' },
  'bottom-center': { en: 'Bottom centre', da: 'Nederst i midten' },
  'bottom-right': { en: 'Bottom right', da: 'Nederst til højre' },
};

/** Material Symbols arrow pointing to each position. */
export const ALIGN_ICONS: Record<WidgetAlign, string> = {
  'top-left': 'north_west', 'top-center': 'north', 'top-right': 'north_east',
  'middle-left': 'west', 'middle-center': 'adjust', 'middle-right': 'east',
  'bottom-left': 'south_west', 'bottom-center': 'south', 'bottom-right': 'south_east',
};

const OUTLINE_LABELS: Record<WidgetOutline, { en: string; da: string }> = {
  none: { en: 'None', da: 'Ingen' },
  thin: { en: 'Thin line', da: 'Tynd streg' },
  thick: { en: 'Thick line', da: 'Tyk streg' },
  rounded: { en: 'Rounded corners', da: 'Runde hjørner' },
  dashed: { en: 'Dashed line', da: 'Stiplet streg' },
};

export const alignLabel = (align: WidgetAlign, lang: 'da' | 'en') => ALIGN_LABELS[align][lang];
export const outlineLabel = (outline: WidgetOutline, lang: 'da' | 'en') => OUTLINE_LABELS[outline][lang];

/** Sets the outline every widget gets unless it chooses its own; none is the default and is not stored. */
export function updateLayoutOutline(layout: DisplayLayout, outline: WidgetOutline | undefined): DisplayLayout {
  const { outline: _previous, ...rest } = layout;
  return outline === undefined || outline === 'none' ? rest : { ...rest, outline };
}
