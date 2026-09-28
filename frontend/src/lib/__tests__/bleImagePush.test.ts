import { afterEach, describe, expect, it, vi } from 'vitest';
import { bleImagePush as push, BleSelectionCancelledError } from '../bleImagePush';
import { readPanelConfig } from '../openDisplayConfig';
vi.mock('../openDisplayConfig', () => ({ readPanelConfig: vi.fn() }));
const DISPLAY_PIXEL_BYTES = 32 * 122;
const bleImagePush: typeof push = (opts) => push({ profile: {width:256,height:122,rotation:0,colorMode:'bw'}, ...opts });

function setupDevice() {
  vi.mocked(readPanelConfig).mockResolvedValue({width:256,height:122,color:0});
  const write = vi.fn().mockResolvedValue(undefined);
  const characteristic = { writeValueWithResponse: write };
  const service = { getCharacteristic: vi.fn().mockResolvedValue(characteristic) };
  const gatt = {
    connected: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    getPrimaryService: vi.fn().mockResolvedValue(service),
  };
  gatt.connect.mockImplementation(async () => { gatt.connected = true; return gatt; });
  gatt.disconnect.mockImplementation(() => { gatt.connected = false; });
  const device = { gatt } as unknown as BluetoothDevice;
  const requestDevice = vi.fn().mockResolvedValue(device);
  vi.stubGlobal('navigator', { bluetooth: { requestDevice } });
  return { device, gatt, write, requestDevice };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('OpenDisplay BLE image transfer', () => {
  it('opens the picker synchronously before loading authenticated pixel data', async () => {
    const { requestDevice } = setupDevice();
    const loadPixels = vi.fn().mockResolvedValue(new Uint8Array(DISPLAY_PIXEL_BYTES));
    const transfer = bleImagePush({ loadPixels });
    expect(requestDevice).toHaveBeenCalledOnce();
    expect(loadPixels).not.toHaveBeenCalled();
    await transfer;
    expect(loadPixels).toHaveBeenCalledOnce();
  });

  it('sends exactly one complete frame in bounded chunks and disconnects', async () => {
    const { device, gatt, write } = setupDevice();
    const pixels = Uint8Array.from({ length: DISPLAY_PIXEL_BYTES }, (_, i) => i % 256);
    const onProgress = vi.fn();
    const result = await bleImagePush({ loadPixels: async () => pixels, onProgress });
    const frames = write.mock.calls.map(([frame]) => frame as Uint8Array);
    expect(result.device).toBe(device);
    expect(Array.from(frames[0])).toEqual([0x00, 0x70]);
    expect(Array.from(frames.at(-1)!)).toEqual([0x00, 0x72, 0x00]);
    const dataFrames = frames.slice(1, -1);
    expect(dataFrames).toHaveLength(Math.ceil(DISPLAY_PIXEL_BYTES / 230));
    for (const frame of dataFrames) {
      expect(Array.from(frame.slice(0, 2))).toEqual([0x00, 0x71]);
      expect(frame.length).toBeLessThanOrEqual(232);
    }
    expect(dataFrames.flatMap((frame) => Array.from(frame.slice(2)))).toEqual(Array.from(pixels));
    expect(onProgress).toHaveBeenNthCalledWith(1, { sent: 0, total: DISPLAY_PIXEL_BYTES });
    expect(onProgress).toHaveBeenLastCalledWith({ sent: DISPLAY_PIXEL_BYTES, total: DISPLAY_PIXEL_BYTES });
    expect(gatt.disconnect).toHaveBeenCalledOnce();
    expect(gatt.connected).toBe(false);
  });

  it.each([0, DISPLAY_PIXEL_BYTES - 1, DISPLAY_PIXEL_BYTES + 1])(
    'rejects a %i-byte payload before connecting or writing', async (size) => {
      const { gatt, write } = setupDevice();
      await expect(bleImagePush({ loadPixels: async () => new Uint8Array(size) })).rejects.toThrow('expected 3904 bytes');
      expect(gatt.connect).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
    },
  );

  it('releases GATT when a data write fails and never sends the end command', async () => {
    const { gatt, write } = setupDevice();
    const failure = new Error('Connection lost');
    write.mockResolvedValueOnce(undefined).mockRejectedValueOnce(failure);
    await expect(bleImagePush({ loadPixels: async () => new Uint8Array(DISPLAY_PIXEL_BYTES) })).rejects.toBe(failure);
    expect(write).toHaveBeenCalledTimes(2);
    expect(gatt.disconnect).toHaveBeenCalledOnce();
  });

  it('does not report success when the final refresh write fails', async () => {
    const { gatt, write } = setupDevice();
    write.mockImplementation(async (frame: Uint8Array) => {
      if (frame[1] === 0x72) throw new Error('Refresh failed');
    });
    await expect(bleImagePush({ loadPixels: async () => new Uint8Array(DISPLAY_PIXEL_BYTES) })).rejects.toThrow('Refresh failed');
    expect(gatt.disconnect).toHaveBeenCalledOnce();
  });

  it('preserves missing-service errors and still releases the connection', async () => {
    const { gatt } = setupDevice();
    const failure = new DOMException('Service unavailable', 'NotFoundError');
    gatt.getPrimaryService.mockRejectedValue(failure);
    await expect(bleImagePush({ loadPixels: async () => new Uint8Array(DISPLAY_PIXEL_BYTES) })).rejects.toBe(failure);
    expect(gatt.disconnect).toHaveBeenCalledOnce();
  });

  it('does not fetch or connect when the picker is cancelled', async () => {
    const { gatt, requestDevice } = setupDevice();
    const loadPixels = vi.fn();
    requestDevice.mockRejectedValue(new DOMException('Cancelled', 'NotFoundError'));
    await expect(bleImagePush({ loadPixels })).rejects.toBeInstanceOf(BleSelectionCancelledError);
    expect(loadPixels).not.toHaveBeenCalled();
    expect(gatt.connect).not.toHaveBeenCalled();
  });

  it('does not connect if image loading fails', async () => {
    const { gatt } = setupDevice();
    await expect(bleImagePush({ loadPixels: async () => { throw new Error('HTTP 401'); } })).rejects.toThrow('HTTP 401');
    expect(gatt.connect).not.toHaveBeenCalled();
  });

  it('explains when Web Bluetooth is unsupported', async () => {
    vi.stubGlobal('navigator', {});
    const loadPixels = vi.fn();
    await expect(bleImagePush({ loadPixels })).rejects.toThrow('not supported');
    expect(loadPixels).not.toHaveBeenCalled();
  });
});

describe('panel compatibility', () => {
  it.each([{width:800,height:480,color:0},{width:256,height:122,color:1}])('rejects a mismatched or color panel before image writes', async (panel) => {
    const {write,gatt} = setupDevice(); vi.mocked(readPanelConfig).mockResolvedValue(panel);
    await expect(bleImagePush({loadPixels:async()=>new Uint8Array(DISPLAY_PIXEL_BYTES)})).rejects.toThrow('mismatch');
    expect(write).not.toHaveBeenCalled(); expect(gatt.disconnect).toHaveBeenCalled();
  });
  it('rejects known upstream truncation on non-byte-aligned panels', async () => {
    const {write} = setupDevice(); vi.mocked(readPanelConfig).mockResolvedValue({width:250,height:122,color:0});
    await expect(push({loadPixels:async()=>new Uint8Array(DISPLAY_PIXEL_BYTES)})).rejects.toThrow('not byte-aligned'); expect(write).not.toHaveBeenCalled();
  });
  it('accepts frame metadata atomically from the image response', async () => {
    const {write} = setupDevice(); vi.mocked(readPanelConfig).mockResolvedValue({width:800,height:480,color:0});
    await push({loadPixels:async()=>({pixels:new Uint8Array(48000),profile:{width:800,height:480,rotation:0,colorMode:'bw'}})});
    expect(write).toHaveBeenLastCalledWith(new Uint8Array([0,0x72,0]));
  });
  it('propagates configuration failure and releases the connection', async () => {
    const {write,gatt} = setupDevice(); vi.mocked(readPanelConfig).mockRejectedValue(new Error('Configuration missing'));
    await expect(bleImagePush({loadPixels:async()=>new Uint8Array(DISPLAY_PIXEL_BYTES)})).rejects.toThrow('Configuration missing');
    expect(write).not.toHaveBeenCalled(); expect(gatt.disconnect).toHaveBeenCalled();
  });
});
