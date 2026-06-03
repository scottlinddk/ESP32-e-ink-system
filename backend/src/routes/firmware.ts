import { Router, Request, Response, NextFunction } from 'express';
import { createClerkClient } from '@clerk/backend';
import { requireAuth } from '../middleware/auth';
import {
  getFirmwareVersions,
  createFirmwareVersion,
  getFirmwareVersionById,
  upsertUser,
} from '../services/database';

const router = Router();

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
 * Admin endpoint to list firmware versions for the authenticated user
 */
router.get(
  '/',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = await resolveUserId(req.clerkUserId!);
      const firmware_versions = await getFirmwareVersions(userId);
      res.json({ firmware_versions });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/firmware
 * Create a new firmware release for OTA updates
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
 * GET /api/firmware/:id/manifest
 * Returns esp-web-tools manifest JSON. The binary at download_path must be a publicly accessible URL.
 */
router.get(
  '/:id/manifest',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = await resolveUserId(req.clerkUserId!);
      const fw = await getFirmwareVersionById(userId, req.params.id);
      if (!fw) {
        res.status(404).json({ error: 'Firmware version not found' });
        return;
      }
      res.json({
        name: `ESP32 Display v${fw.version}`,
        builds: [
          {
            chipFamily: 'ESP32',
            parts: [{ path: fw.download_path, offset: 65536 }],
          },
        ],
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
