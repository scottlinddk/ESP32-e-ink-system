import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Field } from '../ui/Field';
import type { AiUsageProvider } from '../../types';

interface AiUsageAdminKeysProps {
  da: boolean;
  configured: Record<AiUsageProvider, boolean> | undefined;
  disabled: boolean;
  onSave: (provider: AiUsageProvider, key: string) => Promise<void>;
  onRemove: (provider: AiUsageProvider) => Promise<void>;
}

const PROVIDERS: Array<{ id: AiUsageProvider; name: string; prefix: string; pattern: RegExp; console: string }> = [
  { id: 'claude', name: 'Anthropic', prefix: 'sk-ant-admin', pattern: /^sk-ant-admin[0-9a-z]*-[A-Za-z0-9_-]{20,300}$/, console: 'https://platform.claude.com/docs/en/manage-claude/admin-api-keys' },
  { id: 'openai', name: 'OpenAI', prefix: 'sk-admin-', pattern: /^sk-admin-[A-Za-z0-9_-]{20,300}$/, console: 'https://platform.openai.com/settings/organization/admin-keys' },
];

/** Admin API keys let the server read organization usage and billed cost without any computer running. */
export function AiUsageAdminKeys({ da, configured, disabled, onSave, onRemove }: AiUsageAdminKeysProps) {
  const [drafts, setDrafts] = useState<Record<AiUsageProvider, string>>({ claude: '', openai: '' });
  const [invalid, setInvalid] = useState<AiUsageProvider | ''>('');

  async function save(provider: typeof PROVIDERS[number]) {
    const key = drafts[provider.id].trim();
    if (!provider.pattern.test(key)) { setInvalid(provider.id); return; }
    setInvalid('');
    await onSave(provider.id, key);
    setDrafts((current) => ({ ...current, [provider.id]: '' }));
  }

  return <div className="grid gap-3">
    <p className="text-sm text-fg2 m-0">{da
      ? 'Valgfrit. Med en Admin API-nøgle henter serveren selv organisationens tokenforbrug i dag og den faktiske pris for måneden, også når din computer er slukket. Individuelle konti har ikke Admin API.'
      : 'Optional. With an Admin API key the server itself reads your organization’s token usage today and the billed cost this month, even while your computer is off. Individual accounts have no Admin API.'}</p>
    {PROVIDERS.map((provider) => {
      const id = `ai-usage-admin-${provider.id}`;
      const isConfigured = configured?.[provider.id] ?? false;
      return <Field key={provider.id} label={`${provider.name} Admin API ${da ? 'nøgle' : 'key'}`} htmlFor={id}
        helper={invalid === provider.id
          ? (da ? `Indsæt en Admin-nøgle, der starter med ${provider.prefix}. Almindelige API-nøgler kan ikke læse forbrug.` : `Paste an Admin key starting with ${provider.prefix}. Regular API keys cannot read usage.`)
          : isConfigured ? (da ? 'Gemt krypteret. Indsæt en ny nøgle for at udskifte den.' : 'Saved encrypted. Paste a new key to replace it.') : undefined}>
        <div className="flex gap-2 flex-wrap">
          <input id={id} type="password" autoComplete="off" spellCheck={false} value={drafts[provider.id]} disabled={disabled}
            placeholder={isConfigured ? '••••••••' : `${provider.prefix}…`} aria-invalid={invalid === provider.id}
            onChange={(event) => setDrafts((current) => ({ ...current, [provider.id]: event.target.value }))}
            className="flex-1 min-w-0 font-mono text-xs border border-border rounded-md p-2 bg-surface" />
          <Button disabled={disabled || !drafts[provider.id].trim()} onClick={() => save(provider)}>{da ? 'Gem' : 'Save'}</Button>
          {isConfigured && <Button variant="outlined" disabled={disabled} onClick={() => onRemove(provider.id)}>{da ? 'Fjern' : 'Remove'}</Button>}
        </div>
        <a className="text-xs underline" href={provider.console} target="_blank" rel="noreferrer">{da ? `Sådan opretter du en ${provider.name} Admin-nøgle` : `How to create a ${provider.name} Admin key`}</a>
      </Field>;
    })}
  </div>;
}
