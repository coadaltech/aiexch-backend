import { db } from "@db/index";
import { competitions, sports, competitionWhitelabelOverrides } from "@db/schema";
import { redis } from "@db/redis";
import { eq, and, sql } from "drizzle-orm";
import { UserRole } from "../../types/enums";

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

    // Clear cache (best-effort — don't fail the whole operation if Redis is down)
    try {
      const seriesCacheKey = `series:${sportId}`;
      const competitionsCacheKey = `dashboard-competitions:${sportId}`;
      const seriesWithMatchesCacheKey = `series:withMatches:${sportId}`;
      await redis.del(seriesCacheKey);
      await redis.del(competitionsCacheKey);
      await redis.del(seriesWithMatchesCacheKey);
      console.log(`✅ Cleared cache for sport: ${sportId}`);
    } catch (cacheError) {
      console.error("⚠️ Failed to clear cache (non-fatal):", cacheError);
    }

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
      // For non-owner: only globally active AND not overridden to inactive
      const filtered = isOwner
        ? rows
        : rows.filter((r) => r.is_active && (r.whitelabelActive === null || r.whitelabelActive === true));

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
      await redis.del(`series:withMatches:${sportId}`);
    } catch (_) { /* non-fatal */ }

    return { success: true, message: `Updated ${updates.length} override(s) successfully` };
  } catch (error) {
    console.error("Error upserting competition whitelabel overrides:", error);
    return { success: false, message: "Failed to update overrides" };
  }
};