// Bound the whole browser operation, including promises that never settle.
// Web Bluetooth cannot cancel an ATT operation; callers must stop their next
// write and disconnect after a deadline. Late settlements remain observed.
export async function bluetoothDeadline<T>(
  operation: () => Promise<T>, milliseconds: number, message: string, signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) throw signal.reason;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), milliseconds);
    abort = () => reject(signal?.reason ?? new Error('Bluetooth operation cancelled'));
    signal?.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([operation(), cancelled]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
