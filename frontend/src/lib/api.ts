import { DisplayProfile, frameMetadata } from './displayProfile';
import { buildAuthHeaders } from './auth';
import { readPreviewMetadata, type PreviewImage } from './previewMetadata';
import { UserPreferences, DisplayData, MaskedApiKey, User, Device, FirmwareVersion, DisplayLayout, CustomWebhookStatus, AiUsageStatus, AiUsageData, AiUsageProvider, WeatherData, EnergyPrice, EnergyPriceSettings, TickerSearchResult } from '../types';

// Both Vercel and Vite route /api/* to the backend and strip the /api prefix.
// VITE_API_BASE_URL configures Vite's proxy target, not a browser URL.
const BASE_URL = '';

class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    /** Configured codes the server could not price; only set for a tariff diagnostic. */
    public readonly missingCodes?: string[]
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
    let code: string | undefined;
    let missingCodes: string[] | undefined;
    try {
      const body = (await response.json()) as { error?: unknown; code?: unknown; missingCodes?: unknown };
      if (typeof body.error === 'string') message = body.error;
      if (typeof body.code === 'string') code = body.code;
      if (Array.isArray(body.missingCodes) && body.missingCodes.every((item) => typeof item === 'string')) {
        missingCodes = body.missingCodes;
      }
    } catch {
      // ignore JSON parse errors
    }
    throw new ApiError(response.status, message, code, missingCodes);
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
  token: string,
  deviceId?: string,
): Promise<{ preferences: UserPreferences; inherited?: boolean }> {
  return request(deviceId ? `/api/devices/${encodeURIComponent(deviceId)}/display` : '/api/preferences', { token });
}

export async function savePreferences(
  token: string,
  prefs: Partial<UserPreferences>,
  deviceId?: string,
): Promise<{ preferences: UserPreferences }> {
  return request<{ preferences: UserPreferences }>(deviceId ? `/api/devices/${encodeURIComponent(deviceId)}/display` : '/api/preferences', {
    method: deviceId ? 'PUT' : 'POST',
    token,
    body: JSON.stringify(prefs),
  });
}

export async function saveLayout(
  token: string,
  layout: DisplayLayout,
  deviceId?: string,
): Promise<void> {
  await savePreferences(token, { layout }, deviceId);
}

export function testWeather(token: string, location: string, signal?: AbortSignal): Promise<{ weather: WeatherData }> {
  return request('/api/preferences/weather/test', { token, method: 'POST', body: JSON.stringify({ location }), signal });
}

/** Prices draft settings without saving them. */
export function testEnergyPrice(token: string, location: string, settings: EnergyPriceSettings, signal?: AbortSignal): Promise<{ price: EnergyPrice }> {
  return request('/api/preferences/energy-price/test', { token, method: 'POST', body: JSON.stringify({ location, settings }), signal });
}

export async function getCalendarCredentialStatus(token: string): Promise<{ configured: boolean }> {
  return request('/api/preferences/calendar-credentials', { token });
}

export async function saveCalendarCredential(token: string, url: string): Promise<{ configured: boolean }> {
  return request('/api/preferences/calendar-credentials', { method: 'POST', token, body: JSON.stringify({ url }) });
}

export async function deleteCalendarCredential(token: string): Promise<{ configured: boolean }> {
  return request('/api/preferences/calendar-credentials', { method: 'DELETE', token });
}

export interface DisplayTemplate {
  format: 'esp32-eink-template';
  version: 1;
  settings: Partial<UserPreferences> & {
    display_profile?: { width: number; height: number; rotation: 0 | 90 | 180 | 270; colorMode: 'bw' };
    display_schedule?: {
      enabled: boolean; timezone: string;
      pages: Array<{ id: string; name: string; duration_seconds: number; layout: DisplayLayout }>;
      quiet_hours: { enabled: boolean; start: string; end: string };
    } | null;
  };
}
export interface StarterTemplate { id: string; name: string; template: DisplayTemplate }

export function exportDisplayTemplate(token: string): Promise<DisplayTemplate> {
  return request('/api/preferences/templates/export', { token });
}
export function validateDisplayTemplate(token: string, value: unknown, signal?: AbortSignal): Promise<{ template: DisplayTemplate }> {
  return request('/api/preferences/templates/validate', { token, method: 'POST', body: JSON.stringify(value), signal });
}
export function importDisplayTemplate(token: string, template: DisplayTemplate): Promise<{ preferences: UserPreferences }> {
  return request('/api/preferences/templates/import', { token, method: 'POST', body: JSON.stringify(template) });
}
export function getStarterTemplates(token: string): Promise<{ templates: StarterTemplate[] }> {
  return request('/api/preferences/templates/starters', { token });
}

// ============================================================
// Stock tickers
// ============================================================

export function searchTickers(token: string, query: string, region: 'any' | 'dk', signal?: AbortSignal): Promise<{ results: TickerSearchResult[] }> {
  return request(`/api/tickers/search?q=${encodeURIComponent(query)}&region=${region}`, { token, signal });
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

export interface DeviceList {
  devices: Device[];
  /** The device the dashboard opens by default; null when unset. */
  default_device_id?: string | null;
}

export async function getDevices(token: string): Promise<DeviceList> {
  return request<DeviceList>('/api/devices', { token });
}

/** Sets the dashboard's default device, or clears it with null. */
export async function setDefaultDevice(token: string, id: string | null): Promise<{ default_device_id: string | null }> {
  return request('/api/devices/default', { token, method: 'PUT', body: JSON.stringify({ id }) });
}

export interface DeviceDeliveryStatus {
  configured: boolean; rotatedAt: string | null; lastSeenAt: string | null;
  firmwareVersion: string | null; batteryPercent: number | null; rssi: number | null; lastAppliedHash: string | null;
  refreshRequestId: string | null; refreshRequestedAt: string | null; refreshAppliedAt: string | null;
  /** Absent from backends without migration 020; treat as off. */
  instantUpdates?: boolean;
}
export async function getDeviceDeliveryStatus(token: string, id: string, signal?: AbortSignal): Promise<DeviceDeliveryStatus> {
  const result = await request<DeviceDeliveryStatus>(`/api/devices/${encodeURIComponent(id)}/delivery`, { token, signal });
  signal?.throwIfAborted();
  return result;
}
export async function requestDeviceRefresh(token: string, id: string, signal?: AbortSignal): Promise<DeviceDeliveryStatus> {
  const result = await request<DeviceDeliveryStatus>(`/api/devices/${encodeURIComponent(id)}/refresh`, { method: 'POST', token, signal });
  signal?.throwIfAborted();
  return result;
}
export async function setDeviceInstantUpdates(token: string, id: string, enabled: boolean, signal?: AbortSignal): Promise<DeviceDeliveryStatus> {
  const result = await request<DeviceDeliveryStatus>(`/api/devices/${encodeURIComponent(id)}/delivery/instant`, {
    method: 'PUT', token, signal, body: JSON.stringify({ enabled }),
  });
  signal?.throwIfAborted();
  return result;
}
export async function createDeviceDeliveryToken(token: string, id: string): Promise<{ token: string }> {
  return request(`/api/devices/${encodeURIComponent(id)}/delivery/token`, { method: 'POST', token });
}
export async function revokeDeviceDeliveryToken(token: string, id: string): Promise<{ configured: boolean }> {
  return request(`/api/devices/${encodeURIComponent(id)}/delivery/token`, { method: 'DELETE', token });
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

export async function getPreviewData(token: string, deviceId?: string): Promise<DisplayData> {
  return request<DisplayData>(`/api/preview${deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : ''}`, { token });
}

/** Query for the saved preview routes; `pageId` selects one slideshow page instead of the scheduled one. */
function savedPreviewQuery(deviceId?: string, pageId?: string): string {
  const params = new URLSearchParams();
  if (deviceId) params.set('device_id', deviceId);
  if (pageId !== undefined) params.set('page_id', pageId);
  const query = params.toString();
  return query ? `?${query}` : '';
}

/**
 * Fetches the server-rendered 1-bit BMP for the authenticated user.
 * The view creates and releases its own object URL from the returned Blob.
 */
export async function fetchPreviewBmp(token: string, signal?: AbortSignal, deviceId?: string, pageId?: string): Promise<PreviewImage> {
  const response = await fetch(`${BASE_URL}/api/image/preview${savedPreviewQuery(deviceId, pageId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  try {
    signal?.throwIfAborted();
    const metadata = readPreviewMetadata(response.headers, deviceId, false, pageId);
    const blob = await response.blob();
    signal?.throwIfAborted();
    return { blob, metadata };
  } catch (error) { void response.body?.cancel().catch(() => {}); throw error; }
}

/** Render a layout draft using the signed-in user's saved source settings. */
export async function fetchDraftPreviewBmp(token: string, layout: DisplayLayout, signal?: AbortSignal, deviceId?: string): Promise<Blob> {
  const response = await fetch(`${BASE_URL}/api/image/preview/draft`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ layout, ...(deviceId ? { device_id: deviceId } : {}) }),
    signal,
  });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try { message = (await response.json()).error ?? message; } catch { /* Keep HTTP status. */ }
    throw new ApiError(response.status, message);
  }
  try {
    signal?.throwIfAborted();
    readPreviewMetadata(response.headers, deviceId, true);
    const blob = await response.blob();
    signal?.throwIfAborted();
    return blob;
  } catch (error) { void response.body?.cancel().catch(() => {}); throw error; }
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

export function getCustomWebhookStatus(token: string): Promise<CustomWebhookStatus> {
  return request('/api/custom-webhook', { token });
}

export function createCustomWebhookToken(token: string): Promise<{ token: string }> {
  return request('/api/custom-webhook/token', { token, method: 'POST', body: '{}' });
}

export function deleteCustomWebhookToken(token: string): Promise<void> {
  return request('/api/custom-webhook/token', { token, method: 'DELETE' });
}

export function getAiUsageStatus(token: string): Promise<AiUsageStatus> {
  return request('/api/ai-usage', { token });
}

export function createAiUsageToken(token: string): Promise<{ token: string }> {
  return request('/api/ai-usage/token', { token, method: 'POST', body: '{}' });
}

export function deleteAiUsageToken(token: string): Promise<void> {
  return request('/api/ai-usage/token', { token, method: 'DELETE' });
}

export function saveAiUsageAdminKey(token: string, provider: AiUsageProvider, apiKey: string): Promise<{ provider: AiUsageProvider; configured: true }> {
  return request(`/api/ai-usage/admin-keys/${provider}`, { token, method: 'PUT', body: JSON.stringify({ api_key: apiKey }) });
}

export function deleteAiUsageAdminKey(token: string, provider: AiUsageProvider): Promise<void> {
  return request(`/api/ai-usage/admin-keys/${provider}`, { token, method: 'DELETE' });
}

export function testAiUsage(token: string): Promise<{ aiUsage: AiUsageData }> {
  return request('/api/ai-usage/test', { token, method: 'POST', body: '{}' });
}

export async function fetchPreviewFrame(token: string, deviceId?: string, signal?: AbortSignal, pageId?: string): Promise<{ pixels: Uint8Array; profile: DisplayProfile }> {
  const response = await fetch(`${BASE_URL}/api/image/preview/raw${savedPreviewQuery(deviceId, pageId)}`, { headers: { Authorization: `Bearer ${token}` }, signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  try {
    signal?.throwIfAborted();
    const { profile } = readPreviewMetadata(response.headers, deviceId, false, pageId);
    const pixels = new Uint8Array(await response.arrayBuffer());
    signal?.throwIfAborted();
    if (pixels.length !== frameMetadata(profile).byteLength) throw new Error('Invalid display image metadata');
    return { pixels, profile };
  } catch (error) { void response.body?.cancel().catch(() => {}); throw error; }
}
