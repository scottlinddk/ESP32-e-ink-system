import { afterEach, describe, it, expect, vi } from 'vitest';
import { parsePanelConfig, readPanelConfig } from '../openDisplayConfig';
function config() {
  const bytes=new Uint8Array(53); bytes[2]=1; bytes[3]=0;bytes[4]=0x20;
  const data=new DataView(bytes.buffer); data.setUint16(9,800,true);data.setUint16(11,480,true); return bytes;
}
afterEach(()=>{ vi.useRealTimers(); });
describe('OpenDisplay configuration',()=>{
  it('reads native dimensions and monochrome format from the fixed-size display packet',()=>{expect(parsePanelConfig(config())).toEqual({width:800,height:480,color:0});});
  it.each([new Uint8Array(),new Uint8Array([0,0,2,0,0]),config().slice(0,-1)])('rejects unsupported or truncated configs', bytes=>{expect(()=>parsePanelConfig(bytes)).toThrow();});
  it('supports the official legacy 65-byte Wi-Fi packet only at the end', () => {
    const bytes = new Uint8Array(120);
    bytes.set(config().slice(0, -2)); bytes[51] = 1; bytes[52] = 0x26;
    expect(parsePanelConfig(bytes)).toEqual({width:800,height:480,color:0});
    expect(() => parsePanelConfig(bytes.slice(0, -1))).toThrow();
  });
  it('rejects unknown packet types rather than guessing offsets', () => {
    const bytes = config(); bytes[4] = 0x99;
    expect(() => parsePanelConfig(bytes)).toThrow('unsupported');
  });
  it('assembles ordered notifications and sends the big-endian read command', async()=>{
    const handlers=new Set<()=>void>(); const bytes=config();
    const char={ value:undefined as DataView|undefined, addEventListener:vi.fn((_:string,h:()=>void)=>handlers.add(h)),removeEventListener:vi.fn((_:string,h:()=>void)=>handlers.delete(h)),startNotifications:vi.fn().mockResolvedValue(undefined),writeValueWithResponse:vi.fn(async()=>{
      const first=new Uint8Array(6+25); const v=new DataView(first.buffer);v.setUint16(0,0x40);v.setUint16(4,bytes.length,true);first.set(bytes.slice(0,25),6);char.value=v;handlers.forEach(h=>h());
      const last=new Uint8Array(4+bytes.length-25); const w=new DataView(last.buffer);w.setUint16(0,0x8040);w.setUint16(2,1,true);last.set(bytes.slice(25),4);char.value=w;handlers.forEach(h=>h());
    })};
    expect(await readPanelConfig(char as unknown as BluetoothRemoteGATTCharacteristic)).toMatchObject({width:800,height:480});
    expect(char.writeValueWithResponse).toHaveBeenCalledWith(new Uint8Array([0,0x40]));expect(handlers.size).toBe(0);
  });
  it('times out and removes the notification listener',async()=>{
    vi.useFakeTimers();const char={addEventListener:vi.fn(),removeEventListener:vi.fn(),startNotifications:vi.fn().mockResolvedValue(undefined),writeValueWithResponse:vi.fn().mockResolvedValue(undefined)};
    const pending=readPanelConfig(char as unknown as BluetoothRemoteGATTCharacteristic);
    const failure=expect(pending).rejects.toThrow('timed out');await vi.advanceTimersByTimeAsync(5001);await failure;expect(char.removeEventListener).toHaveBeenCalled();
  });
  it.each(['subscribe', 'write'])('bounds a hanging %s and prevents late follow-up writes', async stage => {
    vi.useFakeTimers();
    const handlers = new Set<() => void>();
    let finish!: () => void;
    const stalled = () => new Promise<void>(resolve => { finish = resolve; });
    const char = {
      value: undefined as DataView | undefined,
      addEventListener: vi.fn((_: string, handler: () => void) => handlers.add(handler)),
      removeEventListener: vi.fn((_: string, handler: () => void) => handlers.delete(handler)),
      startNotifications: vi.fn(stage === 'subscribe' ? stalled : async () => {}),
      writeValueWithResponse: vi.fn(stage === 'write' ? stalled : async () => {}),
    };
    const failure = expect(readPanelConfig(char as unknown as BluetoothRemoteGATTCharacteristic)).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(5001); await failure;
    expect(handlers.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
    finish(); await vi.advanceTimersByTimeAsync(0);
    expect(char.writeValueWithResponse).toHaveBeenCalledTimes(stage === 'write' ? 1 : 0);
  });
  it('cleans up immediately on external disconnect while subscription is pending', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const char = {addEventListener:vi.fn(),removeEventListener:vi.fn(),startNotifications:vi.fn(()=>new Promise(()=>{})),writeValueWithResponse:vi.fn()};
    const failure = expect(readPanelConfig(char as unknown as BluetoothRemoteGATTCharacteristic, controller.signal)).rejects.toThrow('disconnected');
    controller.abort(new Error('disconnected'));
    await failure;
    expect(char.removeEventListener).toHaveBeenCalledOnce();
    expect(char.writeValueWithResponse).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([{ bytes: [0, 0x40, 0xfe] }, { bytes: [0xfe, 0x40] }])('explains authentication refusal $bytes immediately', async ({ bytes }) => {
    const handlers = new Set<() => void>();
    const char = {
      value: undefined as DataView | undefined,
      addEventListener: vi.fn((_: string, handler: () => void) => handlers.add(handler)),
      removeEventListener: vi.fn((_: string, handler: () => void) => handlers.delete(handler)),
      startNotifications: vi.fn().mockResolvedValue(undefined),
      writeValueWithResponse: vi.fn(async () => {
        char.value = new DataView(new Uint8Array(bytes).buffer);
        handlers.forEach(handler => handler());
      }),
    };
    await expect(readPanelConfig(char as unknown as BluetoothRemoteGATTCharacteristic)).rejects.toThrow('encryption key');
    expect(handlers.size).toBe(0);
  });
  it.each(['nack', 'sequence', 'oversize', 'overflow'])('rejects %s responses and cleans up while the ATT write hangs', async kind => {
    vi.useFakeTimers();
    const handlers = new Set<() => void>();
    const char = {
      value: undefined as DataView | undefined,
      addEventListener: vi.fn((_: string, handler: () => void) => handlers.add(handler)),
      removeEventListener: vi.fn((_: string, handler: () => void) => handlers.delete(handler)),
      startNotifications: vi.fn().mockResolvedValue(undefined),
      writeValueWithResponse: vi.fn(() => {
        const bytes = new Uint8Array(7); const view = new DataView(bytes.buffer);
        view.setUint16(0, kind === 'nack' ? 0xff40 : 0x40);
        view.setUint16(2, kind === 'sequence' ? 2 : 0, true);
        view.setUint16(4, kind === 'oversize' ? 8193 : kind === 'overflow' ? 5 : 53, true);
        if (kind === 'overflow') {
          char.value = new DataView(new Uint8Array([...bytes, 0, 0, 0, 0, 0]).buffer);
        } else char.value = view;
        handlers.forEach(handler => handler());
        return new Promise<void>(() => {});
      }),
    };
    await expect(readPanelConfig(char as unknown as BluetoothRemoteGATTCharacteristic)).rejects.toThrow();
    expect(handlers.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
});
