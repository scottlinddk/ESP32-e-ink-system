import { Router, Request, Response } from 'express';
import { checkDatabase } from '../services/databaseHealth';

/**
 * @swagger
 * tags:
 *   name: Health
 *   description: Server health check
 *
 * /health:
 *   get:
 *     summary: Health check
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Server is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 uptime:
 *                   type: number
 *                   description: Process uptime in seconds
 *                 version:
 *                   type: string
 *                   example: 1.0.0
 */

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version ?? '1.0.0',
  });
});

/**
 * GET /health/db
 * Checks the database URL, gateway and token. Returns only a coarse reason on
 * failure, never upstream text.
 */
router.get('/db', async (_req: Request, res: Response) => {
  const result = await checkDatabase();
  res.setHeader('Cache-Control', 'no-store');
  if (result.ok) {
    res.json({ status: 'ok' });
    return;
  }
  res.status(503).json({ status: 'error', reason: result.reason });
});

export default router;
