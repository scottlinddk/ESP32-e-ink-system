#!/usr/bin/env node
// Compatibility entry point for installs set up before the collector moved to TypeScript:
// existing cron jobs, LaunchAgents and status lines call collector.mjs. New setups run
// collector.ts directly. Node.js runs .ts files natively from 22.18 (and 23.6).
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 18) || (major === 23 && minor < 6)) {
  console.error(`The AI usage collector needs Node.js 22.18 or newer to run TypeScript; this is ${process.version}.`);
  process.exitCode = 1;
} else {
  const { run } = await import('./collector.ts');
  run();
}
