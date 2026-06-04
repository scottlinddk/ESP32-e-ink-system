// =========================================================================
// LayoutPreviewPane.tsx — debounced live BMP preview for the layout editor
// =========================================================================
import React, { useEffect, useRef, useState } from 'react';
import { DisplayLayout } from '../../types';
import { Spinner } from '../ui/Spinner';
import { Icon } from '../ui/Logo';
import { fetchPreviewBmp } from '../../lib/api';

interface LayoutPreviewPaneProps {
  layout: DisplayLayout;
  token: string | null;
  debounceMs?: number;
}

export function LayoutPreviewPane({ layout, token, debounceMs = 800 }: LayoutPreviewPaneProps) {
  const [bmpSrc, setBmpSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prevBmpRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!token) return;

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(() => {
      setLoading(true);
      setError(null);

      fetchPreviewBmp(token)
        .then((url) => {
          if (prevBmpRef.current) URL.revokeObjectURL(prevBmpRef.current);
          prevBmpRef.current = url;
          setBmpSrc(url);
          setLoading(false);
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : 'Failed to load preview');
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
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Skeleton overlay while loading */}
        {loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.7)' }}>
            <Spinner />
          </div>
        )}

        {error && !loading && (
          <div style={{ textAlign: 'center', padding: 8 }}>
            <Icon name="cloud_off" />
            <div style={{ fontSize: 10, color: '#666', marginTop: 4 }}>{error}</div>
          </div>
        )}

        {bmpSrc && !error && (
          <img
            src={bmpSrc}
            alt="Display preview"
            width={250}
            height={122}
            style={{ imageRendering: 'pixelated', display: 'block', opacity: loading ? 0.5 : 1 }}
          />
        )}

        {!bmpSrc && !loading && !error && (
          <LayoutSkeleton layout={layout} />
        )}
      </div>
      <p className="layout-preview-note">
        <Icon name="info" /> Live preview — updates after each change
      </p>
    </div>
  );
}

// Simple grey-box skeleton rendered immediately from layout data
function LayoutSkeleton({ layout }: { layout: DisplayLayout }) {
  const COL_PX = 250 / layout.cols;
  const ROW_PX = 122 / layout.rows;

  return (
    <svg width={250} height={122} style={{ display: 'block' }}>
      {layout.widgets.map((w) => (
        <rect
          key={w.i}
          x={w.x * COL_PX + 1}
          y={w.y * ROW_PX + 1}
          width={w.w * COL_PX - 2}
          height={w.h * ROW_PX - 2}
          fill="#e8e8e8"
          stroke="#bbb"
          strokeWidth={1}
          rx={2}
        />
      ))}
    </svg>
  );
}
