import fs from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { HttpError, newId } from './util';

const MB = 1024 * 1024;

export const tooLarge = (maxBytes: number) =>
  new HttpError(413, 'too_large', `Files can be at most ${Math.round((maxBytes / MB) * 10) / 10} MB`);

/**
 * Files attached to tasks: one file per attachment id in a single directory (by default
 * `attachments/` next to the database). A file never changes after it is uploaded, so a
 * backup only needs to copy the directory.
 */
export class FileStore {
  constructor(
    readonly dir: string,
    /** Largest accepted upload, in bytes. */
    readonly maxBytes: number,
  ) {}

  private get tmpDir() {
    return path.join(this.dir, '.tmp');
  }

  /** Where a stored file lives. Ids are validated before they get here, so they are safe as file names. */
  path(id: string): string {
    return path.join(this.dir, id);
  }

  /**
   * Streams an upload into the store under `id` and returns its size in bytes. Uploads over
   * the limit are rejected while they stream; a file shows up under its id only once complete.
   */
  async save(id: string, body: ReadableStream<Uint8Array> | null): Promise<number> {
    await fs.promises.mkdir(this.tmpDir, { recursive: true });
    const tmp = path.join(this.tmpDir, `${id}.${newId(6)}`);
    let size = 0;
    const limit = new Transform({
      transform: (chunk: Buffer, _encoding, done) => {
        size += chunk.length;
        done(size > this.maxBytes ? tooLarge(this.maxBytes) : null, chunk);
      },
    });
    try {
      const source = body ? Readable.fromWeb(body as NodeReadableStream<Uint8Array>) : Readable.from([]);
      await pipeline(source, limit, fs.createWriteStream(tmp, { flags: 'wx' }));
      if (fs.existsSync(this.path(id))) throw new HttpError(409, 'conflict', 'An attachment with this id already exists');
      await fs.promises.rename(tmp, this.path(id));
      return size;
    } catch (err) {
      await fs.promises.rm(tmp, { force: true });
      throw err;
    }
  }

  remove(id: string) {
    fs.rmSync(this.path(id), { force: true });
  }

  /** Clears uploads left half-written by a crash or a restart. */
  sweep() {
    fs.rmSync(this.tmpDir, { recursive: true, force: true });
  }
}
