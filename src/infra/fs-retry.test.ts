import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendFileRetry, renameRetry, writeFileRetry, writeFileSyncRetry } from "./fs-retry.js";

function ebusyError(): NodeJS.ErrnoException {
  const e = new Error("EBUSY") as NodeJS.ErrnoException;
  e.code = "EBUSY";
  return e;
}

describe("fs-retry", () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fs-retry-")); });
  afterEach(() => { vi.restoreAllMocks(); fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it("writeFileSyncRetry succeeds on first attempt", () => {
    const p = path.join(tmpDir, "a.txt");
    writeFileSyncRetry(p, "ok", "utf8");
    expect(fs.readFileSync(p, "utf8")).toBe("ok");
  });

  it("writeFileSyncRetry retries EBUSY then succeeds", () => {
    const p = path.join(tmpDir, "b.txt");
    let n = 0;
    const orig = fs.writeFileSync;
    vi.spyOn(fs, "writeFileSync").mockImplementation((...a: unknown[]) => {
      if (++n <= 2) throw ebusyError();
      return orig.call(fs, ...(a as Parameters<typeof fs.writeFileSync>));
    });
    writeFileSyncRetry(p, "ok", "utf8");
    expect(n).toBe(3);
  });

  it("writeFileSyncRetry throws non-retryable errors", () => {
    expect(() => writeFileSyncRetry(path.join(tmpDir, "no", "d", "f"), "x", "utf8")).toThrow();
  });

  it("writeFileSyncRetry throws after exhausting retries", () => {
    vi.spyOn(fs, "writeFileSync").mockImplementation(() => { throw ebusyError(); });
    expect(() => writeFileSyncRetry(path.join(tmpDir, "c"), "x", "utf8")).toThrow("EBUSY");
  });

  it("writeFileRetry retries EBUSY then succeeds", async () => {
    const p = path.join(tmpDir, "d.txt");
    let n = 0;
    const orig = fs.promises.writeFile;
    vi.spyOn(fs.promises, "writeFile").mockImplementation(async (...a: unknown[]) => {
      if (++n === 1) throw ebusyError();
      return orig.call(fs.promises, ...(a as Parameters<typeof fs.promises.writeFile>));
    });
    await writeFileRetry(p, "ok", "utf8");
    expect(n).toBe(2);
  });

  it("appendFileRetry retries EBUSY then succeeds", async () => {
    const p = path.join(tmpDir, "e.txt");
    fs.writeFileSync(p, "", "utf8");
    let n = 0;
    const orig = fs.promises.appendFile;
    vi.spyOn(fs.promises, "appendFile").mockImplementation(async (...a: unknown[]) => {
      if (++n <= 2) throw ebusyError();
      return orig.call(fs.promises, ...(a as Parameters<typeof fs.promises.appendFile>));
    });
    await appendFileRetry(p, "data", "utf8");
    expect(n).toBe(3);
  });

  it("renameRetry succeeds on first attempt", async () => {
    const src = path.join(tmpDir, "s.txt"), dest = path.join(tmpDir, "d.txt");
    fs.writeFileSync(src, "data", "utf8");
    await renameRetry(src, dest);
    expect(fs.readFileSync(dest, "utf8")).toBe("data");
    expect(fs.existsSync(src)).toBe(false);
  });

  it("renameRetry retries EBUSY then succeeds", async () => {
    const src = path.join(tmpDir, "s2.txt"), dest = path.join(tmpDir, "d2.txt");
    fs.writeFileSync(src, "data", "utf8");
    let n = 0;
    const orig = fs.promises.rename;
    vi.spyOn(fs.promises, "rename").mockImplementation(async (...a: unknown[]) => {
      if (++n === 1) throw ebusyError();
      return orig.call(fs.promises, ...(a as Parameters<typeof fs.promises.rename>));
    });
    await renameRetry(src, dest);
    expect(n).toBe(2);
  });
});
