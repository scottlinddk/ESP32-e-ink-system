import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { createClerkClient } from '@clerk/backend';
import { requireAuth } from '../middleware/auth';
import {
  upsertUser,
  getDevices,
  createDevice,
  updateDeviceName,
  deleteDevice,
} from '../services/database';

/**
 * @swagger
 * tags:
 *   name: Devices
 *   description: ESP32 device registration and management
 *
 * /api/devices:
 *   get:
 *     summary: List all devices for the authenticated user
 *     tags: [Devices]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: List of registered devices
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 devices:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Device'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *
 *   post:
 *     summary: Register a new device
 *     tags: [Devices]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - device_name
 *             properties:
 *               device_name:
 *                 type: string
 *                 example: Living Room Display
 *               device_id:
 *                 type: string
 *                 description: Hardware ID — auto-generated if omitted
 *                 example: ESP-A1B2C3
 *     responses:
 *       201:
 *         description: Device registered with a generated license key
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 device:
 *                   $ref: '#/components/schemas/Device'
 *       400:
 *         description: Validation error (device_name required)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *
 * /api/devices/{id}:
 *   put:
 *     summary: Rename a device
 *     tags: [Devices]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Device UUID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - device_name
 *             properties:
 *               device_name:
 *                 type: string
 *                 example: Kitchen Display
 *     responses:
 *       200:
 *         description: Device renamed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 device:
 *                   $ref: '#/components/schemas/Device'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *
 *   delete:
 *     summary: Delete a device
 *     tags: [Devices]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Device UUID
 *     responses:
 *       200:
 *         description: Device deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *       401:
 *         description: Unauthorized
 */

const router = Router();

async function resolveUserId(clerkUserId: string): Promise<string> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error('CLERK_SECRET_KEY not set');

  const clerk = createClerkClient({ secretKey });
  const clerkUser = await clerk.users.getUser(clerkUserId);

  const email =
    clerkUser.emailAddresses.find((e) => e.id === clerkUser.primaryEmailAddressId)
      ?.emailAddress ?? clerkUser.emailAddresses[0]?.emailAddress;

  if (!email) throw new Error('Clerk user has no email address');

  const displayName =
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') || undefined;

  const user = await upsertUser(email, displayName);
  return user.id;
}

function generateLicenseKey(): string {
  const part = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `DSPL-${part()}-${part()}-${part()}`;
}

/** GET /api/devices */
router.get(
  '/',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = await resolveUserId(req.clerkUserId!);
      const devices = await getDevices(userId);
      res.json({ devices });
    } catch (err) {
      next(err);
    }
  }
);

/** POST /api/devices */
router.post(
  '/',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = await resolveUserId(req.clerkUserId!);
      const { device_id, device_name } = req.body as {
        device_id?: string;
        device_name?: string;
      };

      if (!device_name || typeof device_name !== 'string' || device_name.trim().length < 1) {
        res.status(400).json({ error: 'device_name is required' });
        return;
      }

      const hardwareId =
        (device_id ?? '').trim() ||
        'ESP-' + crypto.randomBytes(3).toString('hex').toUpperCase();

      const licenseKey = generateLicenseKey();
      const device = await createDevice(userId, hardwareId, device_name.trim(), licenseKey);
      res.status(201).json({ device });
    } catch (err) {
      next(err);
    }
  }
);

/** PUT /api/devices/:id */
router.put(
  '/:id',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = await resolveUserId(req.clerkUserId!);
      const { id } = req.params as { id: string };
      const { device_name } = req.body as { device_name?: string };

      if (!device_name || typeof device_name !== 'string' || device_name.trim().length < 1) {
        res.status(400).json({ error: 'device_name is required' });
        return;
      }

      const device = await updateDeviceName(id, userId, device_name.trim());
      res.json({ device });
    } catch (err) {
      next(err);
    }
  }
);

/** DELETE /api/devices/:id */
router.delete(
  '/:id',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = await resolveUserId(req.clerkUserId!);
      const { id } = req.params as { id: string };
      await deleteDevice(id, userId);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
