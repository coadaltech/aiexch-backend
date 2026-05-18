/**
 * Sync the Ace Gamings game catalog into our `casino_games` table.
 *
 * Local dev usage (going through the proxy on prod):
 *   bun run src/scripts/sync-casino-games.ts
 *
 * Reads CASINO_PLATFORM_BASE_URL from .env. If pointed at the dev proxy,
 * CASINO_PLATFORM_PROXY_SECRET must also be set.
 *
 * Behavior:
 *   - Upserts each game by external_id (Ace's id).
 *   - Updates name/slug/lang/currency/thumbnail/special_note on existing rows.
 *   - Refreshes last_seen_at for every game in the feed.
 *   - Does NOT delete or hide games that have disappeared from the feed —
 *     run sync-casino-games.ts --prune to mark those invisible.
 */
import "dotenv/config";
import { db } from "@db/index";
import { casinoGames } from "../db/schema";
import { listGames, clientInfo } from "../services/casino/ace-platform-client";
import { eq, sql, inArray, lt, and } from "drizzle-orm";

const PRUNE = process.argv.includes("--prune");

async function main() {
  console.log("[sync-casino-games] Starting...");
  console.log("[sync-casino-games] Client config:", clientInfo());

  const games = await listGames();
  console.log(`[sync-casino-games] Fetched ${games.length} games from upstream`);

  if (games.length === 0) {
    console.warn(
      "[sync-casino-games] Upstream returned 0 games — refusing to prune. Exiting.",
    );
    process.exit(0);
  }

  const now = new Date();
  let inserted = 0;
  let updated = 0;

  for (const g of games) {
    if (
      typeof g.id !== "number" ||
      !g.slug ||
      !g.name ||
      !g.currency
    ) {
      console.warn("[sync-casino-games] Skipping malformed game:", g);
      continue;
    }

    const values = {
      externalId: g.id,
      slug: g.slug.slice(0, 100),
      name: g.name.slice(0, 100),
      lang: (g.lang || "en-US").slice(0, 10),
      currency: g.currency.slice(0, 3).toUpperCase(),
      thumbnailUrl: g.thumbnail_url ?? null,
      specialNote: g.special_note?.slice(0, 50) ?? null,
      lastSeenAt: now,
    };

    const result = await db
      .insert(casinoGames)
      .values(values)
      .onConflictDoUpdate({
        target: casinoGames.externalId,
        set: {
          slug: values.slug,
          name: values.name,
          lang: values.lang,
          currency: values.currency,
          thumbnailUrl: values.thumbnailUrl,
          specialNote: values.specialNote,
          lastSeenAt: now,
        },
      })
      .returning({ id: casinoGames.id, addedDate: casinoGames.addedDate });

    if (result[0]?.addedDate && result[0].addedDate >= now) inserted += 1;
    else updated += 1;
  }

  console.log(
    `[sync-casino-games] Upsert complete — inserted=${inserted}, updated=${updated}`,
  );

  if (PRUNE) {
    const seenIds = games.map((g) => g.id);
    const pruned = await db
      .update(casinoGames)
      .set({ visible: false, updateDate: now })
      .where(
        and(
          eq(casinoGames.visible, true),
          sql`${casinoGames.externalId} <> ALL(${sql.raw(`ARRAY[${seenIds.join(",")}]::int[]`)})`,
        ),
      )
      .returning({ id: casinoGames.id, externalId: casinoGames.externalId });
    console.log(
      `[sync-casino-games] Pruned ${pruned.length} games no longer in feed`,
    );
  } else {
    console.log("[sync-casino-games] Skipping prune (pass --prune to enable)");
  }

  console.log("[sync-casino-games] Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[sync-casino-games] FAILED:", err?.response?.data ?? err);
  process.exit(1);
});
