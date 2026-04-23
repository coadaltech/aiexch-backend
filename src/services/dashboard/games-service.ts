import { db } from "@db/index";
import { competitions, sports, competitionWhitelabelOverrides, events, eventWhitelabelOverrides } from "@db/schema";
import { redis } from "@db/redis";
import { eq, and, sql } from "drizzle-orm";
import { UserRole } from "../../types/enums";
import { syncEventsForCompetition, deactivateEventsForCompetition } from "../event-sync-service";
import { CacheService } from "../cache";
import { broadcastChange } from "../sports-broadcast";

export const getCompetitionsBySportId = async (sportId: string) => {
  try {
    console.log("kese", sportId);
    // const cacheKey = `dashboard-competitions:${sportId}`;

    // // 1️⃣ Check Redis cache
    // const cached = await redis.get(cacheKey);

    // if (cached) {
    //   console.log("✅ Returning cached competition data", cached);
    //   return JSON.parse(cached);
    // }

    console.log("🔄 Fetching competitions from database...");

    // 2️⃣ Fetch from DB
    const competitionData = await db
      .select()
      .from(competitions)
      .where(eq(competitions.sport_id, Number(sportId)));

    console.log(
      `✅ Found ${competitionData.length} competitions for ${sportId}`,
    );

    // 3️⃣ Cache result (5 min)
    // await redis.set(cacheKey, JSON.stringify(competitionData), {
    //   EX: 300,
    // });

    return competitionData;
  } catch (error) {
    console.error("❌ Error fetching competitions:", error);
    return [];
  }
};
// Add this function to your games-service.ts file
// games-service.ts
export const updateCompetitionsStatus = async (
  sportId: string,
  updates: Array<{ id: string; isActive: boolean }>,
) => {
  try {
    console.log(
      `🔄 Updating ${updates.length} competition statuses for sport:`,
      sportId,updates
    );

    if (updates.length === 0) {
      return { success: true, message: "No updates to process" };
    }

    // Update database
    await db.transaction(async (tx) => {
      for (const update of updates) {
        const competitionId = parseInt(update.id, 10);

        await tx
          .update(competitions)
          .set({ is_active: update.isActive })
          .where(eq(competitions.competition_id, Number(update.id))); // ✅ competition_id use karo
      }
    });

    // Sync/deactivate events for toggled competitions (fire-and-forget)
    for (const update of updates) {
      const competitionId = parseInt(update.id, 10);
      if (update.isActive) {
        // Competition activated → sync its events from external API
        syncEventsForCompetition(competitionId, Number(sportId)).catch((err) =>
          console.error(`[EventSync] Background sync failed for ${competitionId}:`, err),
        );
      } else {
        // Competition deactivated → deactivate its events
        deactivateEventsForCompetition(competitionId).catch((err) =>
          console.error(`[EventSync] Background deactivate failed for ${competitionId}:`, err),
        );
      }
    }

    // Clear cache (best-effort — don't fail the whole operation if Redis is down)
    try {
      await redis.del(`series:${sportId}`);
      await redis.del(`dashboard-competitions:${sportId}`);
      await redis.del(`sports:seriesWithMatches:${sportId}`);
      // Also clear whitelabel-specific series cache keys (series:{sportId}:{whitelabelId})
      await CacheService.invalidatePattern(`series:${sportId}:*`);
      await CacheService.invalidatePattern(`sports:seriesWithMatches:${sportId}:*`);
      console.log(`✅ Cleared cache for sport: ${sportId}`);
    } catch (cacheError) {
      console.error("⚠️ Failed to clear cache (non-fatal):", cacheError);
    }

    // A competition's active state feeds the sidebar "top competitions" list
    // (which only shows active ones), so nudge any open tabs to refetch.
    broadcastChange("top-competitions");

    return {
      success: true,
      message: `Updated ${updates.length} competition(s) successfully`,
    };
  } catch (error) {
    console.error("❌ Error updating competition statuses:", error);
    return {
      success: false,
      message: "Failed to update competition statuses",
    };
  }
};

/**
 * Fetch competitions with per-whitelabel override status.
 * - Owner: returns ALL competitions; if whitelabelId provided, includes override status.
 * - Non-owner: returns only globally active competitions, excluding those overridden inactive for the whitelabel.
 */
export const getCompetitionsWithOverrides = async (
  sportId: string,
  role: number,
  whitelabelId: string | null,
) => {
  try {
    const sportIdNum = Number(sportId);
    const isOwner = role === UserRole.Owner;

    // Base query: all competitions for the sport with optional left join on overrides
    if (whitelabelId) {
      const rows = await db
        .select({
          id: competitions.id,
          competition_id: competitions.competition_id,
          sport_id: competitions.sport_id,
          name: competitions.name,
          provider: competitions.provider,
          is_active: competitions.is_active,
          is_top_competition: competitions.is_top_competition,
          is_archived: competitions.is_archived,
          metadata: competitions.metadata,
          whitelabelActive: competitionWhitelabelOverrides.isActive,
        })
        .from(competitions)
        .leftJoin(
          competitionWhitelabelOverrides,
          and(
            eq(competitionWhitelabelOverrides.competitionId, competitions.competition_id),
            eq(competitionWhitelabelOverrides.whitelabelId, whitelabelId),
          ),
        )
        .where(eq(competitions.sport_id, sportIdNum));

      // For owner: return all rows with override info
      // For non-owner: return all globally active competitions (including those overridden
      // to inactive, so the admin can toggle them back on in their panel)
      const filtered = isOwner
        ? rows
        : rows.filter((r) => r.is_active);

      return filtered.map((r) => ({
        ...r,
        // whitelabelActive: null means no override (defaults to true), otherwise use the override value
        whitelabelActive: r.whitelabelActive ?? true,
      }));
    }

    // No whitelabel context
    const rows = await db
      .select()
      .from(competitions)
      .where(eq(competitions.sport_id, sportIdNum));

    if (isOwner) {
      return rows.map((r) => ({ ...r, whitelabelActive: true }));
    }
    // Non-owner without whitelabel: only globally active
    return rows.filter((r) => r.is_active).map((r) => ({ ...r, whitelabelActive: true }));
  } catch (error) {
    console.error("Error fetching competitions with overrides:", error);
    return [];
  }
};

/**
 * Upsert per-whitelabel competition overrides.
 * Only sets the override is_active flag; does NOT touch global competitions.is_active.
 */
export const upsertCompetitionWhitelabelOverrides = async (
  sportId: string,
  whitelabelId: string,
  updates: Array<{ id: string; isActive: boolean }>,
  userId: string,
) => {
  try {
    if (updates.length === 0) {
      return { success: true, message: "No updates to process" };
    }

    await db.transaction(async (tx) => {
      for (const update of updates) {
        const competitionId = Number(update.id);

        // Check that the competition is globally active — cannot override an inactive competition
        const [comp] = await tx
          .select({ is_active: competitions.is_active })
          .from(competitions)
          .where(eq(competitions.competition_id, competitionId))
          .limit(1);

        if (!comp || !comp.is_active) continue; // skip globally inactive

        // Upsert: insert or update the override
        await tx
          .insert(competitionWhitelabelOverrides)
          .values({
            competitionId,
            whitelabelId,
            isActive: update.isActive,
            addedBy: userId,
            updateBy: userId,
          })
          .onConflictDoUpdate({
            target: [competitionWhitelabelOverrides.competitionId, competitionWhitelabelOverrides.whitelabelId],
            set: {
              isActive: update.isActive,
              updateBy: userId,
            },
          });
      }
    });

    // Clear cache
    try {
      await redis.del(`series:${sportId}`);
      await redis.del(`dashboard-competitions:${sportId}`);
      await redis.del(`sports:seriesWithMatches:${sportId}`);
      await CacheService.invalidatePattern(`series:${sportId}:*`);
      await CacheService.invalidatePattern(`sports:seriesWithMatches:${sportId}:*`);
    } catch (_) { /* non-fatal */ }

    return { success: true, message: `Updated ${updates.length} override(s) successfully` };
  } catch (error) {
    console.error("Error upserting competition whitelabel overrides:", error);
    return { success: false, message: "Failed to update overrides" };
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
//  EVENT-LEVEL MANAGEMENT (mirrors competition logic)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fetch events for a competition with per-whitelabel override status.
 * - Owner: returns ALL events; if whitelabelId provided, includes override status.
 * - Non-owner: returns only globally active events, excluding those overridden inactive.
 */
export const getEventsWithOverrides = async (
  competitionId: string,
  role: number,
  whitelabelId: string | null,
) => {
  try {
    const compIdNum = Number(competitionId);
    const isOwner = role === UserRole.Owner;

    if (whitelabelId) {
      const rows = await db
        .select({
          id: events.id,
          eventId: events.eventId,
          competitionId: events.competitionId,
          sportId: events.sportId,
          name: events.name,
          openDate: events.openDate,
          isActive: events.isActive,
          isVisible: events.isVisible,
          isRecommended: events.isRecommended,
          suspended: events.suspended,
          defaultMarketId: events.defaultMarketId,
          metadata: events.metadata,
          whitelabelActive: eventWhitelabelOverrides.isActive,
        })
        .from(events)
        .leftJoin(
          eventWhitelabelOverrides,
          and(
            eq(eventWhitelabelOverrides.eventId, events.eventId),
            eq(eventWhitelabelOverrides.whitelabelId, whitelabelId),
          ),
        )
        .where(eq(events.competitionId, compIdNum));

      // For owner: return all rows
      // For non-owner: return all globally active events (including those overridden
      // to inactive, so the admin can toggle them back on in their panel)
      const filtered = isOwner
        ? rows
        : rows.filter((r) => r.isActive);

      return filtered.map((r) => ({
        ...r,
        whitelabelActive: r.whitelabelActive ?? true,
      }));
    }

    // No whitelabel context
    const rows = await db
      .select()
      .from(events)
      .where(eq(events.competitionId, compIdNum));

    if (isOwner) {
      return rows.map((r) => ({ ...r, whitelabelActive: true }));
    }
    return rows.filter((r) => r.isActive).map((r) => ({ ...r, whitelabelActive: true }));
  } catch (error) {
    console.error("Error fetching events with overrides:", error);
    return [];
  }
};

/**
 * Update global is_active for events (Owner only).
 */
export const updateEventsStatus = async (
  competitionId: string,
  updates: Array<{ id: string; isActive: boolean }>,
) => {
  try {
    if (updates.length === 0) {
      return { success: true, message: "No updates to process" };
    }

    await db.transaction(async (tx) => {
      for (const update of updates) {
        await tx
          .update(events)
          .set({ isActive: update.isActive })
          .where(eq(events.eventId, Number(update.id)));
      }
    });

    // Clear cache
    try {
      const comp = await db
        .select({ sport_id: competitions.sport_id })
        .from(competitions)
        .where(eq(competitions.competition_id, Number(competitionId)))
        .limit(1);
      if (comp[0]) {
        const sportId = comp[0].sport_id;
        await redis.del(`series:${sportId}`);
        await redis.del(`dashboard-competitions:${sportId}`);
        await redis.del(`sports:seriesWithMatches:${sportId}`);
        await CacheService.invalidatePattern(`series:${sportId}:*`);
        await CacheService.invalidatePattern(`sports:seriesWithMatches:${sportId}:*`);
      }
    } catch (_) { /* non-fatal */ }

    // Recommended-events feed hides inactive events, so changes here may
    // affect the sidebar — notify open tabs to refetch.
    broadcastChange("recommended-events");

    return { success: true, message: `Updated ${updates.length} event(s) successfully` };
  } catch (error) {
    console.error("Error updating event statuses:", error);
    return { success: false, message: "Failed to update event statuses" };
  }
};

/**
 * Upsert per-whitelabel event overrides (Admin only).
 */
export const upsertEventWhitelabelOverrides = async (
  competitionId: string,
  whitelabelId: string,
  updates: Array<{ id: string; isActive: boolean }>,
  userId: string,
) => {
  try {
    if (updates.length === 0) {
      return { success: true, message: "No updates to process" };
    }

    await db.transaction(async (tx) => {
      for (const update of updates) {
        const eventId = Number(update.id);

        // Only override globally active events
        const [evt] = await tx
          .select({ isActive: events.isActive })
          .from(events)
          .where(eq(events.eventId, eventId))
          .limit(1);

        if (!evt || !evt.isActive) continue;

        await tx
          .insert(eventWhitelabelOverrides)
          .values({
            eventId,
            whitelabelId,
            isActive: update.isActive,
            addedBy: userId,
            updateBy: userId,
          })
          .onConflictDoUpdate({
            target: [eventWhitelabelOverrides.eventId, eventWhitelabelOverrides.whitelabelId],
            set: {
              isActive: update.isActive,
              updateBy: userId,
            },
          });
      }
    });

    // Clear cache
    try {
      const comp = await db
        .select({ sport_id: competitions.sport_id })
        .from(competitions)
        .where(eq(competitions.competition_id, Number(competitionId)))
        .limit(1);
      if (comp[0]) {
        const sportId = comp[0].sport_id;
        await redis.del(`series:${sportId}`);
        await redis.del(`dashboard-competitions:${sportId}`);
        await redis.del(`sports:seriesWithMatches:${sportId}`);
        await CacheService.invalidatePattern(`series:${sportId}:*`);
        await CacheService.invalidatePattern(`sports:seriesWithMatches:${sportId}:*`);
      }
    } catch (_) { /* non-fatal */ }

    return { success: true, message: `Updated ${updates.length} event override(s) successfully` };
  } catch (error) {
    console.error("Error upserting event whitelabel overrides:", error);
    return { success: false, message: "Failed to update event overrides" };
  }
};