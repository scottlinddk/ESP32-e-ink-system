import { frameMetadata, DEFAULT_DISPLAY_PROFILE, DisplayProfile } from './displayProfile';
import { readPanelConfig } from './openDisplayConfig';
// OpenDisplay BLE direct-write protocol (uncompressed path).
//
// The device advertises as "OD<chip-id-hex>" (e.g. "OD4A2B3C") and exposes
// a single GATT service + characteristic with UUID 0x2446.
//
// Frame format: every write is [cmd_hi, cmd_lo, ...payload]
//   0x0070  Start  — no payload
//   0x0071  Data   — up to 230 bytes of pixel data
//   0x0072  End    — [refresh_mode: 0x00=full, 0x01=fast]
//
// Pixel data: 1-bit MSB-first, 32 bytes/row × 122 rows = 3,904 bytes.
// Bit convention: 1=white, 0=black (matches SSD1680 and BMP convention).

const OD_UUID = '00002446-0000-1000-8000-00805f9b34fb';
const CHUNK_SIZE = 230;
export const DISPLAY_PIXEL_BYTES = 32 * 122;

export type PushProgress = { sent: number; total: number };

export interface BleImagePushOptions {
  // Loaded after the picker, so requestDevice retains the click's user activation.
  loadPixels: () => Promise<Uint8Array | { pixels: Uint8Array; profile: DisplayProfile }>;
  profile?: DisplayProfile;
  onProgress?: (p: PushProgress) => void;
}

export interface BleImagePushResult {
  device: BluetoothDevice;
}

export class BleSelectionCancelledError extends Error {
  constructor() {
    super('No display selected.');
    this.name = 'BleSelectionCancelledError';
  }
}

function frame(cmd: number, payload?: Uint8Array): Uint8Array {
  const buf = new Uint8Array(2 + (payload?.length ?? 0));
  buf[0] = (cmd >> 8) & 0xff;
  buf[1] = cmd & 0xff;
  if (payload) buf.set(payload, 2);
  return buf;
}

export async function bleImagePush(opts: BleImagePushOptions): Promise<BleImagePushResult> {
  const { loadPixels, onProgress } = opts;

  if (!navigator.bluetooth) {
    throw new Error('Web Bluetooth is not supported in this browser. Use Chrome or Edge on desktop.');
  }

  let device: BluetoothDevice;
  try {
    device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'OD' }, { namePrefix: 'OpenDisplay' }],
      optionalServices: [OD_UUID],
    });
  } catch (error) {
    // Only picker cancellation is benign; missing GATT services must surface.
    if (error instanceof Error && error.name === 'NotFoundError') {
      throw new BleSelectionCancelledError();
    }
    throw error;
  }

  try {
    const loaded = await loadPixels();
    const pixels = loaded instanceof Uint8Array ? loaded : loaded.pixels;
    const meta = frameMetadata(loaded instanceof Uint8Array ? opts.profile ?? DEFAULT_DISPLAY_PROFILE : loaded.profile);
    if (pixels.length !== meta.byteLength) {
      throw new Error(`Invalid display image: expected ${meta.byteLength} bytes for ${meta.width}×${meta.height}, received ${pixels.length}.`);
    }
    if (!device.gatt) throw new Error('The selected display does not support a Bluetooth GATT connection.');

    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(OD_UUID);
    const char = await service.getCharacteristic(OD_UUID);
    const panel = await readPanelConfig(char);
    if (panel.color !== 0 || panel.width !== meta.width || panel.height !== meta.height) {
      throw new Error(`Display mismatch: device is ${panel.width}×${panel.height}, color scheme ${panel.color}. Choose its native monochrome profile before sending.`);
    }
    // Current upstream direct-write firmware truncates non-byte-aligned rows.
    if (panel.width % 8 !== 0) throw new Error('This panel width is not byte-aligned; current OpenDisplay direct-write firmware can truncate it. Use BMP export with a compatible driver.');
    const total = pixels.length;
    onProgress?.({ sent: 0, total });

    // Start
    await char.writeValueWithResponse(frame(0x0070) as unknown as BufferSource);

    // Data chunks
    let offset = 0;
    while (offset < total) {
      const chunk = pixels.subarray(offset, offset + CHUNK_SIZE);
      await char.writeValueWithResponse(frame(0x0071, chunk) as unknown as BufferSource);
      offset += chunk.length;
      onProgress?.({ sent: Math.min(offset, total), total });
    }

    // End — full refresh. Completion is reported only after the final write.
    await char.writeValueWithResponse(frame(0x0072, new Uint8Array([0x00])) as unknown as BufferSource);
    return { device };
  } finally {
    // Release the connection after success and after partially transferred frames.
    if (device.gatt?.connected) device.gatt.disconnect();
  }
}
