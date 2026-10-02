import { frameMetadata } from '../utils/displayProfile';
import { Router, Request, Response, NextFunction } from 'express';
import { createClerkClient } from '@clerk/backend';
import {
  getApiKeys,
  getUserByEmail,
  upsertUser,
} from '../services/database';
import { buildDisplayData } from '../services/displayData';
import { renderDisplayData, renderDisplayDataRaw } from '../utils/bmpGenerator';
import { requireAuth } from '../middleware/auth';
import { LayoutValidationError, parseDisplayLayout } from '../utils/layoutValidation';
import { layoutForDisplayData } from '../services/displaySchedule';
import { parsePreviewDeviceId, resolveDevicePreferences } from '../services/deviceDisplays';

const router = Router();

/** POST /api/image/preview/draft — render an unsaved layout without database writes. */
router.post('/preview/draft', requireAuth, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)
      || Object.keys(req.body).some((key) => !['layout', 'device_id'].includes(key))) {
      res.status(400).json({ error: 'Submit only the draft layout and optional device_id.' });
      return;
    }
    const layout = parseDisplayLayout(req.body.layout);
    const deviceId = parsePreviewDeviceId(req.body.device_id);
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) { res.status(500).json({ error: 'Server misconfiguration' }); return; }
    const clerkUser = await createClerkClient({ secretKey }).users.getUser(req.clerkUserId!);
    const email = clerkUser.emailAddresses.find((entry) => entry.id === clerkUser.primaryEmailAddressId)
      ?.emailAddress ?? clerkUser.emailAddresses[0]?.emailAddress;
    if (!email) { res.status(400).json({ error: 'No email on Clerk user' }); return; }

    // Unlike the saved preview routes, a draft never creates or updates a user.
    // All data belongs to the verified Clerk identity, never to submitted IDs.
    const user = await getUserByEmail(email);
    if (!user) { res.status(404).json({ error: 'Complete sign-in before previewing a layout.' }); return; }
    const prefs = await resolveDevicePreferences(user.id, deviceId);
    const keys = await getApiKeys(user.id);
    const apiKeyMap = Object.fromEntries(keys.map((key) => [key.provider, key.api_key]));
    const draftPrefs = prefs.display_schedule ? { ...prefs, display_schedule: null, ...(prefs.active_layout_id ? { active_layout_id: null } : {}) } : prefs;
    const data = await buildDisplayData(user.id, draftPrefs, apiKeyMap);
    const bmp = renderDisplayData(data, layout, prefs);
    res.setHeader('Content-Type', 'image/bmp');
    res.setHeader('Cache-Control', 'no-store');
    res.send(bmp);
  } catch (error) {
    if (error instanceof LayoutValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    next(error);
  }
});

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
      const deviceId = parsePreviewDeviceId(req.query.device_id);
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
      const prefs = await resolveDevicePreferences(user.id, deviceId);
      const apiKeyRows = await getApiKeys(user.id);
      const apiKeyMap: Record<string, string> = {};
      for (const row of apiKeyRows) apiKeyMap[row.provider] = row.api_key;

      const displayData = await buildDisplayData(user.id, prefs, apiKeyMap);
      const rawBuf = renderDisplayDataRaw(displayData, layoutForDisplayData(prefs, displayData), prefs);

      const meta = frameMetadata(prefs.display_profile);
      res.setHeader('X-Display-Width', meta.width);
      res.setHeader('X-Display-Height', meta.height);
      res.setHeader('X-Display-Rotation', meta.rotation);
      res.setHeader('X-Display-Encoding', meta.encoding);
      res.setHeader('X-Display-Row-Bytes', meta.rowBytes);
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
      const deviceId = parsePreviewDeviceId(req.query.device_id);
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

      const prefs = await resolveDevicePreferences(user.id, deviceId);
      const apiKeyRows = await getApiKeys(user.id);
      const apiKeyMap: Record<string, string> = {};
      for (const row of apiKeyRows) {
        apiKeyMap[row.provider] = row.api_key;
      }

      const displayData = await buildDisplayData(user.id, prefs, apiKeyMap);
      const bmpBuffer = renderDisplayData(displayData, layoutForDisplayData(prefs, displayData), prefs);

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
