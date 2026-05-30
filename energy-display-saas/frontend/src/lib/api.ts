import { buildAuthHeaders } from './auth';
import { UserPreferences, DisplayData, MaskedApiKey, User } from '../types';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';

class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  path: string,
  options: RequestInit & { token?: string | null } = {}
): Promise<T> {
  const { token, ...init } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? buildAuthHeaders(token) : {}),
    ...(init.headers as Record<string, string> | undefined),
  };

  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      message = body.error ?? message;
    } catch {
      // ignore JSON parse errors
    }
    throw new ApiError(response.status, message);
  }

  return response.json() as Promise<T>;
}

// ============================================================
// Auth
// ============================================================

export async function loginUser(token: string): Promise<{ user: User }> {
  return request<{ user: User }>('/api/auth/login', {
    method: 'POST',
    token,
  });
}

export async function getAuthUser(token: string): Promise<{ user: User }> {
  return request<{ user: User }>('/api/auth/user', { token });
}

// ============================================================
// Preferences
// ============================================================

export async function getPreferences(
  token: string
): Promise<{ preferences: UserPreferences }> {
  return request<{ preferences: UserPreferences }>('/api/preferences', { token });
}

export async function savePreferences(
  token: string,
  prefs: Partial<UserPreferences>
): Promise<{ preferences: UserPreferences }> {
  return request<{ preferences: UserPreferences }>('/api/preferences', {
    method: 'POST',
    token,
    body: JSON.stringify(prefs),
  });
}

// ============================================================
// API Keys
// ============================================================

export async function getApiKeys(token: string): Promise<{ api_keys: MaskedApiKey[] }> {
  return request<{ api_keys: MaskedApiKey[] }>('/api/preferences/api-keys', { token });
}

export async function saveApiKey(
  token: string,
  provider: string,
  api_key: string
): Promise<{ api_key: MaskedApiKey }> {
  return request<{ api_key: MaskedApiKey }>('/api/preferences/api-keys', {
    method: 'POST',
    token,
    body: JSON.stringify({ provider, api_key }),
  });
}

// ============================================================
// Display Data / Preview
// ============================================================

export async function getPreviewData(token: string): Promise<DisplayData> {
  return request<DisplayData>('/api/preview', { token });
}

// ============================================================
// Health
// ============================================================

export async function getHealth(): Promise<{
  status: string;
  timestamp: string;
  uptime: number;
}> {
  return request('/health');
}

export { ApiError };
