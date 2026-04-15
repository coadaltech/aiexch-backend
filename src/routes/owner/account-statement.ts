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
        WITH all_txn AS (
          -- Path A: user appears as voucher_detail owner (settlement P&L, deposits, etc.)
          SELECT
            vd.voucher_id,
            v.type        AS voucher_type,
            v.status,
            v.method,
            v.reference,
            v.market_id,
            v.event_id,
            vd.description,
            v.remarks, v.remarks1, v.remarks2, v.remarks3,
            vd.dr_cr,
            vd.amount,
            COALESCE(vd.voucher_date, v.voucher_date, v.added_date::date) AS voucher_date,
            v.added_date
          FROM voucher_details vd
          INNER JOIN vouchers v ON v.id = vd.voucher_id AND v.record_status = 0
          WHERE vd.user_id      = ${userId}::uuid
            AND vd.record_status = 0

          UNION

          -- Path B: user owns the voucher header (limit vouchers, etc.)
          SELECT
            v.id          AS voucher_id,
            v.type        AS voucher_type,
            v.status,
            v.method,
            v.reference,
            v.market_id,
            v.event_id,
            vd.description,
            v.remarks, v.remarks1, v.remarks2, v.remarks3,
            vd.dr_cr,
            vd.amount,
            COALESCE(vd.voucher_date, v.voucher_date, v.added_date::date) AS voucher_date,
            v.added_date
          FROM vouchers v
          INNER JOIN voucher_details vd ON vd.voucher_id = v.id AND vd.record_status = 0
          WHERE v.user_id      = ${userId}::uuid
            AND v.record_status = 0
        ),
        bal AS (
          SELECT COALESCE(MAX(user_balance), 0) AS v
          FROM ledger_limit
          WHERE user_id = ${userId}::uuid AND record_status = 0
        ),
        ob AS (
          SELECT b.v - COALESCE(SUM(CASE WHEN t.dr_cr = 1 THEN t.amount ELSE -t.amount END), 0) AS amount
          FROM bal b
          LEFT JOIN all_txn t ON t.voucher_date < ${fromDate}::date
          GROUP BY b.v
        ),
        cb AS (
          SELECT b.v - COALESCE(SUM(CASE WHEN t.dr_cr = 1 THEN t.amount ELSE -t.amount END), 0) AS amount
          FROM bal b
          LEFT JOIN all_txn t ON t.voucher_date <= ${toDate}::date
          GROUP BY b.v
        )
        SELECT
          0                  AS orderflag,
          NULL::uuid         AS voucher_id,
          NULL::int          AS voucher_type,
          NULL::int          AS status,
          NULL::varchar      AS method,
          NULL::varchar      AS reference,
          NULL::numeric      AS market_id,
          NULL::bigint       AS event_id,
          NULL::varchar      AS description,
          NULL::varchar      AS remarks,
          NULL::varchar      AS remarks1,
          NULL::varchar      AS remarks2,
          NULL::varchar      AS remarks3,
          o.amount           AS credit,
          0::numeric         AS debit,
          ${fromDate}::date  AS voucher_date,
          NULL::timestamptz  AS added_date
        FROM ob o

        UNION ALL

        SELECT
          1                  AS orderflag,
          t.voucher_id,
          t.voucher_type,
          t.status,
          t.method::varchar,
          t.reference::varchar,
          t.market_id,
          t.event_id,
          t.description::varchar,
          t.remarks::varchar,
          t.remarks1::varchar,
          t.remarks2::varchar,
          t.remarks3::varchar,
          CASE WHEN t.dr_cr = 1 AND t.amount >= 0 THEN t.amount ELSE 0 END AS credit,
          CASE WHEN t.dr_cr = 0 OR t.amount < 0  THEN ABS(t.amount) ELSE 0 END AS debit,
          t.voucher_date,
          t.added_date
        FROM all_txn t
        WHERE t.voucher_date BETWEEN ${fromDate}::date AND ${toDate}::date

        UNION ALL

        SELECT
          2                  AS orderflag,
          NULL::uuid,
          NULL::int,
          NULL::int,
          NULL::varchar,
          NULL::varchar,
          NULL::numeric,
          NULL::bigint,
          NULL::varchar,
          NULL::varchar,
          NULL::varchar,
          NULL::varchar,
          NULL::varchar,
          c.amount           AS credit,
          0::numeric         AS debit,
          ${toDate}::date    AS voucher_date,
          NULL::timestamptz  AS added_date
        FROM cb c

        ORDER BY orderflag, added_date DESC NULLS LAST, voucher_id DESC
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
