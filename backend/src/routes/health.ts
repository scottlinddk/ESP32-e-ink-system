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
 * GET /health/ready (alias: /health/db)
 * Readiness: a real statement against PostgreSQL. 200 {status:"ok"}, or 503 with only a coarse
 * reason (never server text, host names or credentials). Use this for deploy gating and
 * monitoring. The container health check stays on GET /health, which never touches the
 * database, so a database outage does not restart a healthy API process.
 */
async function readiness(_req: Request, res: Response): Promise<void> {
  const result = await checkDatabase();
  res.setHeader('Cache-Control', 'no-store');
  if (result.ok) {
    res.json({ status: 'ok' });
    return;
  }
  res.status(503).json({ status: 'error', reason: result.reason });
}
router.get('/ready', readiness);
router.get('/db', readiness);

export default router;
