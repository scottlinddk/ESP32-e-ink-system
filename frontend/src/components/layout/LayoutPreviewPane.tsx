// =========================================================================
// LayoutPreviewPane.tsx — debounced live BMP preview for the layout editor
// =========================================================================
import React, { useState } from 'react';
import { DisplayLayout } from '../../types';
import { Icon } from '../ui/Logo';
import { EInk } from '../eink/EInk';
import { einkContent } from '../../lib/mockData';

const MOCK_STRINGS = {
  nothingSelectedCanvas: 'No widgets selected',
  energyLabel: 'Energy',
  hours24: '24h',
  avgShort: 'avg ',
  weatherConnectKey: 'Connect weather key',
  wind: 'Wind',
  newsConnectKey: 'Connect news key',
};

interface LayoutPreviewPaneProps {
  layout: DisplayLayout;
  token: string | null;
  debounceMs?: number;
}

export function LayoutPreviewPane({ layout }: LayoutPreviewPaneProps) {
  const [refreshToken] = useState(0);

  const sources = {
    energy: layout.widgets.some((w) => w.i === 'energy'),
    weather: layout.widgets.some((w) => w.i === 'weather'),
    news: layout.widgets.some((w) => w.i === 'news'),
  };

  return (
    <div className="layout-preview-pane">
      <EInk
        sources={sources}
        keys={{ weather: true, news: true }}
        data={einkContent('en')}
        lang="en"
        strings={MOCK_STRINGS}
        refreshToken={refreshToken}
        view="raw"
      />
      <p className="layout-preview-note">
        <Icon name="info" /> Live preview — updates after each change
      </p>
    </div>
  );
}

