/** Real response headers, kept together so API tests also exercise the identity contract. */
export function previewHeaders(deviceId = '', draft = false): Record<string, string> {
  return {
    'X-Preview-Device-ID': deviceId, 'X-Preview-Layout-ID': '',
    'X-Preview-Layout-Name': draft ? 'Draft' : 'Base%20layout',
    'X-Preview-Mode': draft ? 'draft' : 'single',
    'X-Preview-Rendered-At': '2026-10-02T12:34:56.000Z', 'X-Preview-Quiet': 'false',
    'X-Display-Width': '250', 'X-Display-Height': '122', 'X-Display-Rotation': '0',
    'X-Display-Encoding': 'mono-msb-white1', 'X-Display-Row-Bytes': '32',
  };
}
