import { Elysia } from "elysia";
import { db } from "@db/index";
import { sql } from "drizzle-orm";

export const liveMarketsRoutes = new Elysia({ prefix: "/live-markets" })

  // GET /owner/live-markets/details
  .get("/details", async ({ set, store }) => {
    try {
      const userId = (store as { id: string }).id;
      const userRole = (store as { role: number }).role;

      const result = await db.execute(
        sql`SELECT * FROM public.get_list_of_market_with_trans(${userId}::uuid, ${userRole}::int)`
      );

      const rows = Array.isArray(result) ? result : (result as any)?.rows ?? [];
      return { success: true, data: rows };
    } catch (error) {
      console.error("live-markets/details error:", error);
      set.status = 500;
      return { success: false, error: "Failed to fetch live markets" };
    }
  })

  // GET /owner/live-markets/pnl
  // Returns per-runner P&L for odds/bookmaker markets and per-market P&L for fancy.
  .get("/pnl", async ({ set, store }) => {
    try {
      const userId = (store as { id: string }).id;
      const userRole = (store as { role: number }).role;

      const [oddsResult, fancyResult] = await Promise.all([
        db.execute(
          sql`SELECT * FROM public.get_hissa_of_group(${userId}::uuid, NULL::numeric, ${userRole}::int)`
        ),
        db.execute(
          sql`SELECT * FROM public.get_hissa_of_group_fancy(${userId}::uuid, NULL::numeric, ${userRole}::int)`
        ),
      ]);

      const odds  = Array.isArray(oddsResult)  ? oddsResult  : (oddsResult  as any)?.rows ?? [];
      const fancy = Array.isArray(fancyResult) ? fancyResult : (fancyResult as any)?.rows ?? [];

      return { success: true, data: { odds, fancy } };
    } catch (error) {
      console.error("live-markets/pnl error:", error);
      set.status = 500;
      return { success: false, error: "Failed to fetch P&L" };
    }
  })

  // GET /owner/live-markets/summary
  // Returns per-market P&L for the logged-in user based on their commission share.
  // Uses get_hissa_of_group (non-fancy) and get_hissa_of_group_fancy.
  // P&L is worst-case (min runner scenario) for odds markets; worst-case run for fancy.
  .get("/summary", async ({ set, store }) => {
    try {
      const userId = (store as { id: string }).id;
      const userRole = (store as { role: number }).role;

      const result = await db.execute(sql`
        WITH non_fancy AS (
          SELECT h.market_id, MIN(h.runner_profit) AS pnl
          FROM public.get_hissa_of_group(${userId}::uuid, NULL::numeric, ${userRole}::int) h
          GROUP BY h.market_id
        ),
        fancy AS (
          SELECT h.market_id, h.runner_profit AS pnl
          FROM public.get_hissa_of_group_fancy(${userId}::uuid, NULL::numeric, ${userRole}::int) h
        ),
        all_pnl AS (
          SELECT market_id, pnl FROM non_fancy
          UNION ALL
          SELECT market_id, pnl FROM fancy
        ),
        market_meta AS (
          SELECT DISTINCT ON (t.market_id)
            t.market_id,
            t.event_type_id,
            t.match_id,
            t.market_name,
            t.market_type,
            t.competition_id,
            e.name  AS event_name,
            c.name  AS competition_name
          FROM transactions t
          LEFT JOIN events       e ON e.event_id        = t.match_id
          LEFT JOIN competitions c ON c.competition_id  = t.competition_id
          WHERE t.status = 'matched'
            AND COALESCE(t.record_status, 0) = 0
          ORDER BY t.market_id
        ),
        -- Aggregate all distinct team names from selection_name on Match Odds markets
        match_teams AS (
          SELECT
            match_id,
            string_agg(DISTINCT selection_name, ' v ') AS team_names
          FROM transactions
          WHERE market_type = 0
            AND selection_name IS NOT NULL
            AND selection_name <> ''
            AND COALESCE(record_status, 0) = 0
          GROUP BY match_id
        )
        SELECT
          p.market_id,
          p.pnl,
          m.event_type_id,
          m.match_id,
          m.market_name,
          m.market_type,
          m.competition_id,
          COALESCE(mt.team_names, m.event_name) AS event_name,
          m.competition_name
        FROM all_pnl p
        LEFT JOIN market_meta  m  ON m.market_id  = p.market_id
        LEFT JOIN match_teams  mt ON mt.match_id  = m.match_id
        ORDER BY m.match_id NULLS LAST, p.market_id
      `);

      const rows = Array.isArray(result) ? result : (result as any)?.rows ?? [];
      return { success: true, data: rows };
    } catch (error) {
      console.error("live-markets/summary error:", error);
      set.status = 500;
      return { success: false, error: "Failed to fetch P&L summary" };
    }
  });
