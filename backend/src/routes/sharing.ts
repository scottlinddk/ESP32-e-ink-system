import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { getOrCreateUserFromClerk } from './preferences-helpers';
import {
  acceptConnection, acceptItem, dismissItem, listConnections, listDeviceShares, listItems, parseUuid,
  removeConnection, requestConnection, revokeDeviceShare, sendItem, shareDevice,
} from '../services/sharing';

type Handler = (me: string, req: Request, res: Response) => Promise<void>;
/** Resolves the signed-in account once, and turns every failure into the shared error handler. */
const handle = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    await fn(await getOrCreateUserFromClerk(req.clerkUserId!), req, res);
  } catch (error) { next(error); }
};

export const connectionsRouter = Router();
connectionsRouter.use(requireAuth);
connectionsRouter.get('/', handle(async (me, _req, res) => { res.json({ connections: await listConnections(me) }); }));
connectionsRouter.post('/', handle(async (me, req, res) => {
  await requestConnection(me, (req.body as { email?: unknown } | undefined)?.email);
  // Identical for unknown addresses, so the endpoint cannot be used to find accounts.
  res.status(202).json({ status: 'sent' });
}));
connectionsRouter.post('/:id/accept', handle(async (me, req, res) => {
  await acceptConnection(me, parseUuid(req.params.id, 'id'));
  res.json({ success: true });
}));
connectionsRouter.delete('/:id', handle(async (me, req, res) => {
  await removeConnection(me, parseUuid(req.params.id, 'id'));
  res.json({ success: true });
}));

/** Mounted under /devices: collaborators of one device. */
export const deviceSharesRouter = Router();
deviceSharesRouter.use(requireAuth);
deviceSharesRouter.get('/:id/shares', handle(async (me, req, res) => {
  res.json({ shares: await listDeviceShares(me, parseUuid(req.params.id, 'id')) });
}));
deviceSharesRouter.put('/:id/shares', handle(async (me, req, res) => {
  const body = (req.body ?? {}) as { collaborator_id?: unknown; role?: unknown };
  await shareDevice(me, parseUuid(req.params.id, 'id'), parseUuid(body.collaborator_id, 'collaborator_id'), body.role);
  res.json({ success: true });
}));
deviceSharesRouter.delete('/:id/shares/:collaboratorId', handle(async (me, req, res) => {
  // "me" lets a collaborator leave without knowing their own database ID.
  const collaborator = req.params.collaboratorId === 'me' ? me : parseUuid(req.params.collaboratorId, 'collaboratorId');
  await revokeDeviceShare(me, parseUuid(req.params.id, 'id'), collaborator);
  res.json({ success: true });
}));

export const sharedItemsRouter = Router();
sharedItemsRouter.use(requireAuth);
sharedItemsRouter.get('/', handle(async (me, req, res) => {
  res.json({ items: await listItems(me, req.query.box === 'sent' ? 'sent' : 'inbox') });
}));
sharedItemsRouter.post('/', handle(async (me, req, res) => {
  const body = (req.body ?? {}) as { recipient_id: unknown; source: unknown; name?: unknown };
  const { item, dropped } = await sendItem(me, body);
  res.status(201).json({ item, dropped });
}));
sharedItemsRouter.post('/:id/accept', handle(async (me, req, res) => {
  await acceptItem(me, parseUuid(req.params.id, 'id'), (req.body ?? {}) as { device_id: unknown; page_id?: unknown });
  res.json({ success: true });
}));
sharedItemsRouter.delete('/:id', handle(async (me, req, res) => {
  await dismissItem(me, parseUuid(req.params.id, 'id'));
  res.json({ success: true });
}));
