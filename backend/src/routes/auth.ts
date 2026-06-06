import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { upsertUser, getUserById } from '../services/database';
import { createClerkClient } from '@clerk/backend';

/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: Authentication and user sync via Clerk
 *
 * /api/auth/login:
 *   post:
 *     summary: Sync Clerk user into Supabase
 *     description: Called after Clerk authentication to upsert the user in the database
 *     tags: [Auth]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: User synced successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       400:
 *         description: Clerk user has no email address
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized — missing or invalid Bearer token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server misconfiguration
 *
 * /api/auth/user:
 *   get:
 *     summary: Get current authenticated user
 *     tags: [Auth]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Current user details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *
 * /api/auth/oauth/google/callback:
 *   post:
 *     summary: Google OAuth callback (stub — use Clerk)
 *     tags: [Auth]
 *     responses:
 *       501:
 *         description: Not implemented
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */

const router = Router();

/**
 * POST /api/auth/login
 * Called after Clerk auth to sync user into Supabase
 */
router.post(
  '/login',
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
        res.status(400).json({ error: 'Clerk user has no email address' });
        return;
      }

      const displayName =
        [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') || undefined;

      const user = await upsertUser(email, displayName);

      res.json({ user });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/auth/user
 * Returns the currently authenticated user
 */
router.get(
  '/user',
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
      res.json({ user });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/oauth/google/callback  (stub)
 */
router.post('/oauth/google/callback', (_req: Request, res: Response) => {
  res.status(501).json({ error: 'Google OAuth callback not implemented — use Clerk' });
});


export default router;
