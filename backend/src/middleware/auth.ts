import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '@clerk/backend';

function getVerifyOptions() {
  const jwtKey = process.env.CLERK_JWT_KEY;
  const secretKey = process.env.CLERK_SECRET_KEY;

  if (!jwtKey && !secretKey) {
    throw new Error('Either CLERK_JWT_KEY or CLERK_SECRET_KEY environment variable must be set');
  }

  const authorizedParties = process.env.AUTHORIZED_PARTIES
    ? process.env.AUTHORIZED_PARTIES.split(',').map((s) => s.trim())
    : process.env.FRONTEND_URL
      ? [process.env.FRONTEND_URL]
      : [];

  return {
    // jwtKey enables local (offline) verification — no network call to Clerk.
    // Preferred in serverless environments where JWKS fetches may fail.
    // Set CLERK_JWT_KEY in Vercel to the RSA public key from Clerk Dashboard → API Keys.
    ...(jwtKey ? { jwtKey } : { secretKey: secretKey! }),
    clockSkewInMs: 5000,
    // Prevents token misuse across origins (CSRF / subdomain cookie leaking).
    // Set AUTHORIZED_PARTIES for multiple origins, or FRONTEND_URL for a single origin.
    ...(authorizedParties.length > 0 ? { authorizedParties } : {}),
  };
}

async function verifyClerkToken(token: string) {
  return verifyToken(token, getVerifyOptions());
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
    const verifiedToken = await verifyClerkToken(token);
    req.clerkUserId = verifiedToken.sub;
    next();
  } catch (err) {
    const reason = (err as Record<string, unknown>)?.reason as string | undefined;
    const message = err instanceof Error ? err.message : String(err);
    console.error('Auth verification failed:', { reason, message });
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
    const verifiedToken = await verifyClerkToken(token);
    req.clerkUserId = verifiedToken.sub;
  } catch {
    // Silently ignore invalid tokens in optional auth
  }

  next();
}
