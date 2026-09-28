import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePreferences, useSavePreferences } from '../../hooks/usePreferences';
import { useApp } from '../../lib/appContext';
import { convertImage, decodeUpload, encodePixels, fittedImageSize, imagePreviewUrl, Raster } from '../../lib/imageConversion';
import type { CustomImage, UserPreferences } from '../../types';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Field } from '../ui/Field';

export function CustomContentCard() {
  const app = useApp();
  const query = usePreferences();
  const save = useSavePreferences();
  const dirty = useRef(false);
  const uploadVersion = useRef(0);
  const [text, setText] = useState('');
  const [showText, setShowText] = useState(false);
  const [showImage, setShowImage] = useState(false);
  const [image, setImage] = useState<CustomImage | null>(null);
  const [source, setSource] = useState<Raster | null>(null);
  const [mode, setMode] = useState<'threshold' | 'floyd-steinberg'>('floyd-steinberg');
  const [threshold, setThreshold] = useState(128);
  const [fit, setFit] = useState<'contain' | 'cover'>('contain');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function load(prefs: UserPreferences) {
    setText(prefs.custom_text ?? '');
    setShowText(prefs.show_custom_text ?? false);
    setShowImage(prefs.show_custom_image ?? false);
    setImage(prefs.custom_image ?? null);
    setFit(prefs.custom_image?.fit ?? 'contain');
    setSource(null);
    dirty.current = false;
    setError('');
  }
  useEffect(() => {
    if (query.data && !dirty.current) load(query.data);
  }, [query.data]);
  useEffect(() => () => { uploadVersion.current++; }, []);

  const preview = useMemo(() => {
    try { return image ? imagePreviewUrl(image) : ''; } catch { return ''; }
  }, [image]);
  const disabled = query.isLoading || query.isError || !query.data || save.isPending || busy;
  const inputClass = 'w-full rounded-md border border-border bg-surface text-fg1 px-3 py-2';

  function convert(raster: Raster, nextMode = mode, nextThreshold = threshold) {
    const size = fittedImageSize(raster.width, raster.height);
    const pixels = convertImage(raster, { ...size, mode: nextMode, threshold: nextMode === 'threshold' ? nextThreshold : 128, fit: 'contain' });
    setImage({ ...size, pixels: encodePixels(pixels), fit });
    dirty.current = true;
  }

  async function upload(file?: File) {
    if (!file) return;
    const version = ++uploadVersion.current;
    setBusy(true);
    setError('');
    try {
      const decoded = await decodeUpload(file);
      if (version !== uploadVersion.current) return;
      convert(decoded);
      setSource(decoded);
    } catch (failure) {
      if (version === uploadVersion.current) setError(failure instanceof Error ? failure.message : 'Image conversion failed.');
    } finally {
      if (version === uploadVersion.current) setBusy(false);
    }
  }

  async function persist() {
    if (disabled) return;
    setError('');
    try {
      const prefs = await save.mutateAsync({
        custom_text: text,
        show_custom_text: showText,
        custom_image: image,
        show_custom_image: showImage,
      });
      load(prefs);
      app.toast({ type: 'success', title: 'Custom content saved', msg: 'The display preview now uses your saved note and image.' });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save custom content.');
    }
  }

  return <Card title="Your notes and images" icon="image" desc="Add a personal note or a photo to your display.">
    {query.isLoading && <p role="status">Loading your content…</p>}
    {query.isError && <p role="alert">Could not load your content. <Button variant="text" onClick={() => query.refetch()}>Retry</Button></p>}
    <fieldset disabled={disabled} className="border-0 p-0 m-0 grid gap-4 min-w-0">
      <label className="flex gap-2 items-center"><input type="checkbox" checked={showText} onChange={(event) => { dirty.current = true; setShowText(event.target.checked); }} /> Show my note</label>
      <Field label="Note" htmlFor="custom-note" helper={`${text.length}/2000 characters. Line breaks are preserved.`}>
        <textarea id="custom-note" className={inputClass} rows={4} maxLength={2000} value={text} onChange={(event) => { dirty.current = true; setText(event.target.value); }} />
      </Field>
      <label className="flex gap-2 items-center"><input type="checkbox" checked={showImage} onChange={(event) => { dirty.current = true; setShowImage(event.target.checked); }} /> Show my image</label>
      <Field label="Choose image" htmlFor="custom-image-file" helper="PNG or JPEG, up to 5 MiB and 16 million pixels. Your photo is converted in this browser.">
        <input id="custom-image-file" type="file" accept="image/png,image/jpeg" onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = ''; }} />
      </Field>
      <div className="grid grid-cols-2 gap-3 max-[500px]:grid-cols-1">
        <Field label="Image fit" htmlFor="custom-image-fit">
          <select id="custom-image-fit" className={inputClass} value={fit} onChange={(event) => {
            const value = event.target.value as 'contain' | 'cover';
            dirty.current = true; setFit(value); setImage((current) => current ? { ...current, fit: value } : null);
          }}>
            <option value="contain">Fit whole image</option><option value="cover">Crop to fill widget</option>
          </select>
        </Field>
        <Field label="Black and white conversion" htmlFor="custom-image-mode" helper={!source ? 'Choose the original file to change conversion.' : undefined}>
          <select id="custom-image-mode" className={inputClass} value={mode} disabled={!source} onChange={(event) => {
            const value = event.target.value as typeof mode; setMode(value); if (source) convert(source, value);
          }}>
            <option value="floyd-steinberg">Dither (photos)</option><option value="threshold">Threshold (line art)</option>
          </select>
        </Field>
      </div>
      {source && mode === 'threshold' && <Field label={`Threshold: ${threshold}`} htmlFor="custom-image-threshold">
        <input id="custom-image-threshold" type="range" min={0} max={255} value={threshold} onChange={(event) => {
          const value = Number(event.target.value); setThreshold(value); convert(source, mode, value);
        }} />
      </Field>}
      {image && <div className="flex flex-col items-start gap-2">
        {preview && <img src={preview} alt="Converted black and white image" className="max-w-full max-h-48 border border-border bg-white" style={{ imageRendering: 'pixelated' }} />}
        <p className="text-xs text-fg2 m-0">{image.width} × {image.height} pixels. The saved display preview shows the fit inside your layout.</p>
        <Button variant="outlined" size="sm" onClick={() => { dirty.current = true; setImage(null); setSource(null); setShowImage(false); }}>Remove image</Button>
      </div>}
      <p className="text-sm text-fg2 m-0">Add the <strong>My note</strong> and <strong>My image</strong> widgets in the <Link to="/layout" className="underline">layout editor</Link>, then save your layout.</p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={persist} loading={save.isPending}>Save content</Button>
        <Button variant="outlined" onClick={() => query.data && load(query.data)}>Discard changes</Button>
      </div>
    </fieldset>
    {busy && <p role="status">Converting image…</p>}
    {error && <p role="alert" className="text-error">{error}</p>}
  </Card>;
}
