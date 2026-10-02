import { frameMetadata, DEFAULT_DISPLAY_PROFILE, DisplayProfile } from './displayProfile';
import { readPanelConfig } from './openDisplayConfig';
import { bluetoothDeadline } from './bluetoothDeadline';
import { OpenDisplayReplies } from './openDisplayReplies';
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
// Pixel data: 1-bit MSB-first, compact byte-aligned rows in native panel order.
// Bit convention: 1=white, 0=black (matches SSD1680 and BMP convention).

const OD_UUID = '00002446-0000-1000-8000-00805f9b34fb';
export const EINK_SERVICE_UUID = 'c9c10001-7a6b-4c31-8a98-89e539e43805';
export const EINK_CHARACTERISTIC_UUID = 'c9c10002-7a6b-4c31-8a98-89e539e43805';
const CHUNK_SIZE = 230;
export const DISPLAY_PIXEL_BYTES = 32 * 122;

export type PushProgress = { sent: number; total: number };

export interface BleImagePushOptions {
  // Loaded after the picker, so requestDevice retains the click's user activation.
  loadPixels: () => Promise<Uint8Array | { pixels: Uint8Array; profile: DisplayProfile }>;
  profile?: DisplayProfile;
  signal?: AbortSignal;
  expectedDeviceName?: string;
  onProgress?: (p: PushProgress) => void;
  onRefreshing?: () => void;
}

export interface BleImagePushResult {
  device: BluetoothDevice;
  // True only after the device sends REFRESH_COMPLETE (0x73).
  refreshConfirmed: true;
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

  opts.signal?.throwIfAborted();
  if (!navigator.bluetooth) {
    throw new Error('Web Bluetooth is not supported in this browser. Use Chrome or Edge on desktop.');
  }

  const controller = new AbortController();
  const abort = () => controller.abort(opts.signal?.reason);
  opts.signal?.addEventListener('abort', abort, { once: true });
  let device: BluetoothDevice | undefined;
  let stopped = false;
  let replies: OpenDisplayReplies | undefined;
  const disconnected = () => controller.abort(new Error('Display disconnected before refresh was confirmed.'));
  const run = async <T>(operation: () => Promise<T>, ms: number, message: string) => {
    const result = await bluetoothDeadline(operation, ms, message, controller.signal);
    controller.signal.throwIfAborted();
    return result;
  };
  try {
    try {
      // requestDevice still runs synchronously in the click handler. Its native
      // picker cannot be closed by abort, but a later selection is ignored.
      device = await run(() => navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'EInk-' }, { services: [EINK_SERVICE_UUID] }, { namePrefix: 'OD' }, { namePrefix: 'OpenDisplay' }],
        optionalServices: [EINK_SERVICE_UUID, OD_UUID],
      }), 120_000, 'Selecting a display timed out. Please try again.');
    } catch (error) {
      controller.signal.throwIfAborted();
      // Only picker cancellation is benign; missing GATT services must surface.
      if (error instanceof Error && error.name === 'NotFoundError') throw new BleSelectionCancelledError();
      throw error;
    }
    if (opts.expectedDeviceName !== undefined && device.name !== opts.expectedDeviceName) {
      throw new Error(`Selected Bluetooth display "${device.name ?? 'unnamed'}" does not match registered display "${opts.expectedDeviceName}". Choose the registered display before sending.`);
    }
    device.addEventListener('gattserverdisconnected', disconnected);
    const loaded = await run(loadPixels, 30_000, 'Loading the display image timed out.');
    const pixels = loaded instanceof Uint8Array ? loaded : loaded.pixels;
    const meta = frameMetadata(loaded instanceof Uint8Array ? opts.profile ?? DEFAULT_DISPLAY_PROFILE : loaded.profile);
    if (pixels.length !== meta.byteLength) {
      throw new Error(`Invalid display image: expected ${meta.byteLength} bytes for ${meta.width}×${meta.height}, received ${pixels.length}.`);
    }
    if (!device.gatt) throw new Error('The selected display does not support a Bluetooth GATT connection.');

    const server = await run(() => device!.gatt!.connect().then(connected => {
      // connect() itself cannot be cancelled. Release a connection that arrives
      // after its deadline, without starting discovery or any image writes.
      if ((stopped || controller.signal.aborted) && connected.connected) connected.disconnect();
      return connected;
    }), 10_000, 'Connecting to the display timed out.');
    // The bundled firmware has its own versioned service and correctly pads
    // 250-pixel rows. Only a missing service permits the OpenDisplay fallback.
    let bundled = true;
    const service = await run(async () => {
      try { return await server.getPrimaryService(EINK_SERVICE_UUID); }
      catch (error) {
        if (!(error instanceof Error) || error.name !== 'NotFoundError' || controller.signal.aborted) throw error;
        bundled = false;
        return server.getPrimaryService(OD_UUID);
      }
    }, 10_000, 'Display service discovery timed out.');
    const char = await run(() => service.getCharacteristic(bundled ? EINK_CHARACTERISTIC_UUID : OD_UUID), 10_000, 'Display characteristic discovery timed out.');
    const panel = bundled ? await run(async () => {
      const value = await char.readValue();
      if (value.byteLength !== 6 || value.getUint8(0) !== 1) throw new Error('Unsupported bundled display protocol. Update the device firmware.');
      if (controller.signal.aborted) throw controller.signal.reason;
      await char.startNotifications();
      return { width: value.getUint16(1, true), height: value.getUint16(3, true), color: value.getUint8(5) };
    }, 5000, 'Reading display capabilities timed out.') : await readPanelConfig(char, controller.signal);
    controller.signal.throwIfAborted();
    if (panel.color !== 0 || panel.width !== meta.width || panel.height !== meta.height) {
      throw new Error(`Display mismatch: device is ${panel.width}×${panel.height}, color scheme ${panel.color}. Choose its native monochrome profile before sending.`);
    }
    // Current upstream direct-write firmware truncates non-byte-aligned rows.
    if (!bundled && panel.width % 8 !== 0) throw new Error('This OpenDisplay panel needs verified row-padding support. Use the bundled firmware for 250×122 Bluetooth updates, or BMP export with a compatible driver.');
    const chunkSize = bundled ? 18 : CHUNK_SIZE; // 2-byte opcode + data fits the minimum 20-byte ATT payload.
    const total = pixels.length;
    onProgress?.({ sent: 0, total });
    replies = new OpenDisplayReplies(char, error => controller.abort(error));
    const exchange = (command: number, payload: Uint8Array | undefined, expected: number[], timeout: number) => run(async () => {
      // Register the waiter first, before a synchronous/early notification.
      const acknowledgement = replies!.next(expected);
      const [, code] = await Promise.all([
        (async () => {
          if (controller.signal.aborted) throw controller.signal.reason;
          await char.writeValueWithResponse(frame(command, payload) as unknown as BufferSource);
        })(),
        acknowledgement,
      ]);
      return code;
    }, timeout, `Display command 0x${command.toString(16)} timed out; refresh was not confirmed.`);

    await exchange(0x70, undefined, [0x70], 10_000);

    // Per-chunk application ACKs supply flow control; ATT success alone does
    // not mean the panel accepted the data. Upstream allows 90s for slow SPI.
    let offset = 0;
    let autoCompleted = false;
    while (offset < total) {
      const chunk = pixels.subarray(offset, offset + chunkSize);
      const code = await exchange(0x71, chunk, [0x71, 0x72], 90_000);
      offset += chunk.length;
      onProgress?.({ sent: Math.min(offset, total), total });
      if (code === 0x72) {
        if (offset !== total) throw new Error('Display ended the upload before the complete image was accepted.');
        autoCompleted = true;
        break;
      }
    }

    // Firmware can auto-END when its image buffer fills. Sending another END
    // then is invalid. Otherwise explicitly request a full refresh.
    controller.signal.throwIfAborted();
    opts.onRefreshing?.();
    if (!autoCompleted) await exchange(0x72, new Uint8Array([0]), [0x72], 90_000);
    await run(() => replies!.next([0x73]), 90_000, 'Image transmitted, but display refresh was not confirmed before the deadline.');
    return { device, refreshConfirmed: true };
  } finally {
    stopped = true;
    opts.signal?.removeEventListener('abort', abort);
    controller.abort(new Error('Bluetooth transfer closed'));
    replies?.dispose();
    device?.removeEventListener('gattserverdisconnected', disconnected);
    // Release the connection after success and after partially transferred frames.
    if (device?.gatt?.connected) device.gatt.disconnect();
  }
}
