import { mkdir, writeFile, readFile, rename, rm } from "fs/promises";
import { join, dirname } from "path";

/**
 * "Notepad" fast-display cache: derived eventType/competition/event lists written
 * as JSON files after each sync, so the UI can be served instantly without hitting
 * the DB on the hot path.
 *
 * NOTEPAD_DIR should point at the shared NFS mount so every instance reads the same
 * files (set it to the mount path in production; defaults to a local ./notepad dir).
 *
 * Writes are atomic-ish (write to .tmp then rename) to avoid readers seeing a
 * half-written file.
 */
const NOTEPAD_DIR = process.env.NOTEPAD_DIR || join(process.cwd(), "notepad");

/**
 * Write `data` as JSON to `<NOTEPAD_DIR>/<name>.json`. `name` may contain "/" to
 * write into subfolders (e.g. "series/acme/4" → series/acme/4.json). Never throws.
 */
export async function writeNotepad(
  name: string,
  data: unknown,
  opts?: { quiet?: boolean },
): Promise<void> {
  try {
    const target = join(NOTEPAD_DIR, `${name}.json`);
    await mkdir(dirname(target), { recursive: true });
    const tmp = `${target}.tmp`;
    const payload = JSON.stringify(
      { updatedAt: new Date().toISOString(), data },
      null,
      2,
    );
    await writeFile(tmp, payload, "utf-8");
    await rename(tmp, target);
    // `quiet` suppresses the per-file log — used when writing hundreds of
    // per-event snapshot files so the boot/daily log isn't flooded.
    if (!opts?.quiet) {
      console.log(`[Notepad] Wrote ${name}.json (${Array.isArray(data) ? data.length : "?"} records)`);
    }
  } catch (err: any) {
    console.error(`[Notepad] Failed to write ${name}.json:`, err?.message);
  }
}

/** Delete a single notepad file `<NOTEPAD_DIR>/<name>.json`. Never throws. */
export async function removeNotepadFile(name: string): Promise<void> {
  try {
    await rm(join(NOTEPAD_DIR, `${name}.json`), { force: true });
  } catch {
    /* ignore */
  }
}

/** Read `<NOTEPAD_DIR>/<name>.json`. Returns null if missing/unreadable. */
export async function readNotepad<T = unknown>(
  name: string,
): Promise<{ updatedAt: string; data: T } | null> {
  try {
    const target = join(NOTEPAD_DIR, `${name}.json`);
    const raw = await readFile(target, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Recursively delete a notepad subfolder (e.g. "series") so stale per-sport /
 * per-whitelabel files don't accumulate. Used before a full rebuild. Never throws.
 */
export async function removeNotepadDir(subdir: string): Promise<void> {
  try {
    await rm(join(NOTEPAD_DIR, subdir), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

export const NotepadService = {
  writeNotepad,
  readNotepad,
  removeNotepadDir,
  removeNotepadFile,
  NOTEPAD_DIR,
};
