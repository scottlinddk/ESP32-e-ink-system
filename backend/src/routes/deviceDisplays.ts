import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { getOrCreateUserFromClerk } from './preferences-helpers';
import { getDeviceDisplay, parsePreviewDeviceId, saveDeviceDisplay } from '../services/deviceDisplays';
import { redactForCollaborator, resolveDeviceAccess } from '../services/sharing';

const router = Router();
router.use(requireAuth);
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
// A collaborator reads and writes the owner's device through the owner's ID, but sees presentation only.
router.get('/:id/display', async (req, res, next) => {
  try {
    const id = parsePreviewDeviceId(req.params.id)!;
    const access = await resolveDeviceAccess(await getOrCreateUserFromClerk(req.clerkUserId!), id, 'viewer');
    const display = await getDeviceDisplay(access.ownerId, id);
    res.json({ ...display, preferences: access.role === 'owner' ? display.preferences : redactForCollaborator(display.preferences), access: access.role });
  } catch (error) { next(error); }
});
router.put('/:id/display', async (req, res, next) => {
  try {
    const id = parsePreviewDeviceId(req.params.id)!;
    const access = await resolveDeviceAccess(await getOrCreateUserFromClerk(req.clerkUserId!), id, 'editor');
    const display = await saveDeviceDisplay(access.ownerId, id, req.body);
    res.json({ ...display, preferences: access.role === 'owner' ? display.preferences : redactForCollaborator(display.preferences), access: access.role });
  } catch (error) { next(error); }
});
export default router;
