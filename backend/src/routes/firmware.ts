import { Router, Request, Response, NextFunction } from 'express';
import { existsSync } from 'fs';
import path from 'path';
import { createClerkClient } from '@clerk/backend';
import { requireAuth } from '../middleware/auth';
import {
  getFirmwareVersions,
  createFirmwareVersion,
  getFirmwareVersionById,
  upsertUser,
} from '../services/database';
import { fetchLatestFirmwareRelease, buildManifestFromRelease } from '../services/githubRelease';
import type { FirmwareVersion } from '../types';

const router = Router();

const FIRMWARE_BUILDS_DIR = path.join(__dirname, '../../firmware/builds');
const DEFAULT_BIN = path.join(FIRMWARE_BUILDS_DIR, 'default.bin');

async function buildDefaultEntry(req: Request): Promise<FirmwareVersion> {
  const baseUrl = `${req.protocol}://${req.get('host')}`;

  const ghRelease = await fetchLatestFirmwareRelease().catch(() => null);
  if (ghRelease) {
    return {
      id: 'default',
      user_id: 'system',
      version: ghRelease.version,
      download_path: `${baseUrl}/firmware/default.bin`,
      checksum: null,
      release_notes: 'Official default firmware. Flash directly to your ESP32 via USB — no setup required.',
      active: true,
      created_at: new Date(0).toISOString(),
      is_default: true,
    };
  }

  // Fallback: env vars
  const version = process.env.DEFAULT_FIRMWARE_VERSION ?? '1.0.0';
  const externalUrl = process.env.DEFAULT_FIRMWARE_URL?.trim();
  const active = !!(externalUrl || existsSync(DEFAULT_BIN));
  return {
    id: 'default',
    user_id: 'system',
    version,
    download_path: `${baseUrl}/firmware/default.bin`,
    checksum: null,
    release_notes: 'Official default firmware. Flash directly to your ESP32 via USB — no setup required.',
    active,
    created_at: new Date(0).toISOString(),
    is_default: true,
  };
}

async function resolveUserId(clerkUserId: string): Promise<string> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error('CLERK_SECRET_KEY not set');

  const clerk = createClerkClient({ secretKey });
  const clerkUser = await clerk.users.getUser(clerkUserId);

  const email =
    clerkUser.emailAddresses.find((e) => e.id === clerkUser.primaryEmailAddressId)
      ?.emailAddress ?? clerkUser.emailAddresses[0]?.emailAddress;

  if (!email) throw new Error('Clerk user has no email address');

  const displayName =
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') || undefined;

  const user = await upsertUser(email, displayName);
  return user.id;
}

/**
 * GET /api/firmware
 * Lists firmware versions for the authenticated user, prepended with the system default.
 */
router.get(
  '/',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = await resolveUserId(req.clerkUserId!);
      const userVersions = await getFirmwareVersions(userId);
      const firmware_versions = [await buildDefaultEntry(req), ...userVersions];
      res.json({ firmware_versions });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/firmware
 * Create a new firmware release for OTA updates.
 */
router.post(
  '/',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = await resolveUserId(req.clerkUserId!);
      const { version, download_path, checksum, release_notes, active } = req.body as {
        version?: string;
        download_path?: string;
        checksum?: string;
        release_notes?: string;
        active?: boolean;
      };

      if (!version || typeof version !== 'string' || version.trim().length < 1) {
        res.status(400).json({ error: 'version is required' });
        return;
      }

      if (!download_path || typeof download_path !== 'string' || download_path.trim().length < 1) {
        res.status(400).json({ error: 'download_path is required' });
        return;
      }

      const firmware_version = await createFirmwareVersion(
        userId,
        version.trim(),
        download_path.trim(),
        checksum?.trim() ?? null,
        release_notes?.trim() ?? null,
        active ?? true
      );

      res.status(201).json({ firmware_version });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/firmware/public-manifest
 * Returns esp-web-tools manifest for the latest firmware release.
 * No authentication required — used by the public /flash page.
 */
router.get(
  '/public-manifest',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ghRelease = await fetchLatestFirmwareRelease().catch(() => null);
      if (!ghRelease) {
        res.status(503).json({ error: 'Firmware release not available. Try again later.' });
        return;
      }
      res.json(buildManifestFromRelease(ghRelease));
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/firmware/default/manifest
 * Returns esp-web-tools manifest for the backend-hosted default firmware binary.
 * Must be declared before /:id/manifest to take precedence.
 */
router.get(
  '/default/manifest',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ghRelease = await fetchLatestFirmwareRelease().catch(() => null);
      const externalUrl = process.env.DEFAULT_FIRMWARE_URL?.trim();
      if (!ghRelease && !externalUrl && !existsSync(DEFAULT_BIN)) {
        res.status(404).json({ error: 'Default firmware binary not available. Set GITHUB_REPO, DEFAULT_FIRMWARE_URL, or build firmware/builds/default.bin.' });
        return;
      }
      if (ghRelease) {
        res.json(buildManifestFromRelease(ghRelease));
        return;
      }
      const version = process.env.DEFAULT_FIRMWARE_VERSION ?? '1.0.0';
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const binaryUrl = externalUrl || `${baseUrl}/firmware/default.bin`;
      res.json({
        name: `ESP32 Display v${version}`,
        builds: [{ chipFamily: 'ESP32', parts: [{ path: binaryUrl, offset: 65536 }] }],
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/firmware/:id/manifest
 * Returns esp-web-tools manifest JSON. Binary at download_path must be a public URL.
 */
router.get(
  '/:id/manifest',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = await resolveUserId(req.clerkUserId!);
      const fw = await getFirmwareVersionById(userId, req.params.id);
      if (!fw) { res.status(404).json({ error: 'Firmware version not found' }); return; }
      res.json({
        name: `ESP32 Display v${fw.version}`,
        builds: [{ chipFamily: 'ESP32', parts: [{ path: fw.download_path, offset: 65536 }] }],
      });
    } catch (err) { next(err); }
  }
);

export default router;
