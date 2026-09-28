import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { getOrCreateUserFromClerk } from './preferences-helpers';
import { getPreferences, upsertPreferences } from '../services/database';
import { DEFAULT_PREFS } from '../services/displayData';
import { exportDisplayTemplate, parseDisplayTemplate, STARTER_TEMPLATES, TemplateValidationError } from '../utils/displayTemplates';

const router = Router();
router.use(requireAuth);
router.get('/starters', (_req, res) => { res.json({ templates: STARTER_TEMPLATES }); });
router.get('/export', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = await getOrCreateUserFromClerk(req.clerkUserId!);
    const prefs = await getPreferences(userId);
    res.setHeader('Cache-Control', 'no-store');
    res.json(exportDisplayTemplate(prefs ?? DEFAULT_PREFS));
  } catch (error) { next(error); }
});
router.post('/validate', (req: Request, res: Response) => {
  try { res.json({ template: parseDisplayTemplate(req.body) }); }
  catch (error) {
    if (error instanceof TemplateValidationError) { res.status(400).json({ error: error.message }); return; }
    throw error;
  }
});
router.post('/import', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Validate the entire document before the first persistence operation.
    const template = parseDisplayTemplate(req.body);
    const userId = await getOrCreateUserFromClerk(req.clerkUserId!);
    const preferences = await upsertPreferences(userId, template.settings);
    res.json({ preferences });
  } catch (error) {
    if (error instanceof TemplateValidationError) { res.status(400).json({ error: error.message }); return; }
    next(error);
  }
});
export default router;
