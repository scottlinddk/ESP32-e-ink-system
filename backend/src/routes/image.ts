import { Router, Request, Response, NextFunction } from 'express';
import { createClerkClient } from '@clerk/backend';
import {
  getPreferences,
  getApiKeys,
  upsertUser,
} from '../services/database';
import { buildDisplayData, DEFAULT_PREFS } from '../services/displayData';
import { renderDisplayData, renderDisplayDataRaw } from '../utils/bmpGenerator';
import { requireAuth } from '../middleware/auth';

const router = Router();

/**
 * GET /api/image/preview
 * JWT-protected preview for the dashboard — returns a 1-bit BMP for the
 * authenticated user's current preferences, just like /api/preview returns JSON.
 *
 * @swagger
 * /api/image/preview:
 *   get:
 *     summary: Get a server-rendered BMP preview for the authenticated user
 *     description: >
 *       Dashboard preview endpoint. Returns a 1-bit BMP with the same live data as
 *       the Bluetooth transfer, generated from the current preferences and
 *       live data.  Requires a Clerk JWT Bearer token.
 *     tags: [Image]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Raw 1-bit BMP image (250×122 px)
 *         content:
 *           image/bmp:
 *             schema:
 *               type: string
 *               format: binary
 *       401:
 *         description: Unauthorized
 */
/**
 * GET /api/image/preview/raw
 * Returns raw 1-bit pixel bytes (no BMP header) for OpenDisplay BLE direct write.
 * 32 bytes/row × 122 rows = 3,904 bytes. Bit convention: 1=white, 0=black.
 * Requires Clerk JWT Bearer token.
 */
router.get(
  '/preview/raw',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const clerkUserId = req.clerkUserId!;
      const secretKey = process.env.CLERK_SECRET_KEY;
      if (!secretKey) { res.status(500).json({ error: 'Server misconfiguration' }); return; }

      const clerk = createClerkClient({ secretKey });
      const clerkUser = await clerk.users.getUser(clerkUserId);
      const email =
        clerkUser.emailAddresses.find((e) => e.id === clerkUser.primaryEmailAddressId)
          ?.emailAddress ?? clerkUser.emailAddresses[0]?.emailAddress;
      if (!email) { res.status(400).json({ error: 'No email on Clerk user' }); return; }

      const user = await upsertUser(email);
      const prefs = (await getPreferences(user.id)) ?? DEFAULT_PREFS;
      const apiKeyRows = await getApiKeys(user.id);
      const apiKeyMap: Record<string, string> = {};
      for (const row of apiKeyRows) apiKeyMap[row.provider] = row.api_key;

      const displayData = await buildDisplayData(user.id, prefs, apiKeyMap);
      const rawBuf = renderDisplayDataRaw(displayData, prefs.layout ?? null, prefs);

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', rawBuf.length);
      res.setHeader('Cache-Control', 'no-store');
      res.send(rawBuf);
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/preview',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const clerkUserId = req.clerkUserId!;

      const secretKey = process.env.CLERK_SECRET_KEY;
      if (!secretKey) {
        res.status(500).json({ error: 'Server misconfiguration' });
        return;
      }

      const clerk = createClerkClient({ secretKey });
      const clerkUser = await clerk.users.getUser(clerkUserId);
      const email =
        clerkUser.emailAddresses.find((e) => e.id === clerkUser.primaryEmailAddressId)
          ?.emailAddress ?? clerkUser.emailAddresses[0]?.emailAddress;

      if (!email) {
        res.status(400).json({ error: 'No email on Clerk user' });
        return;
      }

      const user = await upsertUser(email);

      const prefs = (await getPreferences(user.id)) ?? DEFAULT_PREFS;
      const apiKeyRows = await getApiKeys(user.id);
      const apiKeyMap: Record<string, string> = {};
      for (const row of apiKeyRows) {
        apiKeyMap[row.provider] = row.api_key;
      }

      const displayData = await buildDisplayData(user.id, prefs, apiKeyMap);
      const bmpBuffer = renderDisplayData(displayData, prefs.layout ?? null, prefs);

      res.setHeader('Content-Type', 'image/bmp');
      res.setHeader('Content-Length', bmpBuffer.length);
      res.setHeader('Cache-Control', 'no-store');
      res.send(bmpBuffer);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
