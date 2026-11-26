/**
 * Builds the single-file server the Claude Code plugin runs: `plugins/claude-code/server/wf-agent.mjs`,
 * from `src/cli.ts` with every dependency inside, so an installer needs only Node.js 24 (no install
 * step, no package registry). `pnpm --filter @wf/agent-mcp bundle`; a test checks the file is current.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
export const pluginRoot = resolve(here, '..');
export const bundlePath = resolve(pluginRoot, '../claude-code/server/wf-agent.mjs');

const BANNER = [
  '#!/usr/bin/env node',
  '// The workflow site agent plugin: MCP server and wf-agent CLI, built from plugins/mcp (do not edit; run the bundle script).',
  "import { createRequire as __wfCreateRequire } from 'node:module';",
  'const require = __wfCreateRequire(import.meta.url);',
].join('\n');

/** The bundle as text. */
export async function bundleText(): Promise<string> {
  const result = await build({
    entryPoints: [join(pluginRoot, 'src/cli.ts')],
    absWorkingDir: resolve(pluginRoot, '../..'),
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    legalComments: 'none',
    banner: { js: BANNER },
    logLevel: 'silent',
  });
  const out = result.outputFiles[0];
  if (!out) throw new Error('esbuild produced no output');
  // esbuild keeps the entry's own shebang after the banner; one is enough.
  return out.text.replace(/\n#!\/usr\/bin\/env node\n/, '\n');
}

if (import.meta.main) {
  const text = await bundleText();
  mkdirSync(dirname(bundlePath), { recursive: true });
  writeFileSync(bundlePath, text, { mode: 0o755 });
  process.stdout.write(`${bundlePath} (${text.length} bytes)\n`);
}
