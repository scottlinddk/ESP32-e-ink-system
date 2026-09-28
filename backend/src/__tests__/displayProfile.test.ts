import { describe, it, expect } from 'vitest';
import { BmpCanvas, renderDisplayData, renderDisplayDataRaw } from '../utils/bmpGenerator';
import { parseDisplayProfile, frameMetadata } from '../utils/displayProfile';

const profile = { width: 65, height: 100, rotation: 0 as const, colorMode:'bw' as const };
describe('display profiles and frame encoding', () => {
  it('preserves the default monochrome format', () => { expect(frameMetadata()).toMatchObject({width:250,height:122,rowBytes:32,byteLength:3904}); });
  it.each([{}, [], { ...profile, width: 0 }, {...profile,height:1.5}, {...profile,rotation:45}, {...profile,colorMode:'bwr'}, {...profile,width:1600,height:1600}, {...profile,width:'800'}, {...profile,extra:true}])('rejects invalid profiles %j', (value) => { expect(()=>parseDisplayProfile(value)).toThrow(); });
  it('separates packed transport rows from BMP padding at odd widths', () => {
    const canvas = new BmpCanvas(profile); canvas.setPixel(64,99,true);
    const raw=canvas.toRawPixels(), bmp=canvas.toBmp();
    expect(raw.length).toBe(900); expect(bmp.length).toBe(1262);
    expect(bmp.readInt32LE(18)).toBe(65); expect(bmp.readInt32LE(22)).toBe(-100);
    expect(raw[899]).toBe(0x7f); expect(bmp[62+99*12+8]).toBe(0x7f);
    expect(bmp.subarray(62+99*12+9)).toEqual(Buffer.from([255,255,255]));
  });
  it.each([[0,0,0],[90,64,0],[180,64,99],[270,0,99]] as const)('rotates a logical pixel clockwise %i degrees', (rotation,x,y) => {
    const canvas=new BmpCanvas({...profile,rotation}); canvas.setPixel(0,0,true);
    const raw=canvas.toRawPixels(); expect(raw[y*9+Math.floor(x/8)] & (0x80>>(x%8))).toBe(0);
    expect(canvas.width).toBe(rotation===90||rotation===270?100:65);
  });
  it('renders the selected profile and clips out-of-bounds pixels', () => {
    const prefs={monta_fields:[],zaptec_fields:[],display_profile:{...profile,width:800,height:480}};
    const layout={version:1 as const,cols:10 as const,rows:6 as const,widgets:[{i:'energy',x:9,y:5,w:1,h:1}]};
    const bmp=renderDisplayData({nextRefresh:60000},layout,prefs), raw=renderDisplayDataRaw({nextRefresh:60000},layout,prefs);
    expect(bmp.readInt32LE(18)).toBe(800); expect(bmp.subarray(62)).toEqual(raw);
    expect(raw.length).toBe(48000); expect(raw.subarray(0,40000).every(x=>x===255)).toBe(true);
  });
});

it('scales custom images across the whole logical canvas on larger panels', () => {
  const prefs={monta_fields:[],zaptec_fields:[],display_profile:{width:800,height:480,rotation:0 as const,colorMode:'bw' as const}};
  const raw=renderDisplayDataRaw({nextRefresh:60000,customImage:{width:8,height:1,pixels:'AA==',fit:'cover'}},{version:1,cols:10,rows:6,widgets:[{i:'custom-image',x:0,y:0,w:10,h:6}]},prefs);
  expect(raw.length).toBe(48000);expect(raw.every(byte=>byte===0)).toBe(true);
});
