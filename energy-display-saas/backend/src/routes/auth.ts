import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { upsertUser, getUserById } from '../services/database.js';
import { createClerkClient } from '@clerk/backend';

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

/**
 * POST /api/oauth/apple/callback  (stub)
 */
router.post('/oauth/apple/callback', (_req: Request, res: Response) => {
  res.status(501).json({ error: 'Apple OAuth callback not implemented — use Clerk' });
});

export default router;
