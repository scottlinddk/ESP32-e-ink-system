// Configures an OpenDisplay device over BLE by writing WiFi credentials via
// GATT characteristic 0x2446 (command 0x0041 = write config).
//
// Config binary layout sent as payload of command 0x0041:
//   Header  (13 bytes): magic(4) + version(1) + data_len(4) + crc32(4)
//   Packet  (132 bytes): packet_id(1=0x26) + WifiConfig struct:
//     ssid[32] + password[32] + encryption(1) + reserved[66]
//
// CRC32: IEEE 802.3 polynomial 0xEDB88320 over the packet bytes.

import React, { useState } from 'react';
import { Button } from './ui/button';
import { Field } from './ui/Field';
import { Input } from './ui/input';
import { Dialog } from './ui/Dialog';

const OD_UUID = '00002446-0000-1000-8000-00805f9b34fb';
const CMD_WRITE_CONFIG = 0x0041;

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function encodeString(str: string, len: number): Uint8Array {
  const buf = new Uint8Array(len);
  const encoded = new TextEncoder().encode(str);
  buf.set(encoded.subarray(0, len - 1)); // leave last byte as null terminator
  return buf;
}

function buildConfigPayload(ssid: string, password: string): Uint8Array {
  // WifiConfig struct: ssid[32] + password[32] + encryption[1] + reserved[66]
  const wifiConfig = new Uint8Array(131);
  wifiConfig.set(encodeString(ssid, 32), 0);
  wifiConfig.set(encodeString(password, 32), 32);
  wifiConfig[64] = 0x03; // WPA2

  // Packet: [packet_id=0x26][wifiConfig]
  const packet = new Uint8Array(132);
  packet[0] = 0x26;
  packet.set(wifiConfig, 1);

  // CRC32 of packet bytes
  const checksum = crc32(packet);

  // Header: magic(4LE) + version(1) + data_len(4LE) + crc32(4LE)
  const header = new Uint8Array(13);
  const hView = new DataView(header.buffer);
  hView.setUint32(0, 0xdeadbeef, true);
  header[4] = 1; // version
  hView.setUint32(5, packet.length, true);
  hView.setUint32(9, checksum, true);

  // Command frame: [cmd_lo][cmd_hi][header][packet]
  const frame = new Uint8Array(2 + 13 + 132);
  frame[0] = CMD_WRITE_CONFIG & 0xff;
  frame[1] = (CMD_WRITE_CONFIG >> 8) & 0xff;
  frame.set(header, 2);
  frame.set(packet, 15);
  return frame;
}

type Status = 'idle' | 'connecting' | 'sending' | 'done' | 'error';

interface Props {
  onConfigured?: (bleName: string) => void;
}

export function BleDeviceConfig({ onConfigured }: Props) {
  const [open, setOpen] = useState(false);
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [bleName, setBleName] = useState('');

  async function configure() {
    if (!ssid.trim()) { setError('SSID is required'); return; }
    setError('');
    setStatus('connecting');

    try {
      if (!navigator.bluetooth) throw new Error('Web Bluetooth not supported — use Chrome or Edge on desktop.');

      const device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'OD' }],
        optionalServices: [OD_UUID],
      });

      const name = device.name ?? 'OD??????';
      setBleName(name);
      setStatus('sending');

      const server = await device.gatt!.connect();
      const service = await server.getPrimaryService(OD_UUID);
      const char = await service.getCharacteristic(OD_UUID);

      const payload = buildConfigPayload(ssid.trim(), password);
      await char.writeValueWithResponse(payload as unknown as BufferSource);

      device.gatt!.disconnect();
      setStatus('done');
      onConfigured?.(name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'BLE operation failed');
      setStatus('error');
    }
  }

  function reset() {
    setStatus('idle');
    setError('');
    setBleName('');
  }

  const busy = status === 'connecting' || status === 'sending';

  return (
    <>
      <Button variant="outlined" size="sm" icon="bluetooth" onClick={() => { reset(); setOpen(true); }}>
        Configure via Bluetooth
      </Button>

      <Dialog
        open={open}
        onClose={() => { if (!busy) { setOpen(false); reset(); } }}
        title="Configure Device over BLE"
        icon="bluetooth"
        footer={
          status === 'done' ? (
            <Button onClick={() => { setOpen(false); reset(); }}>Done</Button>
          ) : (
            <>
              <Button variant="text" onClick={() => { setOpen(false); reset(); }} disabled={busy}>Cancel</Button>
              <Button onClick={configure} loading={busy} disabled={busy}>
                {status === 'connecting' ? 'Scanning…' : status === 'sending' ? 'Sending…' : 'Send WiFi Credentials'}
              </Button>
            </>
          )
        }
      >
        {status === 'done' ? (
          <div className="text-sm text-fg2 leading-relaxed">
            <p className="m-0 mb-2 text-success font-medium">WiFi credentials sent to <code>{bleName}</code>.</p>
            <p className="m-0">The device will connect to your network within ~10 seconds. Add it on the Devices page using the BLE name <code>{bleName}</code>.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-fg2 m-0 leading-relaxed">
              Make sure your device is powered on and advertising. It will appear as <code>OD…</code> in the Bluetooth picker.
            </p>
            <Field label="WiFi Network (SSID)" htmlFor="cfg-ssid">
              <Input id="cfg-ssid" value={ssid} placeholder="My Network" onChange={(e) => setSsid(e.target.value)} disabled={busy} />
            </Field>
            <Field label="WiFi Password" htmlFor="cfg-pw">
              <Input id="cfg-pw" type="password" value={password} placeholder="(leave blank for open networks)" onChange={(e) => setPassword(e.target.value)} disabled={busy} />
            </Field>
            {error && <p className="text-sm text-error m-0">{error}</p>}
          </div>
        )}
      </Dialog>
    </>
  );
}
