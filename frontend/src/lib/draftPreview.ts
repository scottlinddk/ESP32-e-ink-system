export type DraftPreviewState =
  | { status: 'idle' | 'loading'; imageUrl: null; error: null }
  | { status: 'success'; imageUrl: string; error: null }
  | { status: 'error'; imageUrl: null; error: string };

export const EMPTY_DRAFT_PREVIEW: DraftPreviewState = { status: 'idle', imageUrl: null, error: null };

/** Owns request cancellation and object URLs for one mounted draft preview. */
export function createDraftPreview(publish: (state: DraftPreviewState) => void) {
  let current: AbortController | undefined;
  let imageUrl: string | undefined;

  function release() {
    current?.abort();
    current = undefined;
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = undefined;
  }

  return {
    reset() { release(); publish(EMPTY_DRAFT_PREVIEW); },
    dispose: release,
    async render(load: (signal: AbortSignal) => Promise<Blob>) {
      release();
      const request = new AbortController();
      current = request;
      publish({ status: 'loading', imageUrl: null, error: null });
      try {
        const blob = await load(request.signal);
        // Some loaders cannot cancel token/body work. Ignore every late result.
        if (current !== request || request.signal.aborted) return;
        imageUrl = URL.createObjectURL(blob);
        publish({ status: 'success', imageUrl, error: null });
      } catch (error) {
        if (current !== request || request.signal.aborted) return;
        publish({ status: 'error', imageUrl: null, error: error instanceof Error ? error.message : 'Preview unavailable' });
      }
    },
  };
}
