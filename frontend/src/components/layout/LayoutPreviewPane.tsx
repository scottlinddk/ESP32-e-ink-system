// =========================================================================
// LayoutPreviewPane.tsx — debounced live BMP preview for the layout editor
// =========================================================================
import React, { useEffect, useRef, useState } from 'react';
import { DisplayLayout } from '../../types';
import { Spinner } from '../ui/Spinner';
import { Icon } from '../ui/Logo';
import { fetchPreviewBmp } from '../../lib/api';

const WIDGET_LABELS: Record<string, string> = {
  energy: 'Energy price',
  weather: 'Weather',
  news: 'News',
  status: 'Status',
};

interface LayoutPreviewPaneProps {
  layout: DisplayLayout;
  token: string | null;
  debounceMs?: number;
}

export function LayoutPreviewPane({ layout, token, debounceMs = 800 }: LayoutPreviewPaneProps) {
  const [bmpSrc, setBmpSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const prevBmpRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!token) return;

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(() => {
      setLoading(true);

      fetchPreviewBmp(token)
        .then((url) => {
          if (prevBmpRef.current) URL.revokeObjectURL(prevBmpRef.current);
          prevBmpRef.current = url;
          setBmpSrc(url);
          setLoading(false);
        })
        .catch((err: unknown) => {
          // Fall back to skeleton silently — backend may be unavailable
          console.warn('Preview BMP fetch failed:', err);
          setLoading(false);
        });
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [layout, token, debounceMs]);

  useEffect(() => {
    return () => {
      if (prevBmpRef.current) URL.revokeObjectURL(prevBmpRef.current);
    };
  }, []);

  return (
    <div className="layout-preview-pane">
      <div
        className="eink-screen"
        style={{
          width: 250,
          height: 122,
          position: 'relative',
          background: '#fff',
          border: '1px solid #ccc',
          overflow: 'hidden',
        }}
      >
        {/* Labelled skeleton — always visible until a real BMP is loaded */}
        {!bmpSrc && <LayoutSkeleton layout={layout} />}

        {/* Real BMP overlaid once available */}
        {bmpSrc && (
          <img
            src={bmpSrc}
            alt="Display preview"
            width={250}
            height={122}
            style={{ imageRendering: 'pixelated', display: 'block', position: 'absolute', inset: 0, opacity: loading ? 0.5 : 1 }}
          />
        )}

        {/* Loading spinner overlay */}
        {loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.6)' }}>
            <Spinner />
          </div>
        )}
      </div>
      <p className="layout-preview-note">
        <Icon name="info" /> Live preview — updates after each change
      </p>
    </div>
  );
}

// Labelled grey-box skeleton — always shown while the BMP is loading or unavailable
function LayoutSkeleton({ layout }: { layout: DisplayLayout }) {
  const COL_PX = 250 / layout.cols;
  const ROW_PX = 122 / layout.rows;

  return (
    <svg width={250} height={122} style={{ display: 'block' }}>
      {layout.widgets.map((w) => {
        const x = w.x * COL_PX + 1;
        const y = w.y * ROW_PX + 1;
        const width = w.w * COL_PX - 2;
        const height = w.h * ROW_PX - 2;
        const label = WIDGET_LABELS[w.i] ?? w.i;
        return (
          <g key={w.i}>
            <rect
              x={x} y={y} width={width} height={height}
              fill="#f0f0f0" stroke="#bbb" strokeWidth={1} rx={2}
            />
            <text
              x={x + width / 2}
              y={y + height / 2 + 3}
              fontSize={8}
              fill="#888"
              textAnchor="middle"
              fontFamily="sans-serif"
            >
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
