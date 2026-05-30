import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useApiKeys, useSaveApiKey } from '@/hooks/usePreferences';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { Key, Check, AlertCircle, Eye, EyeOff } from 'lucide-react';

interface ApiKeyFormProps {
  provider: string;
  label: string;
  description: string;
  placeholder: string;
  existingKey?: string;
}

function ApiKeyForm({ provider, label, description, placeholder, existingKey }: ApiKeyFormProps) {
  const [value, setValue] = useState('');
  const [showValue, setShowValue] = useState(false);
  const saveKey = useSaveApiKey();

  const handleSave = () => {
    if (!value.trim()) return;
    saveKey.mutate(
      { provider, api_key: value.trim() },
      {
        onSuccess: () => setValue(''),
      }
    );
  };

  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex items-start justify-between">
        <div>
          <h4 className="text-sm font-medium flex items-center gap-1.5">
            <Key className="h-3.5 w-3.5" />
            {label}
          </h4>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        {existingKey ? (
          <Badge variant="success" className="text-xs">
            <Check className="mr-1 h-3 w-3" />
            Saved
          </Badge>
        ) : (
          <Badge variant="outline" className="text-xs">
            Not set
          </Badge>
        )}
      </div>

      {existingKey && (
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded bg-muted px-2 py-1 text-xs font-mono">
            {existingKey}
          </code>
        </div>
      )}

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            type={showValue ? 'text' : 'password'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={existingKey ? 'Enter new key to replace...' : placeholder}
            className="h-8 text-sm pr-8"
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          />
          <button
            type="button"
            onClick={() => setShowValue(!showValue)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {showValue ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>
        <Button
          onClick={handleSave}
          disabled={!value.trim() || saveKey.isPending}
          size="sm"
          className="h-8 px-3"
        >
          {saveKey.isPending ? <LoadingSpinner size="sm" /> : 'Save'}
        </Button>
      </div>

      {saveKey.isError && (
        <p className="flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="h-3 w-3" />
          {saveKey.error instanceof Error ? saveKey.error.message : 'Failed to save key'}
        </p>
      )}

      {saveKey.isSuccess && (
        <p className="flex items-center gap-1 text-xs text-green-600">
          <Check className="h-3 w-3" />
          API key saved successfully
        </p>
      )}
    </div>
  );
}

export function ApiKeyManager() {
  const { data: apiKeys, isLoading, error } = useApiKeys();

  const getKey = (provider: string) =>
    apiKeys?.find((k) => k.provider === provider)?.api_key;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <LoadingSpinner label="Loading API keys..." />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">API Keys</CardTitle>
        <CardDescription>
          Add your API keys to enable weather and news data. Keys are stored encrypted.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            Failed to load API keys
          </div>
        )}

        <ApiKeyForm
          provider="openweathermap"
          label="OpenWeatherMap"
          description="Required for weather data. Free tier available at openweathermap.org"
          placeholder="e.g. a1b2c3d4e5f6..."
          existingKey={getKey('openweathermap')}
        />

        <ApiKeyForm
          provider="newsapi"
          label="NewsAPI"
          description="Required for news headlines. Free developer tier at newsapi.org"
          placeholder="e.g. abc123..."
          existingKey={getKey('newsapi')}
        />

        <div className="rounded-md border border-dashed p-3 text-center">
          <p className="text-xs text-muted-foreground">
            Energy prices from Energinet are always free — no API key needed
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
