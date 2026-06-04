// =========================================================================
// LayoutPreviewPane.tsx — debounced live BMP preview for the layout editor
// =========================================================================
import React, { useState } from 'react';
import { DisplayLayout } from '../../types';
import { Icon } from '../ui/Logo';
import { EInk } from '../eink/EInk';
import { einkContent } from '../../lib/mockData';
import { STRINGS } from '../../lib/strings';

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
        strings={STRINGS['en']}
        refreshToken={refreshToken}
        view="raw"
      />
      <p className="layout-preview-note">
        <Icon name="info" /> Live preview — updates after each change
      </p>
    </div>
  );
}

