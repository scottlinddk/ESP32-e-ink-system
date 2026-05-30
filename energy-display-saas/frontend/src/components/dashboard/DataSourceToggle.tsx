import { UserPreferences } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useSavePreferences } from '@/hooks/usePreferences';
import { useState } from 'react';
import { Zap, Cloud, Newspaper, Calendar, Wind, RefreshCw } from 'lucide-react';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';

interface DataSourceToggleProps {
  preferences: UserPreferences;
  onPreferencesChange: (prefs: Partial<UserPreferences>) => void;
}

interface ToggleItem {
  key: keyof Pick<
    UserPreferences,
    'show_energy_price' | 'show_weather' | 'show_news' | 'show_calendar' | 'show_air_quality'
  >;
  label: string;
  description: string;
  icon: React.ReactNode;
}

const TOGGLE_ITEMS: ToggleItem[] = [
  {
    key: 'show_energy_price',
    label: 'Energy Price',
    description: 'Live electricity spot prices from Energinet',
    icon: <Zap className="h-4 w-4 text-yellow-500" />,
  },
  {
    key: 'show_weather',
    label: 'Weather',
    description: 'Current conditions from OpenWeatherMap',
    icon: <Cloud className="h-4 w-4 text-blue-500" />,
  },
  {
    key: 'show_news',
    label: 'News Headlines',
    description: 'Top headlines from NewsAPI',
    icon: <Newspaper className="h-4 w-4 text-green-500" />,
  },
  {
    key: 'show_calendar',
    label: 'Calendar',
    description: 'Upcoming events (coming soon)',
    icon: <Calendar className="h-4 w-4 text-purple-500" />,
  },
  {
    key: 'show_air_quality',
    label: 'Air Quality',
    description: 'AQI index (coming soon)',
    icon: <Wind className="h-4 w-4 text-teal-500" />,
  },
];

export function DataSourceToggle({ preferences, onPreferencesChange }: DataSourceToggleProps) {
  const [localPrefs, setLocalPrefs] = useState<UserPreferences>(preferences);
  const savePrefs = useSavePreferences();

  const handleToggle = (key: keyof UserPreferences, value: boolean) => {
    const updated = { ...localPrefs, [key]: value };
    setLocalPrefs(updated);
    onPreferencesChange({ [key]: value });
  };

  const handleSelectChange = (key: keyof UserPreferences, value: string) => {
    const updated = { ...localPrefs, [key]: value };
    setLocalPrefs(updated);
    onPreferencesChange({ [key]: value });
  };

  const handleRefreshChange = (value: string) => {
    const minutes = parseInt(value, 10);
    const updated = { ...localPrefs, refresh_interval_minutes: minutes };
    setLocalPrefs(updated);
    onPreferencesChange({ refresh_interval_minutes: minutes });
  };

  const handleSave = () => {
    savePrefs.mutate(localPrefs);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Data Sources</CardTitle>
        <CardDescription>Choose what to show on your e-ink display</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Toggle items */}
        <div className="space-y-3">
          {TOGGLE_ITEMS.map((item) => (
            <div key={item.key} className="flex items-start space-x-3">
              <Checkbox
                id={item.key}
                checked={localPrefs[item.key] as boolean}
                onCheckedChange={(checked) => handleToggle(item.key, checked === true)}
                className="mt-0.5"
              />
              <div className="flex flex-1 items-start justify-between">
                <div>
                  <Label
                    htmlFor={item.key}
                    className="flex cursor-pointer items-center gap-1.5 font-medium"
                  >
                    {item.icon}
                    {item.label}
                  </Label>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Location settings */}
        <div className="border-t pt-4 space-y-3">
          <h4 className="text-sm font-medium">Location Settings</h4>

          {localPrefs.show_energy_price && (
            <div className="space-y-1.5">
              <Label htmlFor="price-area" className="text-xs text-muted-foreground">
                Price Area
              </Label>
              <Select
                value={localPrefs.energy_price_location}
                onValueChange={(v) => handleSelectChange('energy_price_location', v)}
              >
                <SelectTrigger id="price-area" className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DK1">DK1 — West Denmark</SelectItem>
                  <SelectItem value="DK2">DK2 — East Denmark</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {localPrefs.show_news && (
            <div className="space-y-1.5">
              <Label htmlFor="news-lang" className="text-xs text-muted-foreground">
                News Language
              </Label>
              <Select
                value={localPrefs.news_language}
                onValueChange={(v) => handleSelectChange('news_language', v)}
              >
                <SelectTrigger id="news-lang" className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="da">Danish</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* Refresh interval */}
        <div className="border-t pt-4 space-y-1.5">
          <Label htmlFor="refresh-interval" className="flex items-center gap-1.5 text-sm font-medium">
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh Interval
          </Label>
          <Select
            value={String(localPrefs.refresh_interval_minutes)}
            onValueChange={handleRefreshChange}
          >
            <SelectTrigger id="refresh-interval" className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="15">Every 15 minutes</SelectItem>
              <SelectItem value="30">Every 30 minutes</SelectItem>
              <SelectItem value="60">Every hour</SelectItem>
              <SelectItem value="120">Every 2 hours</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Save button */}
        <Button
          onClick={handleSave}
          disabled={savePrefs.isPending}
          className="w-full"
          size="sm"
        >
          {savePrefs.isPending ? (
            <span className="flex items-center gap-2">
              <LoadingSpinner size="sm" />
              Saving...
            </span>
          ) : savePrefs.isSuccess ? (
            'Saved!'
          ) : (
            'Save Preferences'
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
