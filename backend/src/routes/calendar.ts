import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { deleteApiKey, getApiKeys, upsertApiKey } from '../services/database';
import { getOrCreateUserFromClerk } from './preferences-helpers';
import { validatePublicHttpsUrl } from '../utils/publicFeedFetch';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const owner = await getOrCreateUserFromClerk(req.clerkUserId!);
    const keys = await getApiKeys(owner);
    res.json({ configured: keys.some((key) => key.provider === 'calendar') });
  } catch { res.status(500).json({ error: 'Unable to load calendar credential status' }); }
});

router.post('/', async (req, res) => {
  try { validatePublicHttpsUrl(req.body?.url); }
  catch { res.status(400).json({ error: 'Calendar URL must be a public HTTPS URL on port 443 (maximum 2048 characters)' }); return; }
  try {
    const owner = await getOrCreateUserFromClerk(req.clerkUserId!);
    await upsertApiKey(owner, 'calendar', req.body.url);
    res.json({ configured: true });
  } catch { res.status(500).json({ error: 'Unable to save calendar URL' }); }
});

router.delete('/', async (req, res) => {
  try {
    const owner = await getOrCreateUserFromClerk(req.clerkUserId!);
    await deleteApiKey(owner, 'calendar');
    res.json({ configured: false });
  } catch { res.status(500).json({ error: 'Unable to remove calendar URL' }); }
});
export default router;
