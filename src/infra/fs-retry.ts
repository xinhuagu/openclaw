/**
 * File-system write helpers that retry on transient lock errors
 * (EBUSY / EACCES / EPERM) instead of crashing the process.
 *
 * Cloud-sync services (OneDrive, Dropbox, Google Drive, Baidu Netdisk)
 * temporarily lock files during upload/download, causing these errors.
 *
 * @see https://github.com/openclaw/openclaw/issues/39446
 */

import fs from "node:fs";
import os from "node:os";

/** On Windows EACCES/EPERM are transient lock errors; on POSIX they are real. */
const RETRYABLE =
  os.platform() === "win32"
    ? new Set(["EBUSY", "EACCES", "EPERM"])
    : new Set(["EBUSY"]);
const MAX = 3;
const BASE_MS = 50;

function isRetryable(err: unknown): boolean {
  return RETRYABLE.has((err as { code?: string }).code ?? "");
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function retrySync<T>(fn: () => T): T {
  for (let i = 0; i <= MAX; i++) {
    try {
      return fn();
    } catch (err) {
      if (isRetryable(err) && i < MAX) {
        sleepSync(BASE_MS * 2 ** i);
        continue;
      }
      throw err;
    }
  }
  throw new Error("unreachable");
}

async function retryAsync<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; i <= MAX; i++) {
    try {
      return await fn();
    } catch (err) {
      if (isRetryable(err) && i < MAX) {
        await new Promise((r) => setTimeout(r, BASE_MS * 2 ** i));
        continue;
      }
      throw err;
    }
  }
  throw new Error("unreachable");
}

/** `fs.writeFileSync` with retry on transient lock errors. */
export function writeFileSyncRetry(
  p: string,
  data: string | Buffer,
  opts?: fs.WriteFileOptions,
): void {
  retrySync(() => fs.writeFileSync(p, data, opts));
}

/** Async `fs.promises.writeFile` with retry. */
export function writeFileRetry(
  p: string,
  data: string | Buffer,
  opts?: Parameters<typeof fs.promises.writeFile>[2],
): Promise<void> {
  return retryAsync(() => fs.promises.writeFile(p, data, opts));
}

/** Async `fs.promises.appendFile` with retry. */
export function appendFileRetry(
  p: string,
  data: string | Buffer,
  opts?: Parameters<typeof fs.promises.appendFile>[2],
): Promise<void> {
  return retryAsync(() => fs.promises.appendFile(p, data, opts));
}

/**
 * Async `fs.promises.rename` with retry.
 * Falls back to copy+unlink on Windows when rename fails with EPERM/EEXIST.
 */
export async function renameRetry(src: string, dest: string): Promise<void> {
  try {
    return await retryAsync(() => fs.promises.rename(src, dest));
  } catch (err) {
    const code = (err as { code?: string }).code;
    if ((code === "EPERM" || code === "EEXIST") && os.platform() === "win32") {
      // Refuse to overwrite symlinks (CWE-59)
      try {
        const st = await fs.promises.lstat(dest);
        if (st.isSymbolicLink()) {
          throw new Error(`Refusing to write through symlink: ${dest}`, { cause: err });
        }
      } catch (e: unknown) {
        if ((e as { code?: string }).code !== "ENOENT") throw e as Error;
      }
      await fs.promises.copyFile(src, dest);
      await fs.promises.unlink(src).catch(() => {});
      return;
    }
    throw err;
  }
}
