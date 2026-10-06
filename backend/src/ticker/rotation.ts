export interface Page<T> {
  items: T[];
  /** 1-based. */
  page: number;
  pageCount: number;
}

/**
 * Picks which page to show for a moment in time. Stateless on purpose: the
 * widget is rendered by independent requests, so the page is derived from the
 * clock (`floor(now / dwell) % pages`) rather than from a stored counter.
 */
export function pickPage<T>(items: readonly T[], perPage: number, dwellMinutes: number, nowMs: number): Page<T> {
  const size = Math.max(1, Math.floor(perPage));
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const dwellMs = Math.max(1, dwellMinutes) * 60_000;
  const index = Math.floor(nowMs / dwellMs) % pageCount;
  return { items: items.slice(index * size, (index + 1) * size), page: index + 1, pageCount };
}
