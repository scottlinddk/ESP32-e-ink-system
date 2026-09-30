import { Router } from 'express';
import { Readable } from 'stream';
import { fetchLatestFirmwareRelease, FIRMWARE_ASSETS, type FirmwareAsset } from '../services/githubRelease';
import { getInstallManifest, readLocalFactory } from '../services/firmwareInstall';

const router = Router();

router.get('/manifest.json', async (req, res, next) => {
  try {
    const manifest = await getInstallManifest(req.query.panel === 'v12' ? 'v12' : 'original');
    res.setHeader('Cache-Control', 'no-store');
    if (!manifest) { res.status(503).json({ error: 'No complete firmware release is available yet.' }); return; }
    res.json(manifest);
  } catch (error) { next(error); }
});

router.get('/local/:hash/:name', async (req, res) => {
  try {
    const { bytes, hash } = await readLocalFactory(req.params.name);
    if (hash !== req.params.hash) { res.status(409).json({ error: 'Local firmware changed. Reload the installer.' }); return; }
    res.type('application/octet-stream').set('Cache-Control', 'public, max-age=31536000, immutable').send(bytes);
  } catch { res.status(404).json({ error: 'Validated local firmware image not available' }); }
});

// Resolve the exact release from the manifest. Never mix parts across releases.
router.get('/releases/:tag/:name', async (req, res, next) => {
  const { tag, name } = req.params;
  if (tag.length > 128 || !/^[a-zA-Z0-9._+-]+$/.test(tag) || !FIRMWARE_ASSETS.includes(name as FirmwareAsset)) {
    res.status(404).json({ error: 'Unknown firmware asset' }); return;
  }
  try {
    const release = await fetchLatestFirmwareRelease(tag);
    const url = release?.assets[name as FirmwareAsset];
    if (!url) { res.status(404).json({ error: 'Firmware asset not available' }); return; }
    const upstream = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60000) });
    if (!upstream.ok || !upstream.body) { res.status(502).json({ error: 'Firmware download failed. Try again.' }); return; }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=300');
    const length = upstream.headers.get('content-length');
    if (length) res.setHeader('Content-Length', length);
    const stream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
    stream.on('error', (error) => { if (res.headersSent) res.destroy(error); else next(error); });
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  } catch (error) { next(error); }
});

export default router;
