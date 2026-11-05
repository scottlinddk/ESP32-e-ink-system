/**
 * Push-integration tokens: custom webhook sensor rows and AI usage reports.
 * Both tables hold one row per user and store only the SHA-256 of the token.
 * Writes that publish data are filtered on the current token hash, so a token
 * revoked or rotated after the lookup cannot publish.
 */
import { isUuid } from '../errors';
import { query, type Queryable } from '../pool';

const pool: Queryable = { query };

// -------------------------------------------------------- custom webhooks

export interface WebhookRow {
  user_id: string;
  token_hash: string | null;
  token_created_at: string | null;
  rows: unknown[];
  observed_at: string | null;
  received_at: string | null;
}

export async function findWebhookRow(userId: string, db: Queryable = pool): Promise<WebhookRow | null> {
  if (!isUuid(userId)) return null;
  const { rows } = await db.query<WebhookRow>(
    'SELECT user_id, token_hash, token_created_at, rows, observed_at, received_at FROM custom_webhooks WHERE user_id = $1',
    [userId],
  );
  return rows[0] ?? null;
}

/** New token: stored data from the previous token is discarded. */
export async function replaceWebhookToken(userId: string, hash: string, db: Queryable = pool): Promise<void> {
  await db.query(
    `INSERT INTO custom_webhooks (user_id, token_hash, token_created_at, rows, observed_at, received_at)
     VALUES ($1, $2, now(), '[]'::jsonb, NULL, NULL)
     ON CONFLICT (user_id) DO UPDATE SET
       token_hash = EXCLUDED.token_hash, token_created_at = EXCLUDED.token_created_at,
       rows = EXCLUDED.rows, observed_at = NULL, received_at = NULL`,
    [userId, hash],
  );
}

export async function clearWebhookToken(userId: string, db: Queryable = pool): Promise<void> {
  if (!isUuid(userId)) return;
  await db.query(
    `UPDATE custom_webhooks
        SET token_hash = NULL, token_created_at = NULL, rows = '[]'::jsonb, observed_at = NULL, received_at = NULL
      WHERE user_id = $1`,
    [userId],
  );
}

export async function findWebhookOwnerByHash(hash: string, db: Queryable = pool): Promise<string | null> {
  const { rows } = await db.query<{ user_id: string }>('SELECT user_id FROM custom_webhooks WHERE token_hash = $1', [hash]);
  return rows[0]?.user_id ?? null;
}

/** Stores a payload only while `hash` is still the user's token. Returns false otherwise. */
export async function writeWebhookPayload(
  userId: string, hash: string, payload: { rows: unknown[]; observed_at: string; received_at: string }, db: Queryable = pool,
): Promise<boolean> {
  if (!isUuid(userId)) return false;
  const { rowCount } = await db.query(
    `UPDATE custom_webhooks SET rows = $3::jsonb, observed_at = $4, received_at = $5
      WHERE user_id = $1 AND token_hash = $2`,
    [userId, hash, JSON.stringify(payload.rows), payload.observed_at, payload.received_at],
  );
  return (rowCount ?? 0) > 0;
}

// --------------------------------------------------------- AI usage reports

export interface AiUsageRow {
  user_id: string;
  token_hash: string | null;
  token_created_at: string | null;
  providers: unknown;
  received_at: string | null;
}
const AI_FIELDS = 'user_id, token_hash, token_created_at, providers, received_at';

export async function findAiUsageRow(userId: string, db: Queryable = pool): Promise<AiUsageRow | null> {
  if (!isUuid(userId)) return null;
  const { rows } = await db.query<AiUsageRow>(`SELECT ${AI_FIELDS} FROM ai_usage_reports WHERE user_id = $1`, [userId]);
  return rows[0] ?? null;
}

export async function replaceAiUsageToken(userId: string, hash: string, db: Queryable = pool): Promise<void> {
  await db.query(
    `INSERT INTO ai_usage_reports (user_id, token_hash, token_created_at, providers, received_at)
     VALUES ($1, $2, now(), '{}'::jsonb, NULL)
     ON CONFLICT (user_id) DO UPDATE SET
       token_hash = EXCLUDED.token_hash, token_created_at = EXCLUDED.token_created_at,
       providers = EXCLUDED.providers, received_at = NULL`,
    [userId, hash],
  );
}

export async function clearAiUsageToken(userId: string, db: Queryable = pool): Promise<void> {
  if (!isUuid(userId)) return;
  await db.query(
    `UPDATE ai_usage_reports
        SET token_hash = NULL, token_created_at = NULL, providers = '{}'::jsonb, received_at = NULL
      WHERE user_id = $1`,
    [userId],
  );
}

export async function findAiUsageRowByHash(hash: string, db: Queryable = pool): Promise<AiUsageRow | null> {
  const { rows } = await db.query<AiUsageRow>(`SELECT ${AI_FIELDS} FROM ai_usage_reports WHERE token_hash = $1`, [hash]);
  return rows[0] ?? null;
}

/** Stores a merged snapshot only while `hash` is still the user's token. Returns false otherwise. */
export async function writeAiUsageProviders(userId: string, hash: string, providers: unknown, receivedAt: string, db: Queryable = pool): Promise<boolean> {
  if (!isUuid(userId)) return false;
  const { rowCount } = await db.query(
    'UPDATE ai_usage_reports SET providers = $3::jsonb, received_at = $4 WHERE user_id = $1 AND token_hash = $2',
    [userId, hash, JSON.stringify(providers), receivedAt],
  );
  return (rowCount ?? 0) > 0;
}
