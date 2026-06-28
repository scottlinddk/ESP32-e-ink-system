// OpenDisplay BLE direct-write protocol (uncompressed path).
//
// The device advertises as "OD<chip-id-hex>" (e.g. "OD4A2B3C") and exposes
// a single GATT service + characteristic with UUID 0x2446.
//
// Frame format: every write is [cmd_lo, cmd_hi, ...payload]
//   0x0070  Start  — no payload
//   0x0071  Data   — up to 230 bytes of pixel data
//   0x0072  End    — [refresh_mode: 0x00=full, 0x01=fast]
//
// Pixel data: 1-bit MSB-first, 32 bytes/row × 122 rows = 3,904 bytes.
// Bit convention: 1=white, 0=black (matches SSD1680 and BMP convention).

const OD_UUID = '00002446-0000-1000-8000-00805f9b34fb';
const CHUNK_SIZE = 230;

export type PushProgress = { sent: number; total: number };

export interface BleImagePushOptions {
  pixels: Uint8Array;
  onProgress?: (p: PushProgress) => void;
}

export interface BleImagePushResult {
  device: BluetoothDevice;
}

function frame(cmd: number, payload?: Uint8Array): Uint8Array {
  const buf = new Uint8Array(2 + (payload?.length ?? 0));
  buf[0] = cmd & 0xff;
  buf[1] = (cmd >> 8) & 0xff;
  if (payload) buf.set(payload, 2);
  return buf;
}

export async function bleImagePush(opts: BleImagePushOptions): Promise<BleImagePushResult> {
  const { pixels, onProgress } = opts;

  if (!navigator.bluetooth) {
    throw new Error('Web Bluetooth is not supported in this browser. Use Chrome or Edge on desktop.');
  }

  const device = await navigator.bluetooth.requestDevice({
    filters: [{ namePrefix: 'OD' }],
    optionalServices: [OD_UUID],
  });

  const server = await device.gatt!.connect();
  const service = await server.getPrimaryService(OD_UUID);
  const char = await service.getCharacteristic(OD_UUID);

  // Start
  await char.writeValueWithResponse(frame(0x0070) as unknown as BufferSource);

  // Data chunks
  const total = pixels.length;
  let offset = 0;
  while (offset < total) {
    const chunk = pixels.subarray(offset, offset + CHUNK_SIZE);
    await char.writeValueWithResponse(frame(0x0071, chunk) as unknown as BufferSource);
    offset += chunk.length;
    onProgress?.({ sent: Math.min(offset, total), total });
  }

  // End — full refresh
  await char.writeValueWithResponse(frame(0x0072, new Uint8Array([0x00])) as unknown as BufferSource);

  return { device };
}
