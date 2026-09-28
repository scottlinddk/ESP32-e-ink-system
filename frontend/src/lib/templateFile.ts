export const TEMPLATE_MAX_BYTES = 8192;

export async function readTemplateFile(file: Blob): Promise<unknown> {
  if (file.size > TEMPLATE_MAX_BYTES) throw new Error('Templates must be at most 8 KiB.');
  try { return JSON.parse(await file.text()); }
  catch { throw new Error('Choose a valid JSON template file.'); }
}
