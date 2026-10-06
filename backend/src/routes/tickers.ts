import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { searchTickers } from '../ticker';
import { QuoteProviderError } from '../ticker/providers/QuoteProvider';

const router = Router();

/**
 * @swagger
 * /api/tickers/search:
 *   get:
 *     summary: Search stock symbols
 *     description: Searches Yahoo Finance equities. Use region=dk to list only Nasdaq Copenhagen (symbols end in .CO).
 *     tags: [Tickers]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema: { type: string, minLength: 1, maxLength: 40 }
 *       - in: query
 *         name: region
 *         schema: { type: string, enum: [any, dk], default: any }
 *     responses:
 *       200:
 *         description: Matching symbols
 *       400:
 *         description: Missing or invalid query
 *       502:
 *         description: Yahoo Finance is unavailable
 */
router.get('/search', requireAuth, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { q, region } = req.query;
    if (typeof q !== 'string' || q.trim().length < 1 || q.trim().length > 40) {
      res.status(400).json({ error: 'Enter 1–40 characters to search.' });
      return;
    }
    if (region !== undefined && region !== 'any' && region !== 'dk') {
      res.status(400).json({ error: 'Region must be "any" or "dk".' });
      return;
    }
    const results = await searchTickers(q, region ?? 'any');
    res.json({ results });
  } catch (err) {
    // Provider messages are fixed strings; network details never reach the client.
    if (err instanceof QuoteProviderError) {
      res.status(502).json({ error: err.message });
      return;
    }
    next(err);
  }
});

export default router;
