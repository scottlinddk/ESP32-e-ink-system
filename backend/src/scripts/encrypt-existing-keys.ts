/**
 * One-time migration: encrypts any plaintext rows in the api_keys table.
 *
 * Run once before deploying the backend with encryption enabled:
 *   DATABASE_URL=... ENCRYPTION_KEY=... npx ts-node src/scripts/encrypt-existing-keys.ts
 *
 * Needs UPDATE on api_keys: the application role has it. Not needed for data migrated from the
 * current deployment, whose rows are already encrypted with the same ENCRYPTION_KEY.
 *
 * Safe to re-run — already-encrypted rows are skipped.
 */
import 'dotenv/config';
import { listAllApiKeyRows, updateApiKeyValue } from '../db/repositories/accounts';
import { closePool } from '../db/pool';
import { encrypt, isEncrypted } from '../utils/crypto';

async function main() {
  if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 64) {
    console.error('ENCRYPTION_KEY must be set as a 64-character hex string');
    process.exit(1);
  }

  let rows;
  try {
    rows = await listAllApiKeyRows();
  } catch (error) {
    console.error('Failed to fetch api_keys:', error instanceof Error ? error.message : 'unknown error');
    process.exit(1);
  }

  const plaintext = rows.filter((r) => !isEncrypted(r.api_key));
  console.log(`Found ${rows.length} rows total, ${plaintext.length} need encryption.`);

  let succeeded = 0;
  let failed = 0;

  for (const row of plaintext) {
    try {
      await updateApiKeyValue(row.id, encrypt(row.api_key));
      console.log(`  OK    id=${row.id} provider=${row.provider}`);
      succeeded++;
    } catch (error) {
      console.error(`  FAIL  id=${row.id} provider=${row.provider}: ${error instanceof Error ? error.message : 'unknown error'}`);
      failed++;
    }
  }

  console.log(`\nDone. Encrypted: ${succeeded}, Failed: ${failed}`);
  await closePool();
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
