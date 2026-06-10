import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { getOrCreateUserFromClerk } from './preferences-helpers';
import {
  createOAuthState,
  verifyOAuthState,
  upsertOAuthConnection,
  getOAuthConnection,
  deleteOAuthConnection,
} from '../services/strava';
import { logger } from '../lib/logger';

const router = Router();

// ────────────────────────────────────────────────────────────────────────────────
// Strava OAuth
// ────────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/oauth/strava/authorize
 * Returns the Strava authorization URL. Called via fetch (with Clerk Bearer token).
 */
router.get(
  '/strava/authorize',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = await getOrCreateUserFromClerk(req.clerkUserId!);
      const clientId = process.env.STRAVA_CLIENT_ID;
      const redirectUri = process.env.STRAVA_REDIRECT_URI;

      if (!clientId || !redirectUri) {
        res.status(503).json({ error: 'Strava integration is not configured on this server' });
        return;
      }

      const state = createOAuthState(userId);
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        approval_prompt: 'auto',
        scope: 'read,activity:read_all',
        state,
      });

      res.json({ url: `https://www.strava.com/oauth/authorize?${params}` });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/oauth/strava/callback
 * No Clerk auth — provider redirects here. Exchanges code and stores tokens.
 */
router.get(
  '/strava/callback',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const frontendBase = process.env.FRONTEND_URL ?? 'http://localhost:5173';
    try {
      const { code, state, error: oauthError } = req.query as Record<string, string>;

      if (oauthError) {
        logger.warn({ oauthError }, 'Strava OAuth denied by user');
        res.redirect(`${frontendBase}/?strava=denied`);
        return;
      }

      if (!code || !state) {
        res.redirect(`${frontendBase}/?strava=error&reason=missing_params`);
        return;
      }

      let userId: string;
      try {
        userId = verifyOAuthState(state);
      } catch (err) {
        logger.warn({ err }, 'Strava OAuth state verification failed');
        res.redirect(`${frontendBase}/?strava=error&reason=invalid_state`);
        return;
      }

      const clientId = process.env.STRAVA_CLIENT_ID;
      const clientSecret = process.env.STRAVA_CLIENT_SECRET;
      const redirectUri = process.env.STRAVA_REDIRECT_URI;

      if (!clientId || !clientSecret || !redirectUri) {
        res.redirect(`${frontendBase}/?strava=error&reason=not_configured`);
        return;
      }

      const tokenResp = await fetch('https://www.strava.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          grant_type: 'authorization_code',
        }),
      });

      if (!tokenResp.ok) {
        const body = await tokenResp.text();
        logger.error({ body, status: tokenResp.status }, 'Strava token exchange failed');
        res.redirect(`${frontendBase}/?strava=error&reason=token_exchange`);
        return;
      }

      const tokens = (await tokenResp.json()) as {
        access_token: string;
        refresh_token: string;
        expires_at: number;
        athlete: { id: number; firstname: string; lastname: string };
      };

      await upsertOAuthConnection(
        userId,
        'strava',
        tokens.access_token,
        tokens.refresh_token,
        new Date(tokens.expires_at * 1000),
        String(tokens.athlete?.id ?? '')
      );

      res.redirect(`${frontendBase}/?strava=connected`);
    } catch (err) {
      logger.error({ err }, 'Strava OAuth callback error');
      const frontendBase2 = process.env.FRONTEND_URL ?? 'http://localhost:5173';
      res.redirect(`${frontendBase2}/?strava=error&reason=server_error`);
      next(err);
    }
  }
);

/**
 * GET /api/oauth/strava/status
 * Returns connection status for the authenticated user.
 */
router.get(
  '/strava/status',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = await getOrCreateUserFromClerk(req.clerkUserId!);
      const conn = await getOAuthConnection(userId, 'strava');
      res.json({ connected: !!conn, athleteId: conn?.provider_account_id ?? null });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/oauth/strava
 * Disconnect Strava for the authenticated user.
 */
router.delete(
  '/strava',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = await getOrCreateUserFromClerk(req.clerkUserId!);
      await deleteOAuthConnection(userId, 'strava');
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
