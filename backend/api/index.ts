import app from '../src/app';

// Fail fast on cold start if required secrets are absent.
// (backend/src/index.ts startup checks only run in standalone mode, not on Vercel.)
const required = ['CLERK_SECRET_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

export default app;
