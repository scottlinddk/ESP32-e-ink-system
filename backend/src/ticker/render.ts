// Drawing primitives produced by the ticker views. The canvas in utils/bmpGenerator.ts
// draws them; they are kept structurally identical to packages/types RenderElement.
export interface PixelRegion { widthPx: number; heightPx: number }

export type RenderElement =
  | { kind: 'text'; text: string; x: number; y: number; fontSize: number }
  | { kind: 'hline'; x: number; y: number; width: number }
  | { kind: 'rect'; x: number; y: number; width: number; height: number; fill: boolean };

export interface RenderedWidget { region: PixelRegion; elements: RenderElement[] }
