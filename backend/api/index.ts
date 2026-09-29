import express from 'express';
import backendApp from '../src/app';

// Fail fast on cold start if required secrets are absent.
// (backend/src/index.ts startup checks only run in standalone mode, not on Vercel.)
const required = ['CLERK_SECRET_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}
if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 64) {
  throw new Error('ENCRYPTION_KEY must be a 64-character hex string');
}

// The app mounts its routes without a prefix (/health, /preferences, ...), but
// Vercel forwards the public /api/* path to this function. Serve both forms so
// the deployment does not depend on the platform stripping the prefix. The
// wrapper keeps the conventional `app` name in case entrypoint detection
// relies on it.
const app = express();
app.use('/api', backendApp);
app.use(backendApp);

export default app;
