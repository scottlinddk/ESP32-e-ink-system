import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { getOrCreateUserFromClerk } from './preferences-helpers';
import { getDeviceDisplay, parsePreviewDeviceId, saveDeviceDisplay } from '../services/deviceDisplays';

const router = Router();
router.use(requireAuth);
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
router.get('/:id/display', async (req, res, next) => {
  try {
    const id = parsePreviewDeviceId(req.params.id)!;
    res.json(await getDeviceDisplay(await getOrCreateUserFromClerk(req.clerkUserId!), id));
  } catch (error) { next(error); }
});
router.put('/:id/display', async (req, res, next) => {
  try {
    const id = parsePreviewDeviceId(req.params.id)!;
    res.json(await saveDeviceDisplay(await getOrCreateUserFromClerk(req.clerkUserId!), id, req.body));
  } catch (error) { next(error); }
});
export default router;
