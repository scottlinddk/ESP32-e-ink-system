import { useState } from 'react';
import { usePreferences } from '@/hooks/usePreferences';
import { useDisplayPreview, useMockDisplayData } from '@/hooks/useDisplayPreview';
import { UserPreferences } from '@/types';
import { DataSourceToggle } from './DataSourceToggle';
import { PreviewDisplay } from './PreviewDisplay';
import { ApiKeyManager } from './ApiKeyManager';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, AlertCircle, Monitor, Settings2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

export function Dashboard() {
  const queryClient = useQueryClient();
  const { data: prefs, isLoading: prefsLoading, error: prefsError } = usePreferences();
  const [localPrefs, setLocalPrefs] = useState<Partial<UserPreferences>>({});
  const mergedPrefs = prefs ? { ...prefs, ...localPrefs } : null;

  const {
    data: liveData,
    isLoading: previewLoading,
    error: previewError,
    isFetching,
  } = useDisplayPreview(mergedPrefs ?? undefined);

  // Fall back to mock data while live data is loading
  const mockData = useMockDisplayData(mergedPrefs);
  const displayData = liveData ?? mockData;

  const handlePrefsChange = (update: Partial<UserPreferences>) => {
    setLocalPrefs((prev) => ({ ...prev, ...update }));
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['preview'] });
  };

  if (prefsLoading) {
    return (
      <div className="flex min-h-[calc(100vh-56px)] items-center justify-center">
        <LoadingSpinner size="lg" label="Loading your preferences..." />
      </div>
    );
  }

  if (prefsError) {
    return (
      <div className="flex min-h-[calc(100vh-56px)] items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="flex flex-col items-center gap-3 py-8">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <p className="text-center text-sm text-muted-foreground">
              Failed to load preferences. Please refresh the page.
            </p>
            <Button variant="outline" onClick={() => window.location.reload()}>
              Reload
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-56px)] bg-muted/30">
      <div className="container mx-auto px-4 py-6 max-w-6xl">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Monitor className="h-6 w-6" />
              Dashboard
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Configure your e-ink display and preview changes in real time
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isFetching && (
              <Badge variant="secondary" className="gap-1">
                <LoadingSpinner size="sm" />
                Refreshing
              </Badge>
            )}
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isFetching}>
              <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
              Refresh Preview
            </Button>
          </div>
        </div>

        {/* Main layout */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_auto_1fr]">
          {/* Left: settings */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Settings2 className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Configuration
              </h2>
            </div>
            {prefs && (
              <DataSourceToggle
                preferences={{ ...prefs, ...localPrefs }}
                onPreferencesChange={handlePrefsChange}
              />
            )}
            <ApiKeyManager />
          </div>

          {/* Center divider on desktop */}
          <div className="hidden lg:block w-px bg-border self-stretch mx-2" />

          {/* Right: preview */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Monitor className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Live Preview
              </h2>
            </div>

            {previewError && (
              <Card className="border-yellow-200 bg-yellow-50">
                <CardContent className="flex items-center gap-2 py-3">
                  <AlertCircle className="h-4 w-4 text-yellow-600 shrink-0" />
                  <p className="text-xs text-yellow-700">
                    Live data unavailable — showing mock preview.
                    Check your API keys or try again later.
                  </p>
                </CardContent>
              </Card>
            )}

            <div className="flex justify-center">
              <PreviewDisplay
                data={displayData}
                preferences={mergedPrefs}
                isLoading={previewLoading}
              />
            </div>

            {/* Device info card */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Device Integration</CardTitle>
                <CardDescription className="text-xs">
                  Your ESP32 polls this endpoint every{' '}
                  {mergedPrefs?.refresh_interval_minutes ?? 30} minutes
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-md bg-muted p-2">
                  <code className="text-xs break-all font-mono text-muted-foreground">
                    GET /api/display-data/&#123;userId&#125;?licenseKey=&#123;your-key&#125;
                  </code>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  See the{' '}
                  <a href="/setup" className="text-primary underline">
                    Setup Guide
                  </a>{' '}
                  to flash your device
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
