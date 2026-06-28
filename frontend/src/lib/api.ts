import { buildAuthHeaders } from './auth';
import { UserPreferences, DisplayData, MaskedApiKey, User, Device, FirmwareVersion, DisplayLayout } from '../types';

// In production (Vercel), use relative paths so requests always go to the same
// origin and Vercel routes /api/* to the Express backend service.
// VITE_API_BASE_URL is honoured in development so the Vite proxy can target it.
const BASE_URL = import.meta.env.PROD
  ? ''
  : (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001');

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

  if (response.status === 204) return undefined as T;
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

export async function saveLayout(
  token: string,
  layout: DisplayLayout
): Promise<void> {
  await savePreferences(token, { layout });
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

export async function deleteApiKey(token: string, provider: string): Promise<void> {
  await request<void>(`/api/preferences/api-keys/${provider}`, {
    method: 'DELETE',
    token,
  });
}

export async function saveEvCredentials(
  token: string,
  provider: string,
  credentials: Record<string, string>
): Promise<{ provider: string; configured: boolean }> {
  return request<{ provider: string; configured: boolean }>(
    '/api/preferences/ev-credentials',
    {
      method: 'POST',
      token,
      body: JSON.stringify({ provider, credentials }),
    }
  );
}

export async function getEvCredentialStatus(
  token: string,
  provider: string
): Promise<{ provider: string; configured: boolean }> {
  return request<{ provider: string; configured: boolean }>(
    `/api/preferences/ev-credentials/${provider}`,
    { token }
  );
}

export async function deleteEvCredentials(token: string, provider: string): Promise<void> {
  await request<void>(`/api/preferences/api-keys/${provider}`, {
    method: 'DELETE',
    token,
  });
}

// ============================================================
// Devices
// ============================================================

export async function getDevices(token: string): Promise<{ devices: Device[] }> {
  return request<{ devices: Device[] }>('/api/devices', { token });
}

export async function addDevice(
  token: string,
  ble_name: string,
  device_name: string
): Promise<{ device: Device }> {
  return request<{ device: Device }>('/api/devices', {
    method: 'POST',
    token,
    body: JSON.stringify({ device_id: ble_name, ble_name, device_name }),
  });
}

export async function getFirmwareVersions(
  token: string
): Promise<{ firmware_versions: FirmwareVersion[] }> {
  return request<{ firmware_versions: FirmwareVersion[] }>('/api/firmware', { token });
}

export async function createFirmwareVersion(
  token: string,
  payload: {
    version: string;
    download_path: string;
    checksum?: string;
    release_notes?: string;
  }
): Promise<{ firmware_version: FirmwareVersion }> {
  return request<{ firmware_version: FirmwareVersion }>('/api/firmware', {
    method: 'POST',
    token,
    body: JSON.stringify(payload),
  });
}

export async function getFirmwareManifest(
  token: string,
  firmwareId: string
): Promise<object> {
  return request<object>(`/api/firmware/${firmwareId}/manifest`, { token });
}

export async function updateDevice(
  token: string,
  id: string,
  device_name: string
): Promise<{ device: Device }> {
  return request<{ device: Device }>(`/api/devices/${id}`, {
    method: 'PUT',
    token,
    body: JSON.stringify({ device_name }),
  });
}

export async function removeDevice(token: string, id: string): Promise<void> {
  await request<void>(`/api/devices/${id}`, { method: 'DELETE', token });
}

// ============================================================
// Display Data / Preview
// ============================================================

export async function getPreviewData(token: string): Promise<DisplayData> {
  return request<DisplayData>('/api/preview', { token });
}

/**
 * Fetches the server-rendered 1-bit BMP for the authenticated user and returns
 * an object URL that can be set directly as an <img> src.
 * Caller is responsible for calling URL.revokeObjectURL() when done.
 */
export async function fetchPreviewBmp(token: string): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/image/preview`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

/**
 * Fetches raw 1-bit pixel bytes (no BMP header) for OpenDisplay BLE direct write.
 * 32 bytes/row × 122 rows = 3,904 bytes.
 */
export async function fetchPreviewRaw(token: string): Promise<Uint8Array> {
  const response = await fetch(`${BASE_URL}/api/image/preview/raw`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
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
