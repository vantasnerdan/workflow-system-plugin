#!/usr/bin/env node
// Copies the built single-file server into a harness plugin: node scripts/copy-server.mjs <harness>
// (plugins/claude-code/server/wf-agent.mjs -> plugins/<harness>/server/wf-agent.mjs). Run `pnpm bundle` first.
import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = join(import.meta.dirname, '..');
const harness = process.argv[2];
if (!harness || !/^[a-z0-9-]+$/.test(harness) || harness === 'claude-code' || harness === 'mcp') {
  console.error('Give the harness folder name, for example: node scripts/copy-server.mjs codex');
  process.exit(2);
}
if (!existsSync(join(root, 'plugins', harness))) {
  console.error(`plugins/${harness} does not exist.`);
  process.exit(2);
}
const from = join(root, 'plugins/claude-code/server/wf-agent.mjs');
const to = join(root, 'plugins', harness, 'server/wf-agent.mjs');
mkdirSync(dirname(to), { recursive: true });
copyFileSync(from, to);
chmodSync(to, 0o755);
console.log(to);
