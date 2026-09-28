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
});
