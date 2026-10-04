import { Router, Request, Response, NextFunction } from 'express';
import { createClerkClient } from '@clerk/backend';
import { requireAuth } from '../middleware/auth';
import {
  getFirmwareVersions,
  createFirmwareVersion,
  getFirmwareVersionById,
  upsertUser,
} from '../services/database';
import { getInstallManifest, listInstallableReleases, parseReleaseTag } from '../services/firmwareInstall';
import type { FirmwareVersion } from '../types';

const router = Router();

async function buildDefaultEntry(_req: Request): Promise<FirmwareVersion> {
  const release = await getInstallManifest().catch(() => null);
  return {
    id: 'default', user_id: 'system', version: release?.version ?? 'Unavailable',
    download_path: '/flash', checksum: null,
    release_notes: 'Complete factory firmware. Install via USB, then configure Wi-Fi through the device setup network.',
    // The release date when the source reports one; the epoch marks it as unknown.
    active: !!release, created_at: release?.release_date ?? new Date(0).toISOString(), is_default: true,
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
 * GET /api/firmware/public-releases
 * The recent complete factory releases the public /flash page can switch between, newest first.
 * Must be declared before requireAuth routes to avoid auth middleware.
 */
router.get(
  '/public-releases',
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const releases = await listInstallableReleases().catch(() => []);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ releases });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/firmware/public-manifest
 * Optional `tag` pins one of the releases from /public-releases; omitted means the newest.
 * Returns a dynamically-resolved esp-web-tools manifest without authentication.
 * Used by the public /flash page so first-time users can flash without signing in.
 * Must be declared before requireAuth routes to avoid auth middleware.
 */
router.get(
  '/public-manifest',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tag = parseReleaseTag(req.query.tag);
      if (tag === null) { res.status(400).json({ error: 'Invalid firmware release tag' }); return; }
      const manifest = await getInstallManifest(req.query.panel === 'v12' ? 'v12' : 'original', tag).catch(() => null);
      if (!manifest) {
        res.status(503).json({ error: 'Firmware release not currently available. Try again later.' });
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json(manifest);
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
      const manifest = await getInstallManifest(req.query.panel === 'v12' ? 'v12' : 'original').catch(() => null);
      if (!manifest) {
        // Never offer an application-only image as a recovery installation.
        res.status(503).json({ error: 'Firmware release not currently available. Try again later.' });
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      // This endpoint is one directory deeper than public-manifest/manifest.json.
      // Keep it usable directly by ESP Web Tools as well as through a blob client.
      res.json({ ...manifest, builds: manifest.builds.map(build => ({
        ...build, parts: build.parts.map(part => ({ ...part, path: /^https?:/.test(part.path) ? part.path : `../${part.path}` })),
      })) });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/firmware/:id/manifest
 * Custom records only describe application images; they cannot safely erase and install a board.
 */
router.get(
  '/:id/manifest',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = await resolveUserId(req.clerkUserId!);
      const fw = await getFirmwareVersionById(userId, req.params.id);
      if (!fw) { res.status(404).json({ error: 'Firmware version not found' }); return; }
      res.status(422).json({ error: 'Custom application images do not include board and bootloader metadata. Use the factory installer at /flash.' });
    } catch (err) { next(err); }
  }
);

export default router;
