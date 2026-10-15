import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { deleteApiKey, getApiKeys, getPreferences, upsertApiKey } from '../services/database';
import { calendarIdFromWidget, calendarProvider, isCalendarId, storedCalendarWidgets } from '../utils/calendarWidgets';
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

// Additional calendars keep their private ICS URL in an encrypted api_keys row named after the
// widget. The URL is write-only: no route returns it, only whether it is stored.
router.get('/widgets', async (req, res) => {
  try {
    const owner = await getOrCreateUserFromClerk(req.clerkUserId!);
    const keys = await getApiKeys(owner);
    res.json({ configured: keys.map((key) => calendarIdFromWidget(key.provider)).filter((id): id is string => id !== null) });
  } catch { res.status(500).json({ error: 'Unable to load calendar credential status' }); }
});

/** The ID of a calendar the user has saved, so a URL can never be stored for a calendar that does not exist. */
async function savedCalendarId(req: { params: { id?: string }; clerkUserId?: string }): Promise<{ owner: string; id: string } | null> {
  const id = req.params.id;
  if (!isCalendarId(id)) return null;
  const owner = await getOrCreateUserFromClerk(req.clerkUserId!);
  const saved = storedCalendarWidgets((await getPreferences(owner))?.calendar_widgets);
  return saved.some((calendar) => calendar.id === id) ? { owner, id } : null;
}

router.post('/widgets/:id', async (req, res) => {
  try { validatePublicHttpsUrl(req.body?.url); }
  catch { res.status(400).json({ error: 'Calendar URL must be a public HTTPS URL on port 443 (maximum 2048 characters)' }); return; }
  try {
    const target = await savedCalendarId(req);
    if (!target) { res.status(404).json({ error: 'Save the calendar before adding its URL' }); return; }
    await upsertApiKey(target.owner, calendarProvider(target.id), req.body.url);
    res.json({ configured: true });
  } catch { res.status(500).json({ error: 'Unable to save calendar URL' }); }
});

router.delete('/widgets/:id', async (req, res) => {
  try {
    // A calendar already removed from the list may still have a URL to clean up.
    if (!isCalendarId(req.params.id)) { res.status(404).json({ error: 'Unknown calendar' }); return; }
    const owner = await getOrCreateUserFromClerk(req.clerkUserId!);
    await deleteApiKey(owner, calendarProvider(req.params.id));
    res.json({ configured: false });
  } catch { res.status(500).json({ error: 'Unable to remove calendar URL' }); }
});
export default router;
