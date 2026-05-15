import cron from "node-cron";
import { redis, redisIsHealthy } from "@db/redis";
import { db } from "@db/index";
import { events, marketSettings } from "@db/schema";

const STREAM_KEY = "stream:odds:history";
const STREAM_MAX_LEN = 10_000;
const STALE_EVENT_DAYS = 3;
const SCAN_BATCH = 500;
const OVERRIDE_TTL_SECONDS = 14 * 24 * 60 * 60;

async function scanKeys(pattern: string): Promise<string[]> {
  const out: string[] = [];
  let cursor = 0;
  do {
    const res = await redis.scan(cursor, { MATCH: pattern, COUNT: SCAN_BATCH });
    cursor = res.cursor;
    out.push(...res.keys);
  } while (cursor !== 0);
  return out;
}

function extractIdFromKey(key: string): string | null {
  const idx = key.lastIndexOf(":");
  if (idx < 0 || idx === key.length - 1) return null;
  return key.slice(idx + 1);
}

async function getStaleEventIds(): Promise<{ stale: Set<number>; live: Set<number> }> {
  const rows = await db
    .select({ eventId: events.eventId, openDate: events.openDate })
    .from(events);

  const cutoffMs = Date.now() - STALE_EVENT_DAYS * 24 * 60 * 60 * 1000;
  const stale = new Set<number>();
  const live = new Set<number>();

  for (const r of rows) {
    const ts = r.openDate ? new Date(r.openDate).getTime() : null;
    if (ts !== null && ts < cutoffMs) {
      stale.add(r.eventId);
    } else {
      live.add(r.eventId);
    }
  }

  return { stale, live };
}

async function getMarketToEventMap(): Promise<Map<string, number>> {
  const rows = await db
    .select({ marketId: marketSettings.marketId, eventId: marketSettings.eventId })
    .from(marketSettings);
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.marketId, r.eventId);
  return map;
}

async function delInBatches(keys: string[]): Promise<number> {
  if (keys.length === 0) return 0;
  let deleted = 0;
  for (let i = 0; i < keys.length; i += 200) {
    const slice = keys.slice(i, i + 200);
    deleted += await redis.del(slice);
  }
  return deleted;
}

async function trimOddsStream(): Promise<number> {
  const len = await redis.xLen(STREAM_KEY).catch(() => 0);
  if (len > STREAM_MAX_LEN) {
    await redis.xTrim(STREAM_KEY, "MAXLEN", STREAM_MAX_LEN);
    return len - STREAM_MAX_LEN;
  }
  return 0;
}

async function pruneEventScopedKeys(
  pattern: string,
  liveEvents: Set<number>,
  resolveEventId: (key: string) => number | null
): Promise<number> {
  const keys = await scanKeys(pattern);
  const toDelete: string[] = [];
  for (const key of keys) {
    const eid = resolveEventId(key);
    if (eid === null) continue;
    if (!liveEvents.has(eid)) toDelete.push(key);
  }
  return delInBatches(toDelete);
}

export const RedisGCService = {
  /**
   * Single GC pass. Safe to call manually. Returns a summary.
   */
  async runOnce() {
    if (!redisIsHealthy()) {
      console.warn("[RedisGC] Redis not healthy, skipping");
      return { skipped: true };
    }

    const startedAt = Date.now();

    const trimmed = await trimOddsStream().catch((e) => {
      console.warn("[RedisGC] stream trim failed:", (e as Error).message);
      return 0;
    });

    const { live } = await getStaleEventIds();
    const marketToEvent = await getMarketToEventMap();

    const eventOverrides = await pruneEventScopedKeys(
      "admin:event:*",
      live,
      (key) => {
        const id = extractIdFromKey(key);
        if (!id) return null;
        const n = Number(id);
        return Number.isFinite(n) ? n : null;
      }
    );

    const resolveByMarket = (key: string): number | null => {
      const marketId = extractIdFromKey(key);
      if (!marketId) return null;
      return marketToEvent.get(marketId) ?? null;
    };

    const marketOverrides = await pruneEventScopedKeys("admin:market:*", live, resolveByMarket);
    const customBallRunning = await pruneEventScopedKeys("custom:ballrunning:*", live, resolveByMarket);
    const customOdds = await pruneEventScopedKeys("custom:odds:*", live, resolveByMarket);

    const customMarketSets = await pruneEventScopedKeys("custom:markets:*", live, (key) => {
      const id = extractIdFromKey(key);
      if (!id) return null;
      const n = Number(id);
      return Number.isFinite(n) ? n : null;
    });

    const elapsedMs = Date.now() - startedAt;
    const summary = {
      trimmedStreamEntries: trimmed,
      deletedAdminEventKeys: eventOverrides,
      deletedAdminMarketKeys: marketOverrides,
      deletedCustomMarketsSets: customMarketSets,
      deletedCustomBallRunning: customBallRunning,
      deletedCustomOdds: customOdds,
      elapsedMs,
    };
    console.log("[RedisGC] Pass complete:", summary);
    return summary;
  },

  /**
   * Schedule the GC to run every 30 minutes. Also runs once shortly after
   * startup so a freshly-booted instance starts cleaning immediately.
   */
  start() {
    setTimeout(() => {
      this.runOnce().catch((e) =>
        console.error("[RedisGC] Initial pass failed:", (e as Error).message)
      );
    }, 60_000);

    cron.schedule("*/30 * * * *", () => {
      this.runOnce().catch((e) =>
        console.error("[RedisGC] Scheduled pass failed:", (e as Error).message)
      );
    });

    console.log("[RedisGC] Scheduled every 30 minutes");
  },

  OVERRIDE_TTL_SECONDS,
};
