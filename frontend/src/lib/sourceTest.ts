/** Maps a test outcome to the caller's own state shape. */
export interface SourceTestStates<T, S> {
  success: (result: T) => S;
  error: (error: unknown) => S;
  timeout: S;
}

// One mounted test owns its request; input changes dispose it so a late result is never shown.
export function createSourceTest<T, S>(publish: (state: S | { status: 'loading' }) => void, states: SourceTestStates<T, S>) {
  let current: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function dispose() { current?.abort(); current = undefined; clearTimeout(timer); }
  return {
    dispose,
    async run(load: (signal: AbortSignal) => Promise<T>) {
      dispose();
      const request = new AbortController();
      current = request;
      publish({ status: 'loading' });
      timer = setTimeout(() => {
        if (current !== request) return;
        dispose(); publish(states.timeout);
      }, 15_000);
      try {
        const result = await load(request.signal);
        if (current === request) publish(states.success(result));
      } catch (error) {
        if (current === request) publish(states.error(error));
      } finally {
        if (current === request) { clearTimeout(timer); current = undefined; }
      }
    },
  };
}
