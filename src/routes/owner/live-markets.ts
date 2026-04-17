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

  // GET /owner/live-markets/bets?matchId=123
  .get("/bets", async ({ set, store, query }) => {
    try {
      const userId = (store as { id: string }).id;
      const userRole = (store as { role: number }).role;
      const matchId = query.matchId ? parseInt(query.matchId as string) : null;

      if (!matchId) {
        set.status = 400;
        return { success: false, error: "matchId is required" };
      }

      const result = await db.execute(sql`
        SELECT
          t.id,
          t.match_id,
          t.market_id,
          t.market_name,
          t.market_type,
          t.selection_id,
          t.selection_name,
          t.bet_type,
          t.stake,
          t.odds,
          t.status,
          t.settled_amount,
          t.matched_at,
          t.ip_address,
          -- Bettor
          u.username   AS user_name,
          u.id         AS user_id,
          -- Whitelabel
          wl.name      AS whitelabel_name,
          -- Event / Competition
          e.name       AS event_name,
          c.name       AS competition_name,
          -- User-selection detail (potential return for this bet)
          td.potential_return,
          td.run,
          -- Commission hierarchy (percents are cumulative from bottom)
          tc.agent_id,   tc.agent_percent,
          tc.master_id,  tc.master_percent,
          tc.super_id,   tc.super_percent,
          tc.admin_id,   tc.admin_percent,
          tc.owner_id,   tc.owner_percent,
          -- Hierarchy usernames
          ua.username    AS agent_name,
          um.username    AS master_name,
          us.username    AS super_name,
          uadm.username  AS admin_name,
          uo.username    AS owner_name
        FROM transactions t
        JOIN users u
          ON u.id = t.user_id
        JOIN transaction_commissions tc
          ON tc.transaction_id = t.id
         AND COALESCE(tc.record_status, 0) = 0
        LEFT JOIN transaction_details td
          ON td.transaction_id = t.id
         AND td.is_user_selection = TRUE
         AND COALESCE(td.record_status, 0) = 0
        LEFT JOIN whitelabels wl  ON wl.id  = t.whitelabel_id
        LEFT JOIN events      e   ON e.event_id        = t.match_id
        LEFT JOIN competitions c  ON c.competition_id  = t.competition_id
        LEFT JOIN users ua   ON ua.id   = tc.agent_id
        LEFT JOIN users um   ON um.id   = tc.master_id
        LEFT JOIN users us   ON us.id   = tc.super_id
        LEFT JOIN users uadm ON uadm.id = tc.admin_id
        LEFT JOIN users uo   ON uo.id   = tc.owner_id
        WHERE t.match_id = ${matchId}
          AND t.status IN ('pending', 'matched')
          AND COALESCE(t.record_status, 0) = 0
          AND (CASE
                WHEN ${userRole} = 0 THEN tc.owner_id  = ${userId}::uuid
                WHEN ${userRole} = 3 THEN tc.admin_id  = ${userId}::uuid
                WHEN ${userRole} = 4 THEN tc.super_id  = ${userId}::uuid
                WHEN ${userRole} = 5 THEN tc.master_id = ${userId}::uuid
                WHEN ${userRole} = 6 THEN tc.agent_id  = ${userId}::uuid
                ELSE 1 <> 1
               END)
        ORDER BY t.matched_at DESC
        LIMIT 500
      `);

      const rows = Array.isArray(result) ? result : (result as any)?.rows ?? [];
      return { success: true, data: rows };
    } catch (error) {
      console.error("live-markets/bets error:", error);
      set.status = 500;
      return { success: false, error: "Failed to fetch bets" };
    }
  })

  // GET /owner/live-markets/bets/log?transactionId=<uuid>
  // Returns the transaction_logs row attached to a single matched bet (one per txn).
  .get("/bets/log", async ({ set, query }) => {
    try {
      const transactionId = query.transactionId as string | undefined;
      if (!transactionId) {
        set.status = 400;
        return { success: false, error: "transactionId is required" };
      }

      const result = await db.execute(sql`
        SELECT
          id,
          transaction_id,
          ip_address,
          user_agent,
          browser,
          browser_version,
          os,
          os_version,
          device_type,
          device_brand,
          device_model,
          country,
          city,
          added_date
        FROM transaction_logs
        WHERE transaction_id = ${transactionId}::uuid
          AND COALESCE(record_status, 0) = 0
        ORDER BY added_date DESC
        LIMIT 1
      `);

      const rows = Array.isArray(result) ? result : (result as any)?.rows ?? [];
      return { success: true, data: rows[0] ?? null };
    } catch (error) {
      console.error("live-markets/bets/log error:", error);
      set.status = 500;
      return { success: false, error: "Failed to fetch transaction log" };
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
        WITH
        -- All non-fancy runner rows (per runner, no aggregation)
        non_fancy_pnl AS (
          SELECT h.market_id, h.runner_id, h.runner_profit AS pnl
          FROM public.get_hissa_of_group(${userId}::uuid, NULL::numeric, ${userRole}::int) h
        ),
        -- Fancy markets
        fancy_pnl AS (
          SELECT h.market_id, NULL::bigint AS runner_id, h.runner_profit AS pnl
          FROM public.get_hissa_of_group_fancy(${userId}::uuid, NULL::numeric, ${userRole}::int) h
        ),
        all_pnl AS (
          SELECT market_id, runner_id, pnl FROM non_fancy_pnl
          UNION ALL
          SELECT market_id, runner_id, pnl FROM fancy_pnl
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
        ),
        -- Runner names from transaction_details (joined to transactions for market_id)
        runner_names AS (
          SELECT DISTINCT ON (t.market_id, td.runner_id)
            t.market_id, td.runner_id, td.runner_name
          FROM transaction_details td
          JOIN transactions t ON t.id = td.transaction_id
          WHERE t.status = 'matched'
            AND COALESCE(t.record_status, 0) = 0
            AND COALESCE(td.record_status, 0) = 0
            AND td.runner_name IS NOT NULL
            AND td.runner_name <> ''
          ORDER BY t.market_id, td.runner_id
        )
        SELECT
          p.market_id,
          p.runner_id,
          p.pnl,
          r.runner_name,
          m.event_type_id,
          m.match_id,
          m.market_name,
          m.market_type,
          m.competition_id,
          COALESCE(m.event_name, mt.team_names) AS event_name,
          m.competition_name
        FROM all_pnl p
        LEFT JOIN market_meta  m  ON m.market_id  = p.market_id
        LEFT JOIN runner_names r  ON r.market_id  = p.market_id
                                 AND r.runner_id  = p.runner_id
        LEFT JOIN match_teams  mt ON mt.match_id  = m.match_id
        ORDER BY m.match_id NULLS LAST, p.market_id, p.runner_id NULLS LAST
      `);

      const rows = Array.isArray(result) ? result : (result as any)?.rows ?? [];
      return { success: true, data: rows };
    } catch (error) {
      console.error("live-markets/summary error:", error);
      set.status = 500;
      return { success: false, error: "Failed to fetch P&L summary" };
    }
  });
