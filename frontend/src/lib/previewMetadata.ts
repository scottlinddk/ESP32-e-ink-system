import { frameMetadata, type DisplayProfile } from './displayProfile';

export interface PreviewMetadata {
  deviceId: string | null;
  layoutId: string | null;
  layoutName: string;
  mode: 'single' | 'slideshow' | 'draft';
  renderedAt: string;
  quiet: boolean;
  nextTransition: string | null;
  profile: DisplayProfile;
}
export interface PreviewImage { blob: Blob; metadata: PreviewMetadata }

/** Labels and identity are read from the same response as the pixels, never current form state. */
export function readPreviewMetadata(headers: Headers, expectedDeviceId?: string, draft = false): PreviewMetadata {
  const device = headers.get('X-Preview-Device-ID');
  if (device === null || device.toLowerCase() !== (expectedDeviceId ?? '').toLowerCase()) throw new Error('Preview device does not match the selected device.');
  const layout = headers.get('X-Preview-Layout-ID');
  const encodedName = headers.get('X-Preview-Layout-Name');
  const mode = headers.get('X-Preview-Mode');
  const quiet = headers.get('X-Preview-Quiet');
  const renderedAt = headers.get('X-Preview-Rendered-At');
  const nextTransition = headers.get('X-Preview-Next-Transition');
  const validTime = (value: string | null) => !!value && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
  if (layout === null || layout !== '' && !/^[A-Za-z0-9_-]{1,48}$/.test(layout) || encodedName === null
    || !validTime(renderedAt) || nextTransition !== null && !validTime(nextTransition)
    || !['true', 'false'].includes(quiet ?? '') || !(draft ? mode === 'draft' : mode === 'single' || mode === 'slideshow')
    || mode === 'slideshow' && (!nextTransition || !layout) || mode !== 'slideshow' && (nextTransition !== null || quiet === 'true')) {
    throw new Error('Invalid preview metadata.');
  }
  let layoutName: string;
  try { layoutName = decodeURIComponent(encodedName); } catch { throw new Error('Invalid preview layout name.'); }
  if (!layoutName.trim() || layoutName.length > 80) throw new Error('Invalid preview layout name.');
  if (['Width', 'Height', 'Rotation', 'Row-Bytes', 'Encoding'].some((key) => headers.get(`X-Display-${key}`) === null)) throw new Error('Missing display image metadata.');
  const profile = { width: Number(headers.get('X-Display-Width')), height: Number(headers.get('X-Display-Height')),
    rotation: Number(headers.get('X-Display-Rotation')), colorMode: 'bw' } as DisplayProfile;
  const meta = frameMetadata(profile);
  if (headers.get('X-Display-Encoding') !== meta.encoding || Number(headers.get('X-Display-Row-Bytes')) !== meta.rowBytes) throw new Error('Invalid display image metadata.');
  return { deviceId: device || null, layoutId: layout || null, layoutName, mode: mode as PreviewMetadata['mode'],
    renderedAt: renderedAt!, quiet: quiet === 'true', nextTransition, profile };
}
