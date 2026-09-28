// Protocol fields verified against OpenDisplay/Firmware include/opendisplay_structs.h
// and py-opendisplay protocol/config_parser.py. Commands use network byte order;
// native configuration integers use little endian.
import { bluetoothDeadline } from './bluetoothDeadline';
export interface PanelCapabilities { width: number; height: number; color: number; }
const PACKET_SIZES: Record<number, number> = { 1:22, 2:22, 4:30, 0x20:46, 0x21:22, 0x23:30, 0x24:30, 0x25:30, 0x26:160, 0x27:64, 0x28:32, 0x29:32, 0x2a:32, 0x2b:32, 0x2c:288 };

export function parsePanelConfig(bytes: Uint8Array): PanelCapabilities {
  if (bytes.length < 5 || bytes.length > 8192 || bytes[2] !== 1) throw new Error('Unsupported OpenDisplay configuration');
  const panels: PanelCapabilities[] = [];
  let offset = 3;
  while (offset < bytes.length - 2) {
    const type = bytes[offset + 1];
    // Older firmware has a 65-byte Wi-Fi packet, supported only at the end
    // (the same unambiguous fallback used by the upstream SDK).
    const remaining = bytes.length - 2 - (offset + 2);
    const size = type === 0x26 && remaining === 65 ? 65 : PACKET_SIZES[type];
    if (!size || offset + 2 + size > bytes.length - 2) throw new Error('Incomplete or unsupported OpenDisplay configuration');
    const start = offset + 2;
    if (type === 0x20) {
      const view = new DataView(bytes.buffer, bytes.byteOffset + start, size);
      panels.push({ width: view.getUint16(4, true), height: view.getUint16(6, true), color: view.getUint8(21) });
    }
    offset += size + 2;
  }
  if (offset !== bytes.length - 2 || panels.length !== 1) throw new Error('Exactly one configured display is required');
  return panels[0];
}

export async function readPanelConfig(char: BluetoothRemoteGATTCharacteristic, signal?: AbortSignal): Promise<PanelCapabilities> {
  let cleanup = () => {};
  let active = true;
  const reply = new Promise<PanelCapabilities>((resolve, reject) => {
    let expected = -1, sequence = 0;
    const chunks: number[] = [];
    const listener = () => {
      if (!active) return;
      const value = char.value;
      if (!value || value.byteLength < 2) return;
      const code = value.getUint16(0, false);
      if (code === 0xff40) { reject(new Error('Display configuration is unavailable or requires authentication')); return; }
      if (code !== 0x40 && code !== 0x8040) return;
      try {
        const header = expected < 0 ? 6 : 4;
        if (value.byteLength <= header || value.getUint16(2, true) !== sequence++) throw new Error('Malformed display configuration chunks');
        if (expected < 0) expected = value.getUint16(4, true);
        if (expected < 5 || expected > 8192) throw new Error('Display configuration exceeds bounds');
        for (let i = header; i < value.byteLength; i++) chunks.push(value.getUint8(i));
        if (chunks.length > expected) throw new Error('Display configuration length mismatch');
        if (chunks.length === expected) resolve(parsePanelConfig(new Uint8Array(chunks)));
      } catch (error) { reject(error); }
    };
    char.addEventListener('characteristicvaluechanged', listener);
    cleanup = () => { active = false; char.removeEventListener('characteristicvaluechanged', listener); };
  });
  // Install listeners before writing: fast notifications can arrive during write.
  void reply.catch(() => {});
  try {
    const [, panel] = await bluetoothDeadline(() => Promise.all([
      (async () => {
        await char.startNotifications();
        // A late subscription must not issue a read after timeout/disconnect.
        if (!active || signal?.aborted) return;
        await char.writeValueWithResponse(new Uint8Array([0, 0x40]));
      })(),
      reply,
    ]), 5000, 'Display configuration timed out. Update OpenDisplay firmware or use the image export.', signal);
    return panel;
  } finally { cleanup(); }
}
