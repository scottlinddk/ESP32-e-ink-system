// =========================================================================
// EInk.tsx — authentic 2.13" e-ink render (250×122, 1-bit, ordered dither)
// =========================================================================
import React, { useRef, useEffect } from 'react';
import { hourlyPrices } from '../../lib/mockData';
import type { EinkContentData } from '../../lib/mockData';
import type { Strings } from '../../lib/strings';

const EINK_W = 250;
const EINK_H = 122;
// Bayer 4x4 ordered-dither matrix → characteristic e-ink pixel grain
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

const PAD = 8;
const mono = "'Roboto Mono', monospace";

// Ordered list of all supported source IDs.
// To add a new widget: add its ID here, add a renderer to SOURCE_RENDERERS,
// and wire up sources/keys in PreviewCard.
export type SourceId = 'energy' | 'weather' | 'news' | 'monta' | 'zaptec';
const SOURCE_ORDER: SourceId[] = ['energy', 'weather', 'news', 'monta', 'zaptec'];

function nf(lang: string, n: number, dec = 2): string {
  const s = n.toFixed(dec);
  return lang === 'da' ? s.replace('.', ',') : s;
}

function drawDownArrow(ctx: CanvasRenderingContext2D, x: number, y: number, up: boolean) {
  ctx.beginPath();
  if (up) {
    ctx.moveTo(x, y + 7);
    ctx.lineTo(x, y);
    ctx.moveTo(x - 3, y + 3);
    ctx.lineTo(x, y);
    ctx.lineTo(x + 3, y + 3);
  } else {
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + 7);
    ctx.moveTo(x - 3, y + 4);
    ctx.lineTo(x, y + 7);
    ctx.lineTo(x + 3, y + 4);
  }
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = '#000';
  ctx.stroke();
}

function drawCloud(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(x + 4, y + 7, 4, 0, Math.PI * 2);
  ctx.arc(x + 9, y + 5, 5, 0, Math.PI * 2);
  ctx.arc(x + 14, y + 7, 4, 0, Math.PI * 2);
  ctx.rect(x + 4, y + 7, 11, 4);
  ctx.fill();
  // rain ticks
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(x + 4 + i * 4, y + 12);
    ctx.lineTo(x + 2 + i * 4, y + 16);
    ctx.stroke();
  }
}

function drawNewsIcon(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#000';
  ctx.strokeRect(x + 0.5, y + 0.5, 14, 12);
  ctx.fillRect(x + 2, y + 2, 5, 5); // image block
  for (let i = 0; i < 3; i++) ctx.fillRect(x + 8, y + 2 + i * 2, 5, 1); // lines
  for (let i = 0; i < 3; i++) ctx.fillRect(x + 2, y + 9 + i * 0, 11, 1);
}

function dashedLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  x2: number,
  y: number
) {
  ctx.fillStyle = '#000';
  for (let x = x1; x < x2; x += 4) ctx.fillRect(x, y, 2, 1);
}

function drawChart(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  prices: number[],
  avg: number
) {
  const max = Math.max(...prices);
  const bw = w / prices.length;
  ctx.fillStyle = '#000';
  prices.forEach((p, i) => {
    const bh = Math.max(1, Math.round((p / max) * h));
    ctx.fillRect(
      Math.round(x + i * bw),
      y + h - bh,
      Math.max(1, Math.floor(bw) - 1),
      bh
    );
  });
  // average dashed line
  const ay = y + h - Math.round((avg / max) * h);
  ctx.fillStyle = '#000';
  for (let xx = x; xx < x + w; xx += 3) ctx.fillRect(xx, ay, 1, 1);
}

interface RenderOpts {
  sources: Record<SourceId, boolean>;
  keys: { weather: boolean; news: boolean; monta: boolean; zaptec: boolean };
  data: EinkContentData;
  lang: string;
  strings: Pick<Strings,
    | 'nothingSelectedCanvas'
    | 'energyLabel'
    | 'hours24'
    | 'avgShort'
    | 'weatherConnectKey'
    | 'wind'
    | 'newsConnectKey'
    | 'montaConnectCred'
    | 'zaptecConnectCred'
  >;
}

// ---- per-source renderers — return the pixel height consumed ----

function renderEnergy(ctx: CanvasRenderingContext2D, y: number, opts: RenderOpts): number {
  const { data, lang, strings: s } = opts;
  ctx.textAlign = 'left';
  ctx.font = `500 8px ${mono}`;
  ctx.fillText(s.energyLabel + ' · ' + data.zone, PAD, y + 7);
  drawChart(ctx, EINK_W - PAD - 92, y, 92, 22, hourlyPrices, data.avg);
  ctx.font = `500 7px ${mono}`;
  ctx.fillText(s.hours24, EINK_W - PAD - 92, y + 7 - 9 + 9);
  ctx.font = `700 28px ${mono}`;
  const price = nf(lang, data.price, 2);
  ctx.fillText(price, PAD - 1, y + 33);
  const pw = ctx.measureText(price).width;
  ctx.font = `500 9px ${mono}`;
  ctx.fillText('kr/kWh', PAD + pw + 4, y + 33);
  drawDownArrow(ctx, PAD + pw + 4, y + 36, data.trend === 'up');
  ctx.font = `400 9px ${mono}`;
  ctx.fillText(s.avgShort + nf(lang, data.avg, 2) + ' kr', PAD, y + 47);
  return 53;
}

function renderWeather(ctx: CanvasRenderingContext2D, y: number, opts: RenderOpts): number {
  const { keys, data, strings: s } = opts;
  if (!keys.weather) {
    ctx.font = `400 10px ${mono}`;
    ctx.fillText(s.weatherConnectKey, PAD, y + 12);
    return 20;
  }
  drawCloud(ctx, PAD, y);
  ctx.font = `500 12px ${mono}`;
  ctx.fillText(`${data.temp}°C`, PAD + 22, y + 12);
  ctx.font = `400 10px ${mono}`;
  ctx.fillText(`${data.cond} ${data.rain}% · ${s.wind} ${data.wind} m/s`, PAD + 22 + 42, y + 12);
  return 20;
}

function renderNews(ctx: CanvasRenderingContext2D, y: number, opts: RenderOpts): number {
  const { keys, data, strings: s } = opts;
  if (!keys.news) {
    ctx.font = `400 10px ${mono}`;
    ctx.fillText(s.newsConnectKey, PAD, y + 12);
    return 20;
  }
  drawNewsIcon(ctx, PAD, y + 1);
  ctx.font = `400 10px ${mono}`;
  const maxW = EINK_W - PAD - (PAD + 20);
  const words = data.news.split(' ');
  let line = '';
  const lines: string[] = [];
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  lines.slice(0, 2).forEach((ln, i) => ctx.fillText(ln, PAD + 20, y + 9 + i * 11));
  return 22;
}

function renderMonta(ctx: CanvasRenderingContext2D, y: number, opts: RenderOpts): number {
  const { keys, data, strings: s } = opts;
  if (!keys.monta) {
    ctx.font = `400 10px ${mono}`;
    ctx.fillText(s.montaConnectCred, PAD, y + 12);
    return 18;
  }
  const m = data.monta;
  ctx.font = `500 9px ${mono}`;
  ctx.fillText('Monta', PAD, y + 9);
  ctx.font = `400 9px ${mono}`;
  ctx.fillText(m.chargerStatus, PAD + 42, y + 9);
  if (m.session) {
    ctx.fillText('→ ' + m.session, PAD + 42, y + 19);
    return 22;
  }
  return 12;
}

function renderZaptec(ctx: CanvasRenderingContext2D, y: number, opts: RenderOpts): number {
  const { keys, data, strings: s } = opts;
  if (!keys.zaptec) {
    ctx.font = `400 10px ${mono}`;
    ctx.fillText(s.zaptecConnectCred, PAD, y + 12);
    return 18;
  }
  const z = data.zaptec;
  const label = z.installation ? `Zaptec · ${z.installation}` : 'Zaptec';
  ctx.font = `500 9px ${mono}`;
  ctx.fillText(label, PAD, y + 9);
  ctx.font = `400 9px ${mono}`;
  ctx.fillText(z.chargerStatus, PAD + 52, y + 9);
  if (z.session) {
    ctx.fillText('→ ' + z.session, PAD + 52, y + 19);
    return 22;
  }
  return 12;
}

// Registry: add an entry here when a new widget is created.
type SourceRenderFn = (ctx: CanvasRenderingContext2D, y: number, opts: RenderOpts) => number;
const SOURCE_RENDERERS: Record<SourceId, SourceRenderFn> = {
  energy: renderEnergy,
  weather: renderWeather,
  news: renderNews,
  monta: renderMonta,
  zaptec: renderZaptec,
};

function renderEink(ctx: CanvasRenderingContext2D, opts: RenderOpts) {
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, EINK_W, EINK_H);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'alphabetic';

  const enabled = SOURCE_ORDER.filter((id) => opts.sources[id]);

  if (enabled.length === 0) {
    ctx.textAlign = 'center';
    ctx.font = `400 11px ${mono}`;
    ctx.fillText(opts.strings.nothingSelectedCanvas, EINK_W / 2, EINK_H / 2);
    ctx.textAlign = 'left';
    return;
  }

  let y = PAD;
  enabled.forEach((id, idx) => {
    const h = SOURCE_RENDERERS[id](ctx, y, opts);
    y += h;
    if (idx < enabled.length - 1) {
      dashedLine(ctx, PAD, EINK_W - PAD, y);
      y += 7;
    }
  });
}

function ditherTo1bit(ctx: CanvasRenderingContext2D) {
  const img = ctx.getImageData(0, 0, EINK_W, EINK_H);
  const d = img.data;
  for (let py = 0; py < EINK_H; py++) {
    for (let px = 0; px < EINK_W; px++) {
      const i = (py * EINK_W + px) * 4;
      const lum = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.587) / 255;
      const threshold = (BAYER[(py & 3) * 4 + (px & 3)] + 0.5) / 16;
      const v = lum > threshold ? 255 : 0;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

interface EInkProps {
  sources: Record<SourceId, boolean>;
  keys: { weather: boolean; news: boolean; monta: boolean; zaptec: boolean };
  data: EinkContentData;
  lang: string;
  strings: RenderOpts['strings'];
  refreshToken: number;
  view?: 'device' | 'raw' | 'clear';
}

export function EInk({ sources, keys, data, lang, strings, refreshToken, view = 'device' }: EInkProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const first = useRef(true);

  const paint = () => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = view === 'clear';
    renderEink(ctx, { sources, keys, data, lang, strings });
    if (view !== 'clear') ditherTo1bit(ctx);
  };

  const flashThenPaint = () => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const fill = (c: string) => {
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, EINK_W, EINK_H);
    };
    fill('#000');
    timers.current.push(setTimeout(() => fill('#fff'), 110));
    timers.current.push(setTimeout(() => fill('#000'), 200));
    timers.current.push(setTimeout(() => fill('#fff'), 290));
    timers.current.push(setTimeout(() => paint(), 380));
  };

  // First paint instant; subsequent prop changes repaint without flash
  useEffect(() => {
    paint();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(sources), JSON.stringify(keys), lang, view]);

  // Explicit refresh → e-ink flash animation
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    flashThenPaint();
    return () => timers.current.forEach(clearTimeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  return (
    <canvas
      ref={canvasRef}
      width={EINK_W}
      height={EINK_H}
      className="eink-screen"
      style={view !== 'device' ? { maxWidth: EINK_W * 3, width: '100%' } : undefined}
      role="img"
      aria-label="E-ink display preview"
    />
  );
}
