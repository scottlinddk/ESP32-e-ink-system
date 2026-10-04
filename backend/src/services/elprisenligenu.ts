// Danish day-ahead spot prices from Elprisen lige nu (https://www.elprisenligenu.dk/elpris-api).
// One static JSON file per Danish calendar day and price area; prices exclude VAT, taxes and tariffs.
const BASE_URL = 'https://www.elprisenligenu.dk/api/v1/prices';
const OFFSET_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[zZ]|[+-]\d{2}:\d{2})$/;
const danishDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit',
});

export interface ElprisRecord {
  DKK_per_kWh: number;
  EUR_per_kWh: number;
  EXR: number;
  time_start: string;
  time_end: string;
}

export interface SpotInterval {
  start: number;
  end: number;
  /** øre/kWh excluding VAT, taxes and tariffs */
  price: number;
}

export function elprisUrl(priceArea: string, instant: number): string {
  const [year, month, day] = danishDate.format(instant).split('-');
  return `${BASE_URL}/${year}/${month}-${day}_${priceArea}.json`;
}

/** Fetches every published interval of the Danish calendar day containing `instant`. */
export async function fetchDanishDaySpot(
  priceArea: string, instant: number, signal: AbortSignal,
): Promise<SpotInterval[]> {
  const response = await fetch(elprisUrl(priceArea, instant), {
    headers: { Accept: 'application/json' }, signal,
  });
  // Days that are not yet published return 404.
  if (!response.ok) throw new Error(`Elprisen lige nu API error: ${response.status} ${response.statusText}`);
  const json: unknown = await response.json();
  signal.throwIfAborted();
  const day = danishDate.format(instant);
  return (Array.isArray(json) ? json as Partial<ElprisRecord>[] : [])
    // An offset-less timestamp would be read in the server's zone, so it is rejected.
    .filter((r) => r && typeof r.time_start === 'string' && OFFSET_TIMESTAMP.test(r.time_start)
      && typeof r.time_end === 'string' && OFFSET_TIMESTAMP.test(r.time_end)
      && typeof r.DKK_per_kWh === 'number' && Number.isFinite(r.DKK_per_kWh))
    .map((r) => ({
      // Timestamps carry the Danish UTC offset, so both repeated autumn hours stay distinct.
      start: Date.parse(r.time_start!),
      end: Date.parse(r.time_end!),
      price: r.DKK_per_kWh! * 100, // DKK/kWh -> øre/kWh.
    }))
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.start < r.end
      && danishDate.format(r.start) === day)
    .sort((a, b) => a.start - b.start);
}
