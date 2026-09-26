import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import {
  getPreferences,
  getApiKeys,
  logApiUsage,
  upsertUser,
} from '../services/database';
import { buildDisplayData, DEFAULT_PREFS } from '../services/displayData';
import { createClerkClient } from '@clerk/backend';

/**
 * @swagger
 * /api/preview:
 *   get:
 *     summary: Preview display data for the authenticated user
 *     description: Dashboard preview of what the e-ink display will render, using the user's current preferences
 *     tags: [Display Data]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Preview display data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DisplayData'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *
 * /api/checkout:
 *   post:
 *     summary: Create a checkout session (stub)
 *     description: Stripe integration is not yet implemented
 *     tags: [Billing]
 *     responses:
 *       501:
 *         description: Not implemented
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 message:
 *                   type: string
 */

const router = Router();

/**
 * GET /api/preview
 * Auth-required preview endpoint for the dashboard
 */
router.get(
  '/',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const clerkUserId = req.clerkUserId!;

      // Resolve Supabase user from Clerk ID
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

      logApiUsage(user.id, '/api/preview');

      const prefs = (await getPreferences(user.id)) ?? DEFAULT_PREFS;

      const apiKeyRows = await getApiKeys(user.id);
      const apiKeyMap: Record<string, string> = {};
      for (const row of apiKeyRows) {
        apiKeyMap[row.provider] = row.api_key;
      }

      const data = await buildDisplayData(user.id, prefs, apiKeyMap);
      res.json(data);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
