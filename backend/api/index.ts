import app from '../src/app';

// Fail fast on cold start if required secrets are absent.
// (backend/src/index.ts startup checks only run in standalone mode, not on Vercel.)
const required = ['CLERK_SECRET_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ENCRYPTION_KEY'];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}
// ENCRYPTION_KEY must be a 64-character hex string (32 bytes for AES-256-GCM).
if (process.env.ENCRYPTION_KEY!.length !== 64) {
  throw new Error('ENCRYPTION_KEY must be a 64-character hex string (generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))")');
}

export default app;
