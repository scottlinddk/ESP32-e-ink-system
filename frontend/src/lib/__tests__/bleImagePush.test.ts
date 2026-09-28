import { afterEach, describe, expect, it, vi } from 'vitest';
import { bleImagePush as push, BleSelectionCancelledError } from '../bleImagePush';
import { readPanelConfig } from '../openDisplayConfig';
vi.mock('../openDisplayConfig', () => ({ readPanelConfig: vi.fn() }));
const DISPLAY_PIXEL_BYTES = 32 * 122;
const bleImagePush: typeof push = (opts) => push({ profile: {width:256,height:122,rotation:0,colorMode:'bw'}, ...opts });

function setupDevice() {
  vi.mocked(readPanelConfig).mockResolvedValue({width:256,height:122,color:0});
  const handlers = new Set<() => void>();
  const deviceHandlers = new Set<() => void>();
  const write = vi.fn();
  const characteristic = {
    value: undefined as DataView | undefined,
    writeValueWithResponse: write,
    addEventListener: vi.fn((_: string, listener: () => void) => handlers.add(listener)),
    removeEventListener: vi.fn((_: string, listener: () => void) => handlers.delete(listener)),
  };
  const emit = (code: number) => {
    const bytes = new Uint8Array([code >> 8, code & 255]);
    characteristic.value = new DataView(bytes.buffer);
    handlers.forEach(listener => listener());
  };
  const reply = (frame: Uint8Array) => {
    emit(frame[1]);
    if (frame[1] === 0x72) emit(0x73);
  };
  write.mockImplementation(async (frame: Uint8Array) => reply(frame));
  const service = { getCharacteristic: vi.fn().mockResolvedValue(characteristic) };
  const gatt = {
    connected: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    getPrimaryService: vi.fn().mockResolvedValue(service),
  };
  gatt.connect.mockImplementation(async () => { gatt.connected = true; return gatt; });
  gatt.disconnect.mockImplementation(() => { gatt.connected = false; });
  const device = { gatt,
    addEventListener: vi.fn((_: string, listener: () => void) => deviceHandlers.add(listener)),
    removeEventListener: vi.fn((_: string, listener: () => void) => deviceHandlers.delete(listener)),
  } as unknown as BluetoothDevice;
  const requestDevice = vi.fn().mockResolvedValue(device);
  vi.stubGlobal('navigator', { bluetooth: { requestDevice } });
  return { device, gatt, write, requestDevice, emit, reply, handlers, deviceHandlers, characteristic, service,
    disconnect: () => { gatt.connected = false; deviceHandlers.forEach(listener => listener()); },
  };
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

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
    const { device, gatt, write, handlers, deviceHandlers } = setupDevice();
    const pixels = Uint8Array.from({ length: DISPLAY_PIXEL_BYTES }, (_, i) => i % 256);
    const onProgress = vi.fn();
    const result = await bleImagePush({ loadPixels: async () => pixels, onProgress });
    const frames = write.mock.calls.map(([frame]) => frame as Uint8Array);
    expect(result.device).toBe(device);
    expect(result.refreshConfirmed).toBe(true);
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
    expect(handlers.size).toBe(0);
    expect(deviceHandlers.size).toBe(0);
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
    const { gatt, write, emit } = setupDevice();
    const failure = new Error('Connection lost');
    write.mockImplementationOnce(async () => emit(0x70)).mockRejectedValueOnce(failure);
    await expect(bleImagePush({ loadPixels: async () => new Uint8Array(DISPLAY_PIXEL_BYTES) })).rejects.toBe(failure);
    expect(write).toHaveBeenCalledTimes(2);
    expect(gatt.disconnect).toHaveBeenCalledOnce();
  });

  it('does not report success when the final refresh write fails', async () => {
    const { gatt, write, reply } = setupDevice();
    write.mockImplementation(async (frame: Uint8Array) => {
      if (frame[1] === 0x72) throw new Error('Refresh failed');
      reply(frame);
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

describe('application acknowledgements and deadlines', () => {
  const loadPixels = async () => new Uint8Array(DISPLAY_PIXEL_BYTES);

  it('accepts high-bit command echoes and refresh completion arriving during END', async () => {
    const { write, emit } = setupDevice();
    write.mockImplementation(async (frame: Uint8Array) => {
      emit(0x8000 | frame[1]);
      if (frame[1] === 0x72) emit(0x8073);
    });
    expect((await bleImagePush({ loadPixels })).refreshConfirmed).toBe(true);
  });

  it('waits for each application ACK before writing the next chunk', async () => {
    vi.useFakeTimers();
    const { write, emit, reply } = setupDevice();
    write.mockImplementation(async (frame: Uint8Array) => {
      if (frame[1] !== 0x70) reply(frame);
    });
    const pending = bleImagePush({ loadPixels });
    await vi.advanceTimersByTimeAsync(0);
    expect(write).toHaveBeenCalledTimes(1);
    emit(0x70);
    await pending;
  });

  it.each([0x70, 0x71, 0x72])('fails immediately on command 0x%s NACK and sends no later command', async command => {
    const { write, emit, reply, handlers, deviceHandlers, gatt } = setupDevice();
    write.mockImplementation(async (frame: Uint8Array) => {
      if (frame[1] === command) emit(0xff00 | command);
      else reply(frame);
    });
    await expect(bleImagePush({ loadPixels })).rejects.toThrow('rejected command');
    expect(write.mock.calls.at(-1)![0][1]).toBe(command);
    expect(handlers.size).toBe(0);
    expect(deviceHandlers.size).toBe(0);
    expect(gatt.disconnect).toHaveBeenCalledOnce();
  });

  it('rejects an ACK echo for the wrong command', async () => {
    const { write, emit } = setupDevice();
    write.mockImplementation(async () => emit(0x71));
    await expect(bleImagePush({ loadPixels })).rejects.toThrow('Unexpected OpenDisplay acknowledgement');
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('does not send another command after a queued unexpected reply', async () => {
    const { write, emit } = setupDevice();
    write.mockImplementation(async () => { emit(0x70); emit(0x73); });
    await expect(bleImagePush({ loadPixels })).rejects.toThrow('Unexpected OpenDisplay acknowledgement');
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('fails immediately on a NACK after an ACK even if the ATT write never settles', async () => {
    const { write, emit, handlers } = setupDevice();
    write.mockImplementation(() => {
      emit(0x70); emit(0xff70);
      return new Promise(() => {});
    });
    await expect(bleImagePush({ loadPixels })).rejects.toThrow('rejected command');
    expect(write).toHaveBeenCalledTimes(1);
    expect(handlers.size).toBe(0);
  });

  it('bounds image loading before connecting', async () => {
    vi.useFakeTimers();
    const { gatt, deviceHandlers } = setupDevice();
    const failure = expect(bleImagePush({ loadPixels: () => new Promise(() => {}) })).rejects.toThrow('Loading the display image timed out');
    await vi.advanceTimersByTimeAsync(30_001); await failure;
    expect(gatt.connect).not.toHaveBeenCalled();
    expect(deviceHandlers.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('skips explicit END after final DATA auto-END and keeps early refresh completion', async () => {
    const { write, emit, reply } = setupDevice();
    let received = 0;
    write.mockImplementation(async (frame: Uint8Array) => {
      if (frame[1] === 0x71) received += frame.length - 2;
      if (received === DISPLAY_PIXEL_BYTES) { emit(0x8072); emit(0x73); }
      else reply(frame);
    });
    expect((await bleImagePush({ loadPixels })).refreshConfirmed).toBe(true);
    expect(write.mock.calls.every(([frame]) => frame[1] !== 0x72)).toBe(true);
  });

  it('rejects a premature auto-END without transmitting the rest', async () => {
    const { write, emit } = setupDevice();
    write.mockImplementation(async (frame: Uint8Array) => emit(frame[1] === 0x71 ? 0x72 : 0x70));
    await expect(bleImagePush({ loadPixels })).rejects.toThrow('before the complete image');
    expect(write).toHaveBeenCalledTimes(2);
  });

  it.each([0x74, 0x8074])('does not report success on device refresh timeout %s', async timeout => {
    const { write, emit, reply } = setupDevice();
    write.mockImplementation(async (frame: Uint8Array) => {
      if (frame[1] === 0x72) { emit(0x72); emit(timeout); }
      else reply(frame);
    });
    await expect(bleImagePush({ loadPixels })).rejects.toThrow('refresh timeout');
  });

  it('bounds a missing refresh-complete reply and clears listeners/timers', async () => {
    vi.useFakeTimers();
    const { write, emit, handlers, deviceHandlers, gatt } = setupDevice();
    write.mockImplementation(async (frame: Uint8Array) => emit(frame[1]));
    const failure = expect(bleImagePush({ loadPixels })).rejects.toThrow('refresh was not confirmed');
    await vi.advanceTimersByTimeAsync(90_001);
    await failure;
    expect(gatt.disconnect).toHaveBeenCalledOnce();
    expect(handlers.size).toBe(0);
    expect(deviceHandlers.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([0x70, 0x71, 0x72])('bounds a hanging ATT write for %s even after its ACK; late resolution cannot continue', async command => {
    vi.useFakeTimers();
    const { write, emit, reply, handlers, gatt } = setupDevice();
    let finish!: () => void;
    write.mockImplementation((frame: Uint8Array) => {
      if (frame[1] === command) {
        emit(command);
        return new Promise<void>(resolve => { finish = resolve; });
      }
      reply(frame);
      return Promise.resolve();
    });
    const failure = expect(bleImagePush({ loadPixels })).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(command === 0x70 ? 10_001 : 90_001);
    await failure;
    const count = write.mock.calls.length;
    finish(); emit(0x73);
    await vi.advanceTimersByTimeAsync(0);
    expect(write).toHaveBeenCalledTimes(count);
    expect(handlers.size).toBe(0);
    expect(gatt.disconnect).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts immediately on disconnect while awaiting a DATA ACK', async () => {
    const { write, reply, disconnect, handlers, deviceHandlers } = setupDevice();
    write.mockImplementation(async (frame: Uint8Array) => {
      if (frame[1] === 0x71) disconnect();
      else reply(frame);
    });
    await expect(bleImagePush({ loadPixels })).rejects.toThrow('disconnected');
    expect(write).toHaveBeenCalledTimes(2);
    expect(handlers.size).toBe(0);
    expect(deviceHandlers.size).toBe(0);
  });

  it('releases a connection that finishes after the connection deadline', async () => {
    vi.useFakeTimers();
    const { gatt, write } = setupDevice();
    let finish!: () => void;
    gatt.connect.mockImplementation(() => new Promise(resolve => {
      finish = () => { gatt.connected = true; resolve(gatt); };
    }));
    const failure = expect(bleImagePush({ loadPixels })).rejects.toThrow('Connecting to the display timed out');
    await vi.advanceTimersByTimeAsync(10_001); await failure;
    finish(); await vi.advanceTimersByTimeAsync(0);
    expect(gatt.disconnect).toHaveBeenCalledOnce();
    expect(gatt.getPrimaryService).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it.each(['service', 'characteristic'])('bounds hanging %s discovery', async stage => {
    vi.useFakeTimers();
    const { gatt, service, write } = setupDevice();
    const request = stage === 'service' ? gatt.getPrimaryService : service.getCharacteristic;
    request.mockImplementation(() => new Promise(() => {}));
    const failure = expect(bleImagePush({ loadPixels })).rejects.toThrow('discovery timed out');
    await vi.advanceTimersByTimeAsync(10_001); await failure;
    expect(gatt.disconnect).toHaveBeenCalledOnce(); expect(write).not.toHaveBeenCalled();
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
