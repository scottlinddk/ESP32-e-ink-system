import React, { useEffect, useState } from 'react';
import { usePreferences, useSavePreferences } from '../../hooks/usePreferences';
import { DEFAULT_DISPLAY_PROFILE, parseDisplayProfile, DisplayProfile } from '../../lib/displayProfile';
import { Card } from '../ui/card';
import { Button } from '../ui/button';

export function DisplayProfileCard() {
  const preferences = usePreferences();
  const save = useSavePreferences();
  const [profile, setProfile] = useState<DisplayProfile>(DEFAULT_DISPLAY_PROFILE);
  const [message, setMessage] = useState('');
  useEffect(() => { if (preferences.data) setProfile(preferences.data.display_profile ?? DEFAULT_DISPLAY_PROFILE); }, [preferences.data]);
  async function submit() {
    setMessage('');
    try { await save.mutateAsync({ display_profile: parseDisplayProfile(profile) }); setMessage('Display profile saved.'); }
    catch (error) { setMessage((error as Error).message); }
  }
  return <Card title="Display size and orientation" desc="Use the native panel dimensions. Bluetooth checks the connected display before sending.">
    <div className="grid gap-3">
      <label>Preset <select className="w-full border rounded p-2" value="" onChange={(event) => { const [width,height] = event.target.value.split('x').map(Number); if (width && height) setProfile({ ...profile, width, height }); }}>
        <option value="">Choose a size</option><option value="250x122">250 × 122</option><option value="400x300">400 × 300</option><option value="800x480">800 × 480</option><option value="800x600">800 × 600</option><option value="1200x825">1200 × 825</option>
      </select></label>
      <div className="grid grid-cols-2 gap-3">{(['width','height'] as const).map((key) => <label key={key}>{key === 'width' ? 'Native width' : 'Native height'}<input className="w-full border rounded p-2" type="number" min={64} max={1600} value={profile[key]} onChange={(event) => setProfile({ ...profile, [key]: Number(event.target.value) })} /></label>)}</div>
      <label>Content rotation <select className="w-full border rounded p-2" value={profile.rotation} onChange={(event) => setProfile({ ...profile, rotation: Number(event.target.value) as DisplayProfile['rotation'] })}>{[0,90,180,270].map((angle) => <option key={angle} value={angle}>{angle}° clockwise</option>)}</select></label>
      <p className="text-xs text-fg2 m-0">Monochrome output. A size preset does not install a panel driver. Current OpenDisplay direct-write firmware requires a width divisible by 8; other widths remain available for BMP export.</p>
      <Button onClick={submit} disabled={save.isPending || preferences.isLoading || preferences.isError}>Save display profile</Button>
      {preferences.isError && <p role="alert">Display settings could not be loaded.</p>}
      {message && <p role="status" className="text-sm">{message}</p>}
    </div>
  </Card>;
}
