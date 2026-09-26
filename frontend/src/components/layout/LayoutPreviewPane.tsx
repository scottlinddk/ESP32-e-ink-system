// =========================================================================
// LayoutPreviewPane.tsx — sample content illustration for the layout editor
// =========================================================================
import React, { useState } from 'react';
import { DisplayLayout } from '../../types';
import { Icon } from '../ui/Logo';
import { EInk } from '../eink/EInk';
import { einkContent } from '../../lib/mockData';
import { useApp } from '../../lib/appContext';

interface LayoutPreviewPaneProps {
  layout: DisplayLayout;
}

export function LayoutPreviewPane({ layout }: LayoutPreviewPaneProps) {
  const { t, lang } = useApp();
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
        data={einkContent(lang)}
        lang={lang}
        strings={t}
        refreshToken={refreshToken}
        view="raw"
      />
      <p className="flex items-center gap-1 text-[11px] text-fg3 m-0 [&_.material-symbols-outlined]:text-[14px]">
        <Icon name="info" /> {t.layoutSampleNote}
      </p>
    </div>
  );
}

