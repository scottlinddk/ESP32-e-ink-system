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
import { createError } from '../middleware/errorHandler';
import type { DisplayData, DisplayLayout, DisplaySchedule, UserPreferences } from '../types';

const router = Router();

type SchedulePage = DisplaySchedule['pages'][number];

/** Optional `page_id`: render that saved slideshow page instead of the one scheduled now. */
function parsePreviewPageId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,48}$/.test(value)) throw createError('page_id must be a saved page ID.', 400);
  return value;
}

/** Describe these exact pixels, without resolving the schedule again after a slow fetch. */
function setPreviewHeaders(res: Response, prefs: UserPreferences, data: DisplayData, deviceId?: string, selection?: 'draft' | SchedulePage) {
  const draft = selection === 'draft';
  const page = typeof selection === 'object' ? selection : undefined;
  const live = !selection;
  const profile = frameMetadata(prefs.display_profile);
  const layoutId = draft ? '' : page?.id ?? data.schedule?.pageId ?? prefs.active_layout_id ?? '';
  const name = draft ? 'Draft' : page?.name ?? prefs.display_schedule?.pages.find((entry) => entry.id === layoutId)?.name ?? 'Base layout';
  res.set({
    'X-Preview-Device-ID': deviceId ?? '',
    'X-Preview-Layout-ID': layoutId,
    'X-Preview-Mode': draft ? 'draft' : page ? 'page' : data.schedule ? 'slideshow' : 'single',
    // HTTP headers cannot contain raw Unicode/newlines. UTF-8 also replaces any
    // unpaired surrogate in a saved name before URI encoding can throw on it.
    'X-Preview-Layout-Name': encodeURIComponent(Buffer.from(name, 'utf8').toString('utf8')),
    'X-Preview-Rendered-At': new Date().toISOString(),
    'X-Preview-Quiet': String(live && Boolean(data.schedule?.quiet)),
    'X-Display-Width': String(profile.width), 'X-Display-Height': String(profile.height),
    'X-Display-Rotation': String(profile.rotation), 'X-Display-Encoding': profile.encoding,
    'X-Display-Row-Bytes': String(profile.rowBytes),
  });
  if (live && data.schedule?.nextTransitionAt) res.setHeader('X-Preview-Next-Transition', data.schedule.nextTransitionAt);
}

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
    setPreviewHeaders(res, prefs, data, deviceId, 'draft');
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
 * Resolve the pixels shown by the saved preview routes. Without `page_id` this is
 * the page scheduled now (exactly what the device receives); with it, the named
 * saved slideshow page, so the dashboard can step through every page.
 */
async function loadSavedPreview(req: Request): Promise<{ prefs: UserPreferences; data: DisplayData; layout: DisplayLayout | null; deviceId?: string; page?: SchedulePage }> {
  const deviceId = parsePreviewDeviceId(req.query.device_id);
  const pageId = parsePreviewPageId(req.query.page_id);
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw createError('Server misconfiguration', 500);
  const clerkUser = await createClerkClient({ secretKey }).users.getUser(req.clerkUserId!);
  const email = clerkUser.emailAddresses.find((entry) => entry.id === clerkUser.primaryEmailAddressId)
    ?.emailAddress ?? clerkUser.emailAddresses[0]?.emailAddress;
  if (!email) throw createError('No email on Clerk user', 400);

  const user = await upsertUser(email);
  const prefs = await resolveDevicePreferences(user.id, deviceId);
  const page = pageId === undefined ? undefined : prefs.display_schedule?.pages.find((entry) => entry.id === pageId);
  if (pageId !== undefined && !page) throw createError('Saved page not found. Reload saved settings.', 404);
  const keys = await getApiKeys(user.id);
  const apiKeyMap = Object.fromEntries(keys.map((key) => [key.provider, key.api_key]));
  // Sources do not depend on the layout, so a chosen page only bypasses page selection.
  const data = await buildDisplayData(user.id, page ? { ...prefs, display_schedule: null } : prefs, apiKeyMap);
  return { prefs, data, deviceId, page, layout: page ? page.layout : layoutForDisplayData(prefs, data) };
}

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
 *     parameters:
 *       - in: query
 *         name: device_id
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: page_id
 *         description: Render this saved slideshow page instead of the page scheduled now.
 *         schema: { type: string }
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
 * Accepts the same `device_id` and `page_id` as GET /api/image/preview.
 * Requires Clerk JWT Bearer token.
 */
router.get('/preview/raw', requireAuth, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { prefs, data, layout, deviceId, page } = await loadSavedPreview(req);
    const rawBuf = renderDisplayDataRaw(data, layout, prefs);
    setPreviewHeaders(res, prefs, data, deviceId, page);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', rawBuf.length);
    res.setHeader('Cache-Control', 'no-store');
    res.send(rawBuf);
  } catch (err) {
    next(err);
  }
});

router.get('/preview', requireAuth, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { prefs, data, layout, deviceId, page } = await loadSavedPreview(req);
    const bmpBuffer = renderDisplayData(data, layout, prefs);
    setPreviewHeaders(res, prefs, data, deviceId, page);
    res.setHeader('Content-Type', 'image/bmp');
    res.setHeader('Content-Length', bmpBuffer.length);
    res.setHeader('Cache-Control', 'no-store');
    res.send(bmpBuffer);
  } catch (err) {
    next(err);
  }
});

export default router;
