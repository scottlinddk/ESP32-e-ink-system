import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { DisplayLayout } from '../../types';
import { useApp } from '../../lib/appContext';
import { useAuth } from '../../hooks/useAuth';
import { fetchDraftPreviewBmp } from '../../lib/api';
import { createDraftPreview, EMPTY_DRAFT_PREVIEW, DraftPreviewState } from '../../lib/draftPreview';
import { Button } from '../ui/button';
import { Spinner } from '../ui/Spinner';

export function LayoutPreviewPane({ layout }: { layout: DisplayLayout }) {
  const { t } = useApp();
  const { getToken, user } = useAuth();
  const [state, setState] = useState<DraftPreviewState>(EMPTY_DRAFT_PREVIEW);
  const preview = useMemo(() => createDraftPreview(setState), []);
  const layoutKey = JSON.stringify(layout);

  // An edited layout or changed account invalidates the image and in-flight work.
  useLayoutEffect(() => { preview.reset(); }, [preview, layoutKey, user?.id]);
  useEffect(() => () => preview.dispose(), [preview]);

  function renderDraft() {
    void preview.render(async (signal) => {
      const token = await getToken();
      signal.throwIfAborted();
      if (!token) throw new Error(t.previewSignIn);
      return fetchDraftPreviewBmp(token, layout, signal);
    });
  }

  return (
    <div className="flex flex-col gap-3" aria-busy={state.status === 'loading'}>
      <p className="text-xs text-fg2 m-0">{t.layoutPreviewNote}</p>
      {state.imageUrl && (
        <img src={state.imageUrl} alt={t.layoutPreviewAlt} className="w-full"
          style={{ height: 'auto', imageRendering: 'pixelated' }} />
      )}
      {state.status === 'loading' && (
        <div role="status" className="flex items-center gap-2 text-xs text-fg2"><Spinner />{t.previewLoading}</div>
      )}
      {state.status === 'idle' && <p className="text-xs text-fg3 m-0">{t.layoutPreviewReady}</p>}
      {state.status === 'error' && <p role="alert" className="text-xs text-warning m-0">{t.previewError}: {state.error}</p>}
      <Button variant="outlined" size="sm" icon="preview" onClick={renderDraft} disabled={state.status === 'loading'}>
        {state.status === 'error' ? t.retry : t.layoutPreviewRender}
      </Button>
    </div>
  );
}
