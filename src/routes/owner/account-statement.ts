import { Elysia } from "elysia";
import { sql } from "drizzle-orm";
import { whitelabel_middleware } from "../../middleware/whitelabel";
import { DbType } from "../../types";
import { UserRole } from "../../types/enums";

/** Capital account — all owner vouchers flow through this system user. */
const CAPITAL_ACCOUNT_ID = "00000000-0000-0000-0000-000000000001";

export const ownerAccountStatementRoutes = new Elysia()
  .resolve(async ({ request }): Promise<{ db: DbType; whitelabel: any; dbError?: string }> => {
    const { db, whitelabel, dbError } = await whitelabel_middleware(request);
    return { db: db as DbType, whitelabel, dbError };
  })
  .onBeforeHandle(({ dbError, set }: any) => {
    if (dbError === "DATABASE_NOT_FOUND") {
      set.status = 503;
      return { success: false, error: "DATABASE_NOT_FOUND" };
    }
  })

  // GET /owner/account-statement?fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD
  .get("/account-statement", async ({ query, set, store, db }: any) => {
    const today    = new Date().toISOString().split("T")[0];
    const fromDate = (query.fromDate as string) || today;
    const toDate   = (query.toDate   as string) || today;

    // Owner uses the capital account; all other roles use their own ID
    const userId = (store.role as number) === UserRole.Owner
      ? CAPITAL_ACCOUNT_ID
      : (store.id as string);

    try {
      const result = await db.execute(sql`
        SELECT
          s.*,
          ou.username    AS opposite_username,
          wl.name        AS whitelabel_name,
          mr.winner_name,
          mr.runs        AS winner_runs,
          mr.market_type AS result_market_type
        FROM get_user_account_ledger_statement(
          ${userId}::uuid, ${fromDate}::date, ${toDate}::date
        ) s
        LEFT JOIN users          ou ON ou.id          = s.opposite_user_id
        LEFT JOIN whitelabels    wl ON wl.id          = s.whitelabel_id
        LEFT JOIN market_results mr ON mr.market_id   = s.market_id
                                    AND mr.record_status = 0
      `);

      const rows = Array.isArray(result)
        ? result
        : Array.isArray((result as any).rows)
          ? (result as any).rows
          : Array.from(result as any);

      set.status = 200;
      return { success: true, data: { transactions: rows } };
    } catch (error: any) {
      set.status = 500;
      return { success: false, error: error?.message || "Failed to fetch account statement" };
    }
  })

  // GET /owner/account-statement/bet-details?marketId=...
  .get("/account-statement/bet-details", async ({ query, set, store, db }: any) => {
    const marketId = query.marketId as string;
    if (!marketId) {
      set.status = 400;
      return { success: false, error: "marketId is required" };
    }

    const userId = (store.role as number) === UserRole.Owner
      ? CAPITAL_ACCOUNT_ID
      : (store.id as string);

    try {
      const result = await db.execute(sql`
        SELECT
          td.id,
          td.user_id,
          td.market_id,
          td.market_name,
          td.market_type,
          td.match_id,
          td.selection_id,
          td.selection_name,
          td.bet_type,
          td.stake,
          td.odds,
          td.status,
          td.settled_amount,
          td.added_date,
          td.settled_at,
          tdd.id               AS detail_id,
          tdd.runner_id,
          tdd.runner_name,
          tdd.is_user_selection,
          tdd.bet_type         AS detail_bet_type,
          tdd.price,
          tdd.run,
          tdd.stake            AS detail_stake,
          tdd.potential_return
        FROM transactions_declare td
        LEFT JOIN transaction_details_declare tdd
          ON tdd.transaction_id = td.id
         AND tdd.record_status  = 0
        WHERE td.user_id       = ${userId}::uuid
          AND td.market_id     = ${marketId}::numeric
          AND td.record_status = 0
        ORDER BY td.added_date DESC, tdd.is_user_selection DESC
      `);

      const rows = Array.isArray(result)
        ? result
        : Array.isArray((result as any).rows)
          ? (result as any).rows
          : Array.from(result as any);

      const betsMap: Record<string, any> = {};
      for (const row of rows) {
        if (!betsMap[row.id]) {
          betsMap[row.id] = {
            id:            row.id,
            userId:        row.user_id,
            marketId:      row.market_id,
            marketName:    row.market_name,
            selectionId:   row.selection_id,
            selectionName: row.selection_name,
            betType:       row.bet_type,
            stake:         row.stake,
            odds:          row.odds,
            status:        row.status,
            settledAmount: row.settled_amount,
            addedDate:     row.added_date,
            settledAt:     row.settled_at,
            details:       [],
          };
        }
        if (row.detail_id) {
          betsMap[row.id].details.push({
            id:              row.detail_id,
            runnerId:        row.runner_id,
            runnerName:      row.runner_name,
            isUserSelection: row.is_user_selection,
            betType:         row.detail_bet_type,
            price:           row.price,
            run:             row.run,
            stake:           row.detail_stake,
            potentialReturn: row.potential_return,
          });
        }
      }

      set.status = 200;
      return { success: true, data: { bets: Object.values(betsMap) } };
    } catch (error: any) {
      set.status = 500;
      return { success: false, error: error?.message || "Failed to fetch bet details" };
    }
  });
