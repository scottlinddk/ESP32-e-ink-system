/** Keep form validation small; the server validates and normalizes the address and token. */
export function familyMealsCredentialsForSave(fields: Record<string, string>): Record<string, string> {
  const token = fields.token?.trim() ?? '';
  if (!/^fm_[A-Za-z0-9_-]{20,100}$/.test(token)) throw new Error('token');
  const baseUrl = fields.baseUrl?.trim() ?? '';
  let url: URL;
  try { url = new URL(baseUrl); } catch { throw new Error('url'); }
  if (baseUrl.length > 2048 || url.protocol !== 'https:' || url.username || url.password) throw new Error('url');
  return { baseUrl, token };
}
