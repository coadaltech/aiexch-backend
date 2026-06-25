import { db } from "@db/index";
import { sports, whitelabels } from "@db/schema";
import { asc, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { writeNotepad, removeNotepadDir } from "./notepad";

/**
 * Notepad BUILDER — materializes the display-ready JSON the read endpoints serve.
 *
 * Model: DB is the source of truth. After any sync or owner edit, we regenerate
 * the affected notepad files from the DB (using the same SQL functions the old
 * read path used), so reads can serve a flat file instead of hitting DB/Redis.
 *
 * File layout (under NOTEPAD_DIR):
 *   sports-list                    → active sports (user display shape)
 *   sports-list-all                → all sports incl. inactive (owner panel)
 *   series/<whitelabel>/<sportId>  → fn_get_series_with_matches(sportId, wlId)
 *     <whitelabel> = readable whitelabel-name slug, or "global" (no-whitelabel).
 *
 * Per-whitelabel folder grouping: "series/acme/4.json" — all of a whitelabel's
 * sports live in one folder. Filtering uses the whitelabel id; the folder name is
 * the readable whitelabel name. Reads serve one small file per (sport × whitelabel).
 */

const GLOBAL = "global";

/**
 * Human-readable, filesystem-safe key for a whitelabel name (used in filenames
 * so files are easy to identify, e.g. series-4-acme-bets.json). The "global"
 * (no-whitelabel) context uses "global". Must match the reader's key derivation.
 */
export const whitelabelNotepadKey = (name?: string | null): string => {
  if (!name) return GLOBAL;
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || GLOBAL;
};

/** All whitelabels (id + name). Name drives the readable filename, id drives filtering. */
async function getWhitelabels(): Promise<{ id: string; name: string }[]> {
  try {
    const rows = await db
      .select({ id: whitelabels.id, name: whitelabels.name })
      .from(whitelabels);
    return rows.filter((r) => r.id) as { id: string; name: string }[];
  } catch (err: any) {
    console.error("[NotepadBuilder] Failed to list whitelabels:", err?.message);
    return [];
  }
}

/** Run fn_get_series_with_matches and return its JSON array. */
async function fetchSeries(sportId: number, wl: string | null): Promise<any[]> {
  const rows: any = await db.execute(sql`
    SELECT fn_get_series_with_matches(${sportId}::bigint, ${wl}::uuid) AS data
  `);
  const arr = Array.isArray(rows) ? rows : rows?.rows ?? [];
  return (arr[0]?.data as any[] | null) ?? [];
}

/** Rebuild the sports-list notepad files (active + all). No whitelabel scoping. */
export async function buildSportsListNotepad(): Promise<void> {
  const all = await db.select().from(sports).orderBy(asc(sports.sort_order));
  const transform = (s: (typeof all)[number]) => ({
    id: s.sport_id,
    name: s.name,
    is_active: s.is_active,
    isActive: s.is_active,
    is_live: s.is_live,
    isLive: s.is_live,
    is_highlight: s.is_highlight,
    isHighlight: s.is_highlight,
    sort_order: s.sort_order,
    addedDate: s.addedDate,
    updateDate: s.updateDate,
  });
  await writeNotepad("sports-list", all.filter((s) => s.is_active).map(transform));
  await writeNotepad("sports-list-all", all.map(transform));
}

/** Series notepad path for a (whitelabel, sport): series/<whitelabel>/<sportId>. */
export const seriesNotepadPath = (whitelabelKey: string, sportId: number | string) =>
  `series/${whitelabelKey}/${sportId}`;

/** Rebuild the series-with-matches notepad for one sport, across all whitelabels + global. */
export async function buildSeriesNotepad(sportId: number): Promise<void> {
  const wls = await getWhitelabels();
  // [global, ...whitelabels]. Filtering uses the whitelabel id; the FOLDER is named
  // by the whitelabel name (readable) via whitelabelNotepadKey. Overwriting the same
  // path keeps it fresh; orphans (removed whitelabels) are cleared on full rebuild.
  const contexts: { id: string | null; key: string }[] = [
    { id: null, key: GLOBAL },
    ...wls.map((w) => ({ id: w.id, key: whitelabelNotepadKey(w.name) })),
  ];
  for (const ctx of contexts) {
    try {
      const data = await fetchSeries(sportId, ctx.id);
      await writeNotepad(seriesNotepadPath(ctx.key, sportId), data);
    } catch (err: any) {
      console.error(
        `[NotepadBuilder] series build failed sport=${sportId} wl=${ctx.key}:`,
        err?.message,
      );
    }
  }
}

/** Regenerate everything notepad serves for a single sport (sports-list + that sport's series). */
export async function regenSportNotepad(sportId: number): Promise<void> {
  await buildSportsListNotepad();
  await buildSeriesNotepad(sportId);
}

/** Full rebuild — sports-list + series for every sport. Used after a full sync. */
export async function rebuildAllNotepad(): Promise<void> {
  await buildSportsListNotepad();
  // Clear the whole series/ folder first (removed sports / renamed whitelabels)
  // so nothing stale lingers, then regenerate everything fresh.
  await removeNotepadDir("series");
  const allSports = await db.select({ sport_id: sports.sport_id }).from(sports);
  for (const s of allSports) {
    await buildSeriesNotepad(s.sport_id);
  }
  console.log(`[NotepadBuilder] Full rebuild done for ${allSports.length} sports`);
}

export const NotepadBuilder = {
  buildSportsListNotepad,
  buildSeriesNotepad,
  regenSportNotepad,
  rebuildAllNotepad,
};
