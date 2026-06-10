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
import { getOAuthAppCreds } from '../services/database';
import { FEATURES } from '../config/features';
import { logger } from '../lib/logger';

const router = Router();

// Feature-flag guards — flip the flags in config/features.ts to re-enable.
function requireStravaEnabled(_req: Request, res: Response, next: NextFunction): void {
  if (!FEATURES.strava) {
    res.status(503).json({ error: 'Strava integration is currently disabled' });
    return;
  }
  next();
}

function requireGcalEnabled(_req: Request, res: Response, next: NextFunction): void {
  if (!FEATURES.googleCalendar) {
    res.status(503).json({ error: 'Google Calendar integration is currently disabled' });
    return;
  }
  next();
}

// ────────────────────────────────────────────────────────────────────────────────
// Strava OAuth
// ────────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/oauth/strava/authorize
 * Returns the Strava authorization URL. Called via fetch (with Clerk Bearer token).
 */
router.get(
  '/strava/authorize',
  requireStravaEnabled,
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = await getOrCreateUserFromClerk(req.clerkUserId!);
      const creds = await getOAuthAppCreds(userId, 'strava');
      const redirectUri = process.env.STRAVA_REDIRECT_URI;

      if (!creds || !redirectUri) {
        res.status(503).json({ error: 'Strava integration is not configured. Add your Strava Client ID and Secret in the dashboard.' });
        return;
      }

      const state = createOAuthState(userId);
      const params = new URLSearchParams({
        client_id: creds.clientId,
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
  requireStravaEnabled,
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

      const creds = await getOAuthAppCreds(userId, 'strava');
      const redirectUri = process.env.STRAVA_REDIRECT_URI;

      if (!creds || !redirectUri) {
        res.redirect(`${frontendBase}/?strava=error&reason=not_configured`);
        return;
      }

      const tokenResp = await fetch('https://www.strava.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: creds.clientId,
          client_secret: creds.clientSecret,
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
  requireStravaEnabled,
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
  requireStravaEnabled,
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

// ────────────────────────────────────────────────────────────────────────────────
// Google Calendar OAuth
// ────────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/oauth/google_calendar/authorize
 * Returns the Google OAuth authorization URL.
 */
router.get(
  '/google_calendar/authorize',
  requireGcalEnabled,
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = await getOrCreateUserFromClerk(req.clerkUserId!);
      const creds = await getOAuthAppCreds(userId, 'google');
      const redirectUri = process.env.GOOGLE_REDIRECT_URI;

      if (!creds || !redirectUri) {
        res.status(503).json({ error: 'Google Calendar integration is not configured. Add your Google Client ID and Secret in the dashboard.' });
        return;
      }

      const { google } = await import('googleapis');
      const oauth2Client = new google.auth.OAuth2(creds.clientId, creds.clientSecret, redirectUri);

      const state = createOAuthState(userId);
      const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: ['https://www.googleapis.com/auth/calendar.readonly'],
        state,
      });

      res.json({ url });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/oauth/google_calendar/callback
 * No Clerk auth — Google redirects here after consent.
 */
router.get(
  '/google_calendar/callback',
  requireGcalEnabled,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const frontendBase = process.env.FRONTEND_URL ?? 'http://localhost:5173';
    try {
      const { code, state, error: oauthError } = req.query as Record<string, string>;

      if (oauthError) {
        res.redirect(`${frontendBase}/?gcal=denied`);
        return;
      }

      if (!code || !state) {
        res.redirect(`${frontendBase}/?gcal=error&reason=missing_params`);
        return;
      }

      let userId: string;
      try {
        userId = verifyOAuthState(state);
      } catch {
        res.redirect(`${frontendBase}/?gcal=error&reason=invalid_state`);
        return;
      }

      const creds = await getOAuthAppCreds(userId, 'google');
      const redirectUri = process.env.GOOGLE_REDIRECT_URI;

      if (!creds || !redirectUri) {
        res.redirect(`${frontendBase}/?gcal=error&reason=not_configured`);
        return;
      }

      const { google } = await import('googleapis');
      const oauth2Client = new google.auth.OAuth2(creds.clientId, creds.clientSecret, redirectUri);
      const { tokens } = await oauth2Client.getToken(code);

      const email = tokens.id_token
        ? JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString()).email as string
        : undefined;

      await upsertOAuthConnection(
        userId,
        'google_calendar',
        tokens.access_token!,
        tokens.refresh_token ?? null,
        tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        email
      );

      res.redirect(`${frontendBase}/?gcal=connected`);
    } catch (err) {
      logger.error({ err }, 'Google Calendar OAuth callback error');
      const fb = process.env.FRONTEND_URL ?? 'http://localhost:5173';
      res.redirect(`${fb}/?gcal=error&reason=server_error`);
      next(err);
    }
  }
);

/**
 * GET /api/oauth/google_calendar/status
 */
router.get(
  '/google_calendar/status',
  requireGcalEnabled,
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = await getOrCreateUserFromClerk(req.clerkUserId!);
      const conn = await getOAuthConnection(userId, 'google_calendar');
      res.json({ connected: !!conn, athleteId: conn?.provider_account_id ?? null });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/oauth/google_calendar
 */
router.delete(
  '/google_calendar',
  requireGcalEnabled,
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = await getOrCreateUserFromClerk(req.clerkUserId!);
      await deleteOAuthConnection(userId, 'google_calendar');
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
