import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { drawWidgetOutlines, outlineBoxes, type WidgetFrame, type LayoutOutline } from '../utils/widgetFrame';

function frame(x: number, y: number, width: number, height: number, outline: LayoutOutline, scale: number): WidgetFrame {
  const cell = { x, y, width, height };
  return { cell, frame: outlineBoxes(cell, outline, scale).frame, outline, scale };
}

function render(frames: WidgetFrame[]) {
  const ink = new Set<string>();
  drawWidgetOutlines({ fillRect(x, y, w, h) {
    for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) ink.add(`${px},${py}`);
  } }, frames);
  return (x: number, y: number) => ink.has(`${x},${y}`);
}

describe('shared widget outlines', () => {
  for (const outline of ['thin', 'thick', 'rounded', 'dashed'] as const) for (const scale of [1, 2, 3]) {
    it(`uses one physical pixel for horizontal and vertical neighbours: ${outline}, scale ${scale}`, () => {
      const ink = render([
        frame(0, 0, 60, 60, outline, scale), frame(60, 0, 60, 60, outline, scale),
        frame(0, 60, 60, 60, outline, scale), frame(60, 60, 60, 60, outline, scale),
      ]);
      for (let p = 15; p < 45; p++) for (let offset = -10; offset <= 10; offset++) {
        assert.equal(ink(60 + offset, p), offset === 0);
        assert.equal(ink(p, 60 + offset), offset === 0);
      }
    });
  }

  it('handles partial neighbours and mixed styles without drawing exposed edges', () => {
    const left = frame(0, 0, 60, 120, 'thick', 2);
    const right = frame(60, 0, 60, 60, 'rounded', 1);
    const ink = render([left, right]);
    for (let x = 50; x < 70; x++) assert.equal(ink(x, 30), x === 60);
    const isolated = render([left]);
    for (let x = 50; x < 70; x++) assert.equal(ink(x, 90), isolated(x, 90));
    assert.equal(ink(60, 90), false);
  });

  it('draws just one divider midway between separated widgets', () => {
    const ink = render([frame(0, 0, 60, 60, 'thin', 1), frame(65, 0, 60, 60, 'thin', 1)]);
    assert.equal(ink(58, 30), false);
    assert.equal(ink(66, 30), false);
    for (let x = 59; x < 66; x++) assert.equal(ink(x, 30), x === 62);
  });
});

it('draws no outer box for an isolated widget', () => {
  const ink = render([frame(0, 0, 60, 60, 'thin', 3)]);
  for (let y = 0; y < 60; y++) for (let x = 0; x < 60; x++) assert.equal(ink(x, y), false);
});

it('does not draw dividers through intermediate widgets', () => {
  const ink = render([frame(0, 0, 60, 60, 'thin', 1), frame(80, 0, 60, 60, 'thin', 1), frame(160, 0, 60, 60, 'thin', 1)]);
  for (let x = 60; x < 160; x++) assert.equal(ink(x, 30), x === 70 || x === 150);
});

it('respects widgets opting out and still separates an outlined neighbour', () => {
  const a = frame(0, 0, 60, 60, 'thin', 1);
  const b = { ...frame(60, 0, 60, 60, 'thin', 1), outline: 'none' as const };
  assert.equal(render([a, b])(60, 30), true);
  assert.equal(render([{ ...a, outline: 'none' }, b])(60, 30), false);
});
