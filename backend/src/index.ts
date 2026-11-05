import 'dotenv/config';
import app from './app';
import { logger } from './lib/logger';
import { loadDatabaseConfig } from './db/config';
import { closePool } from './db/pool';

// Fail fast if required secrets are absent
const requiredEnv: string[] = ['CLERK_SECRET_KEY'];
for (const key of requiredEnv) {
  if (!process.env[key]) throw new Error(`${key} environment variable is required`);
}
// Validates DATABASE_URL, DATABASE_SSL and the pool settings. The message never contains their values.
loadDatabaseConfig();
if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 64) {
  throw new Error('ENCRYPTION_KEY must be a 64-character hex string');
}

const PORT = parseInt(process.env.PORT ?? '3001', 10);

const server = app.listen(PORT, () => {
  logger.info({ port: PORT, env: process.env.NODE_ENV ?? 'development' }, 'ESP32 Display API started');
});

// Graceful shutdown: stop accepting connections, let in-flight requests finish, then
// drain the database pool. A hard deadline keeps a stuck request from blocking a redeploy.
let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received — shutting down gracefully`);
  const deadline = setTimeout(() => {
    logger.error('Shutdown timed out; exiting');
    process.exit(1);
  }, 8_000);
  deadline.unref();
  server.close(async () => {
    logger.info('Server closed');
    await closePool(5_000);
    process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default server;
