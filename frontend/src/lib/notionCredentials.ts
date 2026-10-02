/** Keep form validation small; the server validates and normalizes Notion IDs. */
export function notionCredentialsForSave(fields: Record<string, string>): Record<string, string> {
  const token = fields.token?.trim() ?? '';
  if (token.length > 512 || !/^(ntn_|secret_)[A-Za-z0-9_-]+$/.test(token)) throw new Error('token');
  const databaseId = fields.databaseId?.trim() ?? '';
  if (!databaseId || databaseId.length > 2048) throw new Error('database');
  const dataSourceId = fields.dataSourceId?.trim() ?? '';
  if (dataSourceId && !/^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(dataSourceId)) throw new Error('source');
  const result: Record<string, string> = { token, databaseId };
  if (dataSourceId) result.dataSourceId = dataSourceId;
  for (const key of ['statusProperty', 'filterStatus']) {
    const value = fields[key]?.trim() ?? '';
    if (value.length > 100 || /[\x00-\x1f\x7f]/.test(value)) throw new Error('property');
    if (value) result[key] = value;
  }
  if (result.filterStatus && !result.statusProperty) throw new Error('filter');
  return result;
}
