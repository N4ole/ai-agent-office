// Incremental JSONL reader: remembers a byte offset per file and only reads appended data.
// Handles partial last lines (file being written) and truncation/rotation.

import { promises as fsp } from 'node:fs';

export interface TailState {
  offset: number;
  /** Bytes of an incomplete trailing line not yet terminated by \n. */
  remainder: string;
  size: number;
  mtimeMs: number;
}

export class JsonlTailer {
  private states = new Map<string, TailState>();
  /** Max bytes read per call, so a huge file never blocks the event loop for long. */
  constructor(private chunkLimit = 8 * 1024 * 1024) {}

  getOffset(file: string): number {
    return this.states.get(file)?.offset ?? 0;
  }

  setOffset(file: string, offset: number): void {
    this.states.set(file, { offset, remainder: '', size: 0, mtimeMs: 0 });
  }

  has(file: string): boolean {
    return this.states.has(file);
  }

  forget(file: string): void {
    this.states.delete(file);
  }

  /** Returns complete new lines since last call. `more` is true if the file has unread data left. */
  async read(file: string): Promise<{ lines: string[]; more: boolean; reset: boolean }> {
    let st = this.states.get(file);
    if (!st) {
      st = { offset: 0, remainder: '', size: 0, mtimeMs: 0 };
      this.states.set(file, st);
    }
    let stat;
    try {
      stat = await fsp.stat(file);
    } catch {
      return { lines: [], more: false, reset: false };
    }
    let reset = false;
    if (stat.size < st.offset) {
      // File was truncated or replaced: start over.
      st.offset = 0;
      st.remainder = '';
      reset = true;
    }
    st.size = stat.size;
    st.mtimeMs = stat.mtimeMs;
    if (stat.size === st.offset) return { lines: [], more: false, reset };

    const toRead = Math.min(stat.size - st.offset, this.chunkLimit);
    const fh = await fsp.open(file, 'r');
    try {
      const buf = Buffer.alloc(toRead);
      const { bytesRead } = await fh.read(buf, 0, toRead, st.offset);
      // Only consume up to the last newline so multi-byte chars and lines are never split.
      const lastNl = buf.lastIndexOf(0x0a, bytesRead - 1);
      if (lastNl < 0) {
        // No complete line yet. If we hit the chunk limit, the line is huge: skip it to stay safe.
        if (bytesRead === this.chunkLimit) st.offset += bytesRead;
        return { lines: [], more: st.offset < stat.size, reset };
      }
      const text = buf.subarray(0, lastNl + 1).toString('utf8');
      st.offset += lastNl + 1;
      const lines = text.split('\n');
      lines.pop(); // trailing '' after last \n
      return { lines: lines.map((l) => l.replace(/\r$/, '')), more: st.offset < stat.size, reset };
    } finally {
      await fh.close();
    }
  }
}
