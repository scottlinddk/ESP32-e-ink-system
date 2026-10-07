import React, { useState } from 'react';
import { aiUsageSetup, machineName } from '../../lib/aiUsageSetup';
import { Field } from '../ui/Field';

function Snippet({ code }: { code: string }) {
  return <pre className="overflow-x-auto text-xs bg-surface p-3 rounded-md m-0"><code>{code}</code></pre>;
}

/** Step-by-step collector setup for the computer where Claude Code or Codex runs. */
export function AiUsageSetupGuide({ da, timeZone }: { da: boolean; timeZone: string }) {
  const [machine, setMachine] = useState('laptop');
  const setup = aiUsageSetup(typeof window === 'undefined' ? undefined : window.location.origin, timeZone, machine);

  return <details className="border border-border rounded-md p-3">
    <summary className="cursor-pointer font-medium text-sm">{da ? 'Opsæt indsamleren trin for trin' : 'Set up the collector step by step'}</summary>
    <div className="grid gap-3 mt-3 text-sm">
      <p className="m-0">{da
        ? 'Indsamleren kører på computeren, hvor du bruger Claude Code eller Codex. Den læser deres lokale sessionsfiler og sender kun summer: tokens pr. model i dag og kvoteprocenter. Prompts, svar, stier og projektnavne forlader aldrig computeren. Kræver Node.js 20 eller nyere.'
        : 'The collector runs on the computer where you use Claude Code or Codex. It reads their local session files and sends only totals: tokens per model today and quota percentages. Prompts, responses, paths and project names never leave the computer. Requires Node.js 20 or newer.'}</p>
      <Field label={da ? 'Navn på denne computer' : 'Name for this computer'} htmlFor="ai-usage-machine"
        helper={da ? 'Hver computer rapporterer sit eget forbrug; displayet lægger dem sammen.' : 'Each computer reports its own usage; the display adds them up.'}>
        <input id="ai-usage-machine" type="text" value={machine} maxLength={32} onChange={(event) => setMachine(event.target.value)}
          onBlur={() => setMachine(machineName(machine))} className="w-full border border-border rounded-md p-2 bg-surface" />
      </Field>
      {setup.needsHttpsHost && <p className="text-xs text-warning m-0">{da
        ? 'Du bruger localhost eller en usikker adresse. Erstat YOUR-DISPLAY-HOST med din udrullede apps HTTPS-adresse.'
        : 'This is localhost or an insecure address. Replace YOUR-DISPLAY-HOST with your deployed app’s HTTPS address.'}</p>}
      <p className="m-0">{da ? '1. Hent indsamleren:' : '1. Get the collector:'}</p>
      <Snippet code={setup.install} />
      <p className="m-0">{da ? '2. Gem adresse og token (filen får kun ejer-rettigheder), og send første gang:' : '2. Save the address and token (the file is readable by you only) and send once:'}</p>
      <Snippet code={setup.init} />
      <p className="m-0">{da ? '3. Send automatisk hvert kvarter. Linux (crontab -e):' : '3. Send automatically every 15 minutes. Linux (crontab -e):'}</p>
      <Snippet code={setup.cron} />
      <p className="m-0">{da ? 'macOS: gem som ~/Library/LaunchAgents/dk.esp32-eink.ai-usage.plist, ret stien, og kør launchctl load på filen:' : 'macOS: save as ~/Library/LaunchAgents/dk.esp32-eink.ai-usage.plist, fix the path and run launchctl load on the file:'}</p>
      <Snippet code={setup.launchd} />
      <p className="m-0">Windows:</p>
      <Snippet code={setup.windows} />
      <p className="m-0">{da
        ? '4. Claude-kvoter (5 timer og 7 dage) findes kun i Claude Codes statuslinje. Tilføj dette i ~/.claude/settings.json, så kvoten sendes, mens du arbejder (højst én gang i minuttet). Har du allerede en statuslinje, så send dens JSON-input videre til kommandoen med --quiet.'
        : '4. Claude quota (5-hour and 7-day) is only available to Claude Code’s status line. Add this to ~/.claude/settings.json so the quota is sent while you work (at most once a minute). If you already have a status line, pipe its JSON input to this command with --quiet.'}</p>
      <Snippet code={setup.statusLine} />
      <p className="m-0 text-xs text-fg2">{da
        ? 'Codex-kvoter læses fra Codex’ sessionsfiler af push-kommandoen. Tokens dækker kun Claude Code- og Codex-sessioner på dine computere; kvoteprocenterne er kontoens samlede forbrug, så Claude-procenten tæller også claude.ai med.'
        : 'Codex quota is read from Codex session files by the push command. Tokens cover only Claude Code and Codex sessions on your computers; quota percentages are account-wide, so the Claude percentage includes claude.ai too.'}</p>
    </div>
  </details>;
}
