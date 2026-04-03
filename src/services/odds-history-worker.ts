import cron from "node-cron";
import { redis, redisIsHealthy } from "@db/redis";
import { db } from "@db/index";
import { marketOddsHistory } from "@db/schema";
import { lt } from "drizzle-orm";

const BATCH_SIZE = 500;
const CONSUMER_GROUP = "history-workers";
const CONSUMER_NAME = `worker-${process.pid}`;
const STREAM_KEY = "stream:odds:history";
const RETENTION_DAYS = 7;

export class OddsHistoryWorker {
  private static initialized = false;

  static async init() {
    if (this.initialized) return;
    this.initialized = true;

    try {
      if (!redisIsHealthy()) {
        console.warn(
          "[OddsHistory] Redis not connected, worker will not start"
        );
        return;
      }

      // Create consumer group (ignore error if already exists)
      try {
        await redis.xGroupCreate(STREAM_KEY, CONSUMER_GROUP, "0", {
          MKSTREAM: true,
        });
        console.log(`[OddsHistory] Created consumer group ${CONSUMER_GROUP}`);
      } catch (e: any) {
        if (!e.message?.includes("BUSYGROUP")) {
          console.error("[OddsHistory] Error creating consumer group:", e);
        }
        // BUSYGROUP = already exists, which is fine
      }

      // Batch insert every 30 seconds
      cron.schedule("*/30 * * * * *", async () => {
        await this.processBatch();
      });

      // Retention cleanup: daily at 3 AM
      cron.schedule("0 3 * * *", async () => {
        await this.cleanupOldHistory();
      });

      console.log(
        "[OddsHistory] Worker started (30s batch insert, 7-day retention)"
      );
    } catch (e) {
      console.error("[OddsHistory] Failed to initialize:", e);
    }
  }

  private static async processBatch() {
    try {
      if (!redisIsHealthy()) return;

      // Read up to BATCH_SIZE entries from stream (non-blocking to avoid holding connection)
      const entries = await redis.xReadGroup(
        CONSUMER_GROUP,
        CONSUMER_NAME,
        [{ key: STREAM_KEY, id: ">" }],
        { COUNT: BATCH_SIZE, BLOCK: 2000 }
      );

      if (!entries || entries.length === 0) return;

      const streamEntries = entries[0]?.messages;
      if (!streamEntries || streamEntries.length === 0) return;

      // Build batch insert rows
      const rows = streamEntries
        .map((entry: any) => {
          try {
            return {
              marketId: String(entry.message.marketId),
              eventId: Number(entry.message.eventId),
              snapshot: JSON.parse(entry.message.snapshot),
              capturedAt: new Date(entry.message.capturedAt),
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      // Batch INSERT to database
      if (rows.length > 0) {
        await db.insert(marketOddsHistory).values(rows as any);
      }

      // ACK and DELETE processed entries to free memory
      const ids = streamEntries.map((e: any) => e.id);
      if (ids.length > 0) {
        await redis.xAck(STREAM_KEY, CONSUMER_GROUP, ids);
        await redis.xDel(STREAM_KEY, ids);
      }

      if (rows.length > 0) {
        console.log(
          `[OddsHistory] Batch inserted ${rows.length} odds history records`
        );
      }
    } catch (e) {
      console.error("[OddsHistory] Batch processing error:", e);
    }
  }

  private static async cleanupOldHistory() {
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

      await db
        .delete(marketOddsHistory)
        .where(lt(marketOddsHistory.capturedAt, cutoff));

      console.log(
        `[OddsHistory] Cleaned up odds history older than ${RETENTION_DAYS} days`
      );
    } catch (e) {
      console.error("[OddsHistory] Cleanup error:", e);
    }
  }
}
