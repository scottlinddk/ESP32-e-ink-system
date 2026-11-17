/** A minimal ZIP writer: no compression ("stored" entries), UTF-8 names. Enough for a few small text files. */

export interface ZipEntry { name: string; data: Uint8Array }

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS date and time for a fixed instant, so the same files always give the same archive. */
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

export function createZip(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const names = entries.map(entry => encoder.encode(entry.name));
  names.forEach((name, i) => {
    if (name.length === 0 || name.length > 0xffff || entries[i].name.startsWith('/') || entries[i].name.includes('..')) throw new Error(`Invalid file name in archive: ${entries[i].name}`);
  });
  if (entries.length > 0xffff) throw new Error('Too many files for an archive');
  const local = entries.reduce((sum, entry, i) => sum + 30 + names[i].length + entry.data.length, 0);
  const central = entries.reduce((sum, _entry, i) => sum + 46 + names[i].length, 0);
  const total = local + central + 22;
  if (total > 0xffffffff) throw new Error('Archive too large');
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  const offsets: number[] = [];
  let pos = 0;
  entries.forEach((entry, i) => {
    offsets.push(pos);
    view.setUint32(pos, 0x04034b50, true);
    view.setUint16(pos + 4, 20, true);
    view.setUint16(pos + 6, 0x0800, true); // UTF-8 names
    view.setUint16(pos + 8, 0, true); // stored
    view.setUint16(pos + 10, DOS_TIME, true);
    view.setUint16(pos + 12, DOS_DATE, true);
    view.setUint32(pos + 14, crc32(entry.data), true);
    view.setUint32(pos + 18, entry.data.length, true);
    view.setUint32(pos + 22, entry.data.length, true);
    view.setUint16(pos + 26, names[i].length, true);
    view.setUint16(pos + 28, 0, true);
    out.set(names[i], pos + 30);
    out.set(entry.data, pos + 30 + names[i].length);
    pos += 30 + names[i].length + entry.data.length;
  });
  const centralStart = pos;
  entries.forEach((entry, i) => {
    view.setUint32(pos, 0x02014b50, true);
    view.setUint16(pos + 4, 20, true);
    view.setUint16(pos + 6, 20, true);
    view.setUint16(pos + 8, 0x0800, true);
    view.setUint16(pos + 10, 0, true);
    view.setUint16(pos + 12, DOS_TIME, true);
    view.setUint16(pos + 14, DOS_DATE, true);
    view.setUint32(pos + 16, crc32(entry.data), true);
    view.setUint32(pos + 20, entry.data.length, true);
    view.setUint32(pos + 24, entry.data.length, true);
    view.setUint16(pos + 28, names[i].length, true);
    view.setUint32(pos + 42, offsets[i], true);
    out.set(names[i], pos + 46);
    pos += 46 + names[i].length;
  });
  view.setUint32(pos, 0x06054b50, true);
  view.setUint16(pos + 8, entries.length, true);
  view.setUint16(pos + 10, entries.length, true);
  view.setUint32(pos + 12, central, true);
  view.setUint32(pos + 16, centralStart, true);
  return out;
}
