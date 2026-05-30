/**
 * Auth utilities — thin wrappers used by the API layer
 * The actual auth state comes from @clerk/clerk-react hooks
 */

/**
 * Returns the auth token for API calls.
 * Called from api.ts which receives the token from the hook layer.
 */
export function buildAuthHeaders(token: string | null): Record<string, string> {
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

/**
 * Checks whether an HTTP response indicates an auth failure
 */
export function isAuthError(status: number): boolean {
  return status === 401 || status === 403;
}
