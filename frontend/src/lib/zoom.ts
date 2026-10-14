import type { DisplayLayout } from '../types';
import type { DisplayProfile } from './displayProfile';

// Mirrors backend/src/utils/zoom.ts. Zoom is a whole-number enlargement of what a widget
// draws: a layout sets the default, each widget placement may override it, and with
// neither the server picks one from the panel size.
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
export const ZOOMS = [1, 2, 3, 4] as const;

const AUTO_MIN_WIDTH = 200;
const AUTO_MIN_HEIGHT = 100;

/** Zoom the server uses when none is chosen, for the panel size after rotation. */
export function autoZoom(profile: Pick<DisplayProfile, 'width' | 'height' | 'rotation'>): number {
  const turned = profile.rotation === 90 || profile.rotation === 270;
  const width = turned ? profile.height : profile.width;
  const height = turned ? profile.width : profile.height;
  const factor = Math.floor(Math.min(width / AUTO_MIN_WIDTH, height / AUTO_MIN_HEIGHT));
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number.isFinite(factor) ? factor : MIN_ZOOM));
}

/** The zoom a widget without its own setting is drawn at. */
export function inheritedZoom(layout: Pick<DisplayLayout, 'zoom'>, profile: Pick<DisplayProfile, 'width' | 'height' | 'rotation'>): number {
  return layout.zoom ?? autoZoom(profile);
}

/** Sets the layout's default zoom; undefined removes it so the server chooses again. */
export function updateLayoutZoom(layout: DisplayLayout, zoom: number | undefined): DisplayLayout {
  const { zoom: _previous, ...rest } = layout;
  return zoom === undefined ? rest : { ...rest, zoom };
}

export const zoomLabel = (zoom: number) => `${zoom}×`;
