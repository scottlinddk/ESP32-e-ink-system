import { Router, Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createClerkClient } from '@clerk/backend';
import { requireAuth } from '../middleware/auth';
import {
  upsertUser,
  getDevices,
  createDevice,
  updateDeviceName,
  deleteDevice,
  getDeviceByLicenseKey,
  getDeviceByDeviceId,
  getLatestFirmwareVersion,
  getFirmwareVersionByUserAndVersion,
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

/**
 * POST /api/devices/pair
 *
 * Unauthenticated endpoint called by the ESP32 on first WiFi connect.
 * Idempotent: returns existing credentials if the device already registered.
 * New devices are registered under an auto-provisioned system user until a
 * dashboard user claims the device.
 */
router.post(
  '/pair',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { mac_address, device_name } = req.body as {
        mac_address?: string;
        device_name?: string;
      };

      if (!mac_address || typeof mac_address !== 'string') {
        res.status(400).json({ error: 'mac_address is required' });
        return;
      }

      // Normalize MAC → device_id (strip colons/dashes, uppercase)
      const deviceId = mac_address.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
      if (deviceId.length !== 12) {
        res.status(400).json({ error: 'Invalid mac_address format' });
        return;
      }

      // Idempotent: return existing creds if device already registered
      const existing = await getDeviceByDeviceId(deviceId);
      if (existing) {
        res.json({ user_id: existing.user_id, license_key: existing.license_key });
        return;
      }

      // Auto-provision a system user that will own unclaimed devices
      const systemUser = await upsertUser('system@esp32-display.internal', 'System');

      const licenseKey = generateLicenseKey();
      const name = (device_name ?? 'ESP32 Display').trim().slice(0, 64) || 'ESP32 Display';
      const device = await createDevice(systemUser.id, deviceId, name, licenseKey);

      res.status(201).json({ user_id: device.user_id, license_key: device.license_key });
    } catch (err) {
      next(err);
    }
  }
);

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

/** GET /api/devices/:userId/firmware/latest */
router.get(
  '/:userId/firmware/latest',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { userId } = req.params as { userId: string };
      const licenseKey = (req.header('X-License-Key') ?? req.query.licenseKey) as string | undefined;

      if (!licenseKey) {
        res.status(401).json({ error: 'Missing X-License-Key header' });
        return;
      }

      const device = await getDeviceByLicenseKey(licenseKey);
      if (!device) {
        res.status(401).json({ error: 'Invalid license key' });
        return;
      }

      if (device.user_id !== userId) {
        res.status(403).json({ error: 'License key does not belong to this user' });
        return;
      }

      const latest = await getLatestFirmwareVersion(userId);
      if (!latest || latest.version === device.firmware_version) {
        res.status(204).end();
        return;
      }

      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const downloadUrl = `${baseUrl}/api/devices/${encodeURIComponent(userId)}/firmware/download?version=${encodeURIComponent(latest.version)}`;

      res.json({
        version: latest.version,
        url: downloadUrl,
        checksum: latest.checksum ?? '',
        releaseNotes: latest.release_notes ?? '',
      });
    } catch (err) {
      next(err);
    }
  }
);

/** GET /api/devices/:userId/firmware/download */
router.get(
  '/:userId/firmware/download',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { userId } = req.params as { userId: string };
      const licenseKey = (req.header('X-License-Key') ?? req.query.licenseKey) as string | undefined;
      const version = (req.query.version as string) ?? undefined;

      if (!licenseKey) {
        res.status(401).json({ error: 'Missing X-License-Key header' });
        return;
      }

      const device = await getDeviceByLicenseKey(licenseKey);
      if (!device) {
        res.status(401).json({ error: 'Invalid license key' });
        return;
      }

      if (device.user_id !== userId) {
        res.status(403).json({ error: 'License key does not belong to this user' });
        return;
      }

      const firmware = version
        ? await getFirmwareVersionByUserAndVersion(userId, version)
        : await getLatestFirmwareVersion(userId);

      if (!firmware) {
        res.status(404).json({ error: 'Firmware version not found' });
        return;
      }

      const firmwareDir = process.env.FIRMWARE_BINARY_DIR
        ? path.resolve(process.env.FIRMWARE_BINARY_DIR)
        : path.resolve(__dirname, '..', '..', '..', 'firmware', 'build');
      const requestedPath = firmware.download_path.replace(/^([./\\]+)+/, '');
      const filePath = path.resolve(firmwareDir, requestedPath);

      if (!filePath.startsWith(firmwareDir) || !fs.existsSync(filePath)) {
        res.status(404).json({ error: 'Firmware binary not found' });
        return;
      }

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(firmware.download_path)}"`);
      res.sendFile(filePath);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
