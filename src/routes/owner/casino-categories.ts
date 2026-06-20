import { Elysia, t } from "elysia";
import { db } from "../../db";
import { casinoPinnedCategories } from "../../db/schema";
import { eq } from "drizzle-orm";
import { SYSTEM_USER_ID } from "../../db/schema";
import { broadcastChange } from "../../services/sports-broadcast";

/**
 * Owner — casino lobby category pinning.
 *
 * The casino category catalogue (ROULETTE, LIVECASINO, …) is code-defined on the
 * frontend (lib/casino-categories.ts). Here the owner records which of those keys
 * are "pinned" so they surface in the site's top drop-header — same idea as
 * owner-pinned events/competitions.
 *
 *   GET  /owner/casino-categories         → { data: string[] }  (pinned keys)
 *   POST /owner/casino-categories/toggle  → pin / unpin one category
 */
export const casinoCategoriesRoutes = new Elysia({ prefix: "/casino-categories" })
  .get("/", async ({ set }) => {
    try {
      const rows = await db
        .select({ key: casinoPinnedCategories.categoryKey })
        .from(casinoPinnedCategories)
        .where(eq(casinoPinnedCategories.isPinned, true));
      set.status = 200;
      return { success: true, data: rows.map((r) => r.key) };
    } catch (error) {
      console.error("[OWNER-CASINO-CATEGORIES] list error:", error);
      set.status = 500;
      return { success: false, message: "Failed to fetch pinned categories" };
    }
  })

  .post(
    "/toggle",
    async ({ body, set }) => {
      try {
        const { key, pinned } = body as { key: string; pinned: boolean };
        const categoryKey = (key || "").trim().toUpperCase();
        if (!categoryKey) {
          set.status = 400;
          return { success: false, message: "key is required" };
        }

        // Upsert the pin state — one row per category key.
        await db
          .insert(casinoPinnedCategories)
          .values({ categoryKey, isPinned: pinned })
          .onConflictDoUpdate({
            target: casinoPinnedCategories.categoryKey,
            set: { isPinned: pinned, updateBy: SYSTEM_USER_ID, updateDate: new Date() },
          });

        // Live-refresh the drop-header on every connected client.
        broadcastChange("casino-categories");

        set.status = 200;
        return { success: true, data: { key: categoryKey, pinned } };
      } catch (error) {
        console.error("[OWNER-CASINO-CATEGORIES] toggle error:", error);
        set.status = 500;
        return { success: false, message: "Failed to update pinned category" };
      }
    },
    {
      body: t.Object({
        key: t.String(),
        pinned: t.Boolean(),
      }),
    },
  );
