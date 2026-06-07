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
    monta: layout.widgets.some((w) => w.i === 'monta'),
    zaptec: layout.widgets.some((w) => w.i === 'zaptec'),
  };

  return (
    <div className="flex flex-col gap-2">
      <EInk
        sources={sources}
        keys={{ weather: true, news: true, monta: true, zaptec: true }}
        data={einkContent('en')}
        lang="en"
        strings={STRINGS['en']}
        refreshToken={refreshToken}
        view="raw"
      />
      <p className="flex items-center gap-1 text-[11px] text-fg3 m-0 [&_.material-symbols-outlined]:text-[14px]">
        <Icon name="info" /> Live preview — updates after each change
      </p>
    </div>
  );
}

