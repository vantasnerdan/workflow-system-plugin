/**
 * The generated files are current: the generator, run on the contract's OpenAPI document as a
 * separate process (so the client still imports nothing from the workspace), finds nothing stale.
 * When this fails, run `pnpm --filter @wf/client generate`.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const clientRoot = join(import.meta.dirname, '..');

describe('US-D-8 the client is generated from the documented interface', () => {
  it('matches a fresh generation from the OpenAPI document', () => {
    let output = '';
    let failed = false;
    try {
      output = execFileSync(process.execPath, [join(clientRoot, 'codegen/generate.ts'), '--check'], {
        cwd: clientRoot,
        stdio: 'pipe',
      }).toString();
    } catch (error) {
      failed = true;
      output = String((error as { stdout?: Buffer }).stdout ?? error);
    }
    expect(output).toBe('');
    expect(failed).toBe(false);
  }, 120_000);
});
