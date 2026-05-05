import { Elysia } from "elysia";
import { db } from "@db/index";
import { sql } from "drizzle-orm";

export const liveMarketsRoutes = new Elysia({ prefix: "/live-markets" })

  // GET /owner/live-markets/details
  .get("/details", async ({ set, userId, userRole }: any) => {
    try {

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
  .get("/pnl", async ({ set, userId, userRole }: any) => {
    try {

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
  .get("/bets", async ({ set, userId, userRole, query }: any) => {
    try {
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
  // Returns one row per (market, runner) with the logged-in owner's P&L share
  // plus the event / competition / runner meta the UI groups on. All logic
  // lives in the SQL function fn_get_live_markets_summary, which wraps the
  // existing helpers get_hissa_of_group + get_hissa_of_group_fancy.
  .get("/summary", async ({ set, userId, userRole }: any) => {
    try {

      const result = await db.execute(sql`
        SELECT * FROM fn_get_live_markets_summary(
          ${userId}::uuid,
          ${userRole}::int
        )
      `);

      const rows = Array.isArray(result) ? result : (result as any)?.rows ?? [];
      return { success: true, data: rows };
    } catch (error) {
      console.error("live-markets/summary error:", error);
      set.status = 500;
      return { success: false, error: "Failed to fetch P&L summary" };
    }
  });
