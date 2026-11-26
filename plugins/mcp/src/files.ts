/**
 * Large files by local path (architecture 6.2): resumable upload with the tus protocol, and download
 * with HTTP Range, both resuming where they stopped. Upload: create (`upload_create`), send chunks
 * (`upload_append`), read the offset after an interruption (`upload_status`), then attach the finished
 * upload to the step as a file version (`file_version_register`). Download: `artifact_get` for the
 * version's size and checksum, then `artifact_download` into `<path>.part`, renamed when complete and
 * the checksum matches.
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { isWfError, problemOf, type RequestBody, type WfClient, WfError } from '@wf/client';
import type { StateStore } from './state.ts';

export const CHUNK_SIZE = 8 * 1024 * 1024;

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.zip': 'application/zip',
  '.ai': 'application/postscript',
  '.eps': 'application/postscript',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export function mimeOf(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');

function uploadIdFrom(location: string | null): string {
  if (!location) throw new WfError(problemOf('upload_incomplete', { detail: 'The site did not say where to send the file.' }));
  const path = new URL(location, 'http://placeholder.invalid').pathname;
  const id = decodeURIComponent(path.split('/').filter(Boolean).pop() ?? '');
  if (!id) throw new WfError(problemOf('upload_incomplete', { detail: 'The site gave an upload address without an id.' }));
  return id;
}

export type RegisterOptions = Omit<RequestBody<'file_version_register'>, 'upload_id' | 'name'> & { name?: string };

export class FileTransfers {
  private readonly client: WfClient;
  private readonly state: StateStore;
  private readonly chunkSize: number;

  constructor(client: WfClient, state: StateStore, chunkSize = CHUNK_SIZE) {
    this.client = client;
    this.state = state;
    this.chunkSize = chunkSize;
  }

  /** Uploads a local file to a step and registers it as the next version of a file with that name. */
  async upload(step: string, localPath: string, options: RegisterOptions = {}) {
    const path = resolve(localPath);
    if (!existsSync(path))
      throw new WfError(
        problemOf('invalid_input', { detail: `There is no file at ${path}.`, errors: [{ path: 'path', message: 'No such file' }] }),
      );
    const stat = statSync(path);
    if (!stat.isFile())
      throw new WfError(
        problemOf('invalid_input', { detail: `${path} is not a file.`, errors: [{ path: 'path', message: 'Not a file' }] }),
      );
    const key = createHash('sha256').update(`${path}\0${stat.size}\0${stat.mtimeMs}\0${step}`).digest('hex');
    const saved = this.state.read().uploads?.[key];
    let uploadId = saved?.uploadId;
    let offset = 0;
    if (uploadId) {
      try {
        const status = await this.client.call('upload_status', { params: { upload: uploadId } });
        offset = status.offset;
      } catch (error) {
        if (!(isWfError(error) && error.code === 'not_found')) throw error;
        uploadId = undefined;
      }
    }
    const resumedFrom = offset;
    if (!uploadId) {
      const created = await this.client.raw('upload_create', {
        headers: {
          'tus-resumable': '1.0.0',
          'upload-length': String(stat.size),
          'upload-metadata': `filename ${b64(options.name ?? basename(path))},mime ${b64(mimeOf(path))},step ${b64(step)}`,
        },
      });
      uploadId = uploadIdFrom(created.headers.get('location'));
      const id = uploadId;
      this.state.update((s) => {
        s.uploads = { ...(s.uploads ?? {}), [key]: { uploadId: id, path, size: stat.size, mtimeMs: stat.mtimeMs, step } };
      });
    }
    while (offset < stat.size) {
      const end = Math.min(stat.size, offset + this.chunkSize);
      const chunk = await readRange(path, offset, end);
      try {
        const answer = await this.client.raw('upload_append', {
          params: { upload: uploadId },
          body: '',
          rawBody: chunk,
          headers: { 'tus-resumable': '1.0.0', 'upload-offset': String(offset), 'content-type': 'application/offset+octet-stream' },
        });
        const next = Number(answer.headers.get('upload-offset'));
        offset = Number.isFinite(next) && next > offset ? next : end;
      } catch (error) {
        if (!(isWfError(error) && error.code === 'conflict')) throw error;
        offset = (await this.client.call('upload_status', { params: { upload: uploadId } })).offset;
      }
    }
    const registered = await this.client.call('file_version_register', {
      params: { step },
      body: { ...options, upload_id: uploadId, name: options.name ?? basename(path) } as RequestBody<'file_version_register'>,
    });
    this.state.update((s) => {
      if (s.uploads) delete s.uploads[key];
    });
    return { uploadId, resumedFrom, size: stat.size, registered };
  }

  /** Downloads a file version to a local path, resuming a partial download. */
  async download(artifact: string, version: number | 'latest', localPath: string) {
    const path = resolve(localPath);
    const detail = await this.client.call('artifact_get', { params: { artifact }, query: { detail: 'standard' } });
    const part = `${path}.part`;
    let have = existsSync(part) ? statSync(part).size : 0;
    const response = await this.client.raw('artifact_download', {
      params: { artifact, version: String(version) },
      headers: have > 0 ? { range: `bytes=${have}-` } : {},
    });
    if (response.status !== 206) have = 0;
    const handle = await open(part, have > 0 ? 'a' : 'w');
    try {
      if (response.body) for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) await handle.write(chunk);
    } finally {
      await handle.close();
    }
    const size = statSync(part).size;
    const latest = detail.latest as { number?: number; size?: number; sha256?: string; originalName?: string } | null;
    const expected = version === 'latest' || latest?.number === version ? latest : null;
    if (expected?.sha256) {
      const sum = await sha256File(part);
      if (sum !== expected.sha256) {
        unlinkSync(part);
        throw new WfError(
          problemOf('conflict', { detail: 'The downloaded file does not match its checksum; it was removed. Download it again.' }),
        );
      }
    }
    renameSync(part, path);
    return { path, size, resumedFrom: have, artifact: detail.artifact, version: expected ?? null };
  }
}

async function readRange(path: string, start: number, end: number): Promise<Blob> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(end - start);
    await handle.read(buffer, 0, buffer.length, start);
    return new Blob([buffer]);
  } finally {
    await handle.close();
  }
}

export function sha256File(path: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (d) => hash.update(d))
      .on('error', reject)
      .on('end', () => resolvePromise(hash.digest('hex')));
  });
}
