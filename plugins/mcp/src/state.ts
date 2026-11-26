/**
 * Small local state of the plugin, one JSON file per site in the state directory: the time of the
 * last `changes_since`, the id of the last event received, and unfinished uploads. Losing the file
 * loses nothing on the site: the inbox stays complete and ordered there.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface LocalState {
  changesSince?: string;
  lastEventId?: string;
  uploads?: Record<string, { uploadId: string; path: string; size: number; mtimeMs: number; step: string }>;
}

export class StateStore {
  readonly dir: string;
  readonly file: string;
  constructor(dir: string) {
    this.dir = dir;
    this.file = join(dir, 'state.json');
  }

  read(): LocalState {
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as LocalState;
    } catch {
      return {};
    }
  }

  update(change: (state: LocalState) => void): LocalState {
    const state = this.read();
    change(state);
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.file);
    return state;
  }
}
