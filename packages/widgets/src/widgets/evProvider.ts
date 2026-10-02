// Provider replies are untrusted: cap their bodies and keep upstream text out of diagnostics.
export async function providerJson(
  url: string, init: RequestInit & { signal: AbortSignal }, provider: string,
): Promise<unknown> {
  const { signal } = init;
  signal.throwIfAborted();
  let response: Response;
  try { response = await fetch(url, { ...init, redirect: 'error' }); }
  catch { signal.throwIfAborted(); throw new Error(`${provider} request failed`); }
  if (signal.aborted || !response.ok || Number(response.headers.get('content-length')) > 1_048_576) {
    void response.body?.cancel().catch(() => {});
    signal.throwIfAborted();
    throw new Error(!response.ok ? `${provider} request failed (${response.status})` : `${provider} response too large`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error(`${provider} returned an invalid response`);
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > 1_048_576) { cancel(); throw new Error('Body too large'); }
      chunks.push(value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    signal.throwIfAborted();
    throw new Error(`${provider} returned an invalid response`);
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}
