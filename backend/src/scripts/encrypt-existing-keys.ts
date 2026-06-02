/**
 * One-time migration: encrypts any plaintext rows in the api_keys table.
 *
 * Run once before deploying the backend with encryption enabled:
 *   npx ts-node src/scripts/encrypt-existing-keys.ts
 *
 * Safe to re-run — already-encrypted rows are skipped.
 */
import 'dotenv/config';
import { getSupabaseClient } from '../services/database';
import { encrypt, isEncrypted } from '../utils/crypto';

async function main() {
  if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length !== 64) {
    console.error('ENCRYPTION_KEY must be set as a 64-character hex string');
    process.exit(1);
  }

  const db = getSupabaseClient();

  const { data: rows, error } = await db.from('api_keys').select('id, api_key, provider, user_id');
  if (error) {
    console.error('Failed to fetch api_keys:', error.message);
    process.exit(1);
  }

  const plaintext = (rows ?? []).filter((r) => !isEncrypted(r.api_key));
  console.log(`Found ${rows?.length ?? 0} rows total, ${plaintext.length} need encryption.`);

  let succeeded = 0;
  let failed = 0;

  for (const row of plaintext) {
    const { error: updateError } = await db
      .from('api_keys')
      .update({ api_key: encrypt(row.api_key) })
      .eq('id', row.id);

    if (updateError) {
      console.error(`  FAIL  id=${row.id} provider=${row.provider}: ${updateError.message}`);
      failed++;
    } else {
      console.log(`  OK    id=${row.id} provider=${row.provider}`);
      succeeded++;
    }
  }

  console.log(`\nDone. Encrypted: ${succeeded}, Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
