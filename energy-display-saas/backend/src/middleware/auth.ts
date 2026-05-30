import { Request, Response, NextFunction } from 'express';
import { createClerkClient } from '@clerk/backend';

let clerkClient: ReturnType<typeof createClerkClient> | null = null;

function getClerkClient(): ReturnType<typeof createClerkClient> {
  if (!clerkClient) {
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) {
      throw new Error('CLERK_SECRET_KEY environment variable is not set');
    }
    clerkClient = createClerkClient({ secretKey });
  }
  return clerkClient;
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const clerk = getClerkClient();
    const verifiedToken = await clerk.verifyToken(token);

    req.clerkUserId = verifiedToken.sub;
    next();
  } catch (err) {
    console.error('Auth verification failed:', err);
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    next();
    return;
  }

  const token = authHeader.slice(7);

  try {
    const clerk = getClerkClient();
    const verifiedToken = await clerk.verifyToken(token);
    req.clerkUserId = verifiedToken.sub;
  } catch {
    // Silently ignore invalid tokens in optional auth
  }

  next();
}
