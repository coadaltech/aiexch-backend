import { Elysia, t } from "elysia";
import { db } from "@db/index";
import { sql, and, eq, inArray } from "drizzle-orm";
import {
  transactions,
  transactionDetails,
  transactionCommissions,
  transactionsDeclare,
  transactionDetailsDeclare,
  transactionCommissionsDeclare,
} from "@db/schema";
import { RecordStatus } from "../../types/enums";
import { requirePermission } from "../../middleware/permissions";
import { AdminMarketService } from "@services/admin-market-service";

/**
 * Transaction Management (owner panel).
 *
 * Lets the owner (or permitted staff) revert a market that went wrong by
 * SOFT-DELETING the transactions that were placed on it — the rows stay in the
 * DB (record_status = Deleted) with a remark explaining why, so nothing is lost
 * and exposure is released by recomputing each affected user's limit.
 *
 * Flow: pick an event + market + time range → list matching transactions →
 * select the ones to revert → delete with a reason.
 *
 * Both the live tables (transactions / transaction_details) and the archived
 * tables (transactions_declare / transaction_details_declare, used after a
 * result is declared) are supported via the `source` switch.
 */

// Hierarchy scoping: a logged-in staff/owner may only touch transactions that
// roll up to them in the commission tree. Mirrors live-markets/bets.
function hierarchyCondition(
  commissions: any,
  userId: string,
  userRole: number
) {
  switch (userRole) {
    case 0:
      return eq(commissions.ownerId, userId);
    case 3:
      return eq(commissions.adminId, userId);
    case 4:
      return eq(commissions.superId, userId);
    case 5:
      return eq(commissions.masterId, userId);
    case 6:
      return eq(commissions.agentId, userId);
    default:
      return sql`1 <> 1`;
  }
}

export const transactionManagementRoutes = new Elysia({
  prefix: "/transaction-management",
})

  // ═══════════════════════════════════════════════════════════
  //  LIST — search transactions to revert
  //  GET /owner/transaction-management/transactions
  //      ?matchId=&marketId=&from=&to=&source=live|declare
  // ═══════════════════════════════════════════════════════════
  .get(
    "/transactions",
    async ({ query, set, userId, userRole }: any) => {
      try {
        const matchId = query.matchId ? parseInt(query.matchId) : null;
        const marketId = query.marketId || null;
        const source = query.source === "declare" ? "declare" : "live";

        // marketId is now OPTIONAL — when omitted we return every transaction
        // for the event in the time range and the UI filters by market.
        if (!matchId) {
          set.status = 400;
          return {
            success: false,
            error: "matchId is required",
          };
        }

        // The postgres driver can't bind a JS Date inside a raw sql template,
        // so pass ISO strings and cast to timestamp in SQL.
        const fromTs = query.from ? new Date(query.from).toISOString() : null;
        const toTs = query.to ? new Date(query.to).toISOString() : null;

        const tTable = source === "declare" ? "transactions_declare" : "transactions";
        const tdTable =
          source === "declare"
            ? "transaction_details_declare"
            : "transaction_details";
        const tcTable =
          source === "declare"
            ? "transaction_commissions_declare"
            : "transaction_commissions";

        // Scope column for the current role inside the commission table.
        const scopeCol =
          userRole === 0
            ? "owner_id"
            : userRole === 3
              ? "admin_id"
              : userRole === 4
                ? "super_id"
                : userRole === 5
                  ? "master_id"
                  : userRole === 6
                    ? "agent_id"
                    : null;

        if (!scopeCol) {
          return { success: true, data: [] };
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
            t.added_date,
            u.username    AS user_name,
            u.id          AS user_id,
            e.name        AS event_name,
            td.potential_return,
            td.run,
            td.remark     AS detail_remark
          FROM ${sql.raw(tTable)} t
          JOIN users u ON u.id = t.user_id
          JOIN ${sql.raw(tcTable)} tc
            ON tc.transaction_id = t.id
           AND COALESCE(tc.record_status, 0) = 0
          LEFT JOIN ${sql.raw(tdTable)} td
            ON td.transaction_id = t.id
           AND td.is_user_selection = TRUE
           AND COALESCE(td.record_status, 0) = 0
          LEFT JOIN events e ON e.event_id = t.match_id
          WHERE t.match_id = ${matchId}
            ${marketId ? sql`AND t.market_id::text = ${marketId}` : sql``}
            AND COALESCE(t.record_status, 0) = 0
            AND tc.${sql.raw(scopeCol)} = ${userId}::uuid
            ${fromTs ? sql`AND t.added_date >= ${fromTs}::timestamp` : sql``}
            ${toTs ? sql`AND t.added_date <= ${toTs}::timestamp` : sql``}
          ORDER BY t.added_date DESC
          LIMIT 2000
        `);

        const rows = Array.isArray(result)
          ? result
          : (result as any)?.rows ?? [];
        return { success: true, data: rows };
      } catch (error) {
        console.error("transaction-management/transactions error:", error);
        set.status = 500;
        return { success: false, error: "Failed to fetch transactions" };
      }
    },
    {
      beforeHandle: requirePermission("transaction_management.view"),
      query: t.Object({
        matchId: t.String(),
        marketId: t.Optional(t.String()),
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
        source: t.Optional(t.String()),
      }),
    }
  )

  // ═══════════════════════════════════════════════════════════
  //  REDECLARE — markets whose transactions were deleted AFTER the
  //  result was declared (i.e. soft-deleted rows in the *_declare
  //  archive). One row per (event, market) with the deleted count.
  //  GET /owner/transaction-management/redeclare-markets
  // ═══════════════════════════════════════════════════════════
  .get(
    "/redeclare-markets",
    async ({ set, userId, userRole }: any) => {
      try {
        const scopeCol =
          userRole === 0
            ? "owner_id"
            : userRole === 3
              ? "admin_id"
              : userRole === 4
                ? "super_id"
                : userRole === 5
                  ? "master_id"
                  : userRole === 6
                    ? "agent_id"
                    : null;

        if (!scopeCol) {
          return { success: true, data: [], count: 0 };
        }

        const result = await db.execute(sql`
          SELECT
            t.match_id,
            t.market_id::text       AS market_id,
            MAX(t.market_name)      AS market_name,
            MAX(e.name)             AS event_name,
            COUNT(*)::int           AS deleted_count,
            MAX(t.update_date)      AS last_deleted_at
          FROM transactions_declare t
          JOIN transaction_commissions_declare tc
            ON tc.transaction_id = t.id
          LEFT JOIN events e ON e.event_id = t.match_id
          WHERE COALESCE(t.record_status, 0) = ${RecordStatus.Deleted}
            AND tc.${sql.raw(scopeCol)} = ${userId}::uuid
          GROUP BY t.match_id, t.market_id
          ORDER BY MAX(t.update_date) DESC
          LIMIT 1000
        `);

        const rows = Array.isArray(result)
          ? result
          : (result as any)?.rows ?? [];
        return { success: true, data: rows, count: rows.length };
      } catch (error) {
        console.error("transaction-management/redeclare-markets error:", error);
        set.status = 500;
        return { success: false, error: "Failed to fetch redeclare markets" };
      }
    },
    { beforeHandle: requirePermission("transaction_management.view") }
  )

  // ═══════════════════════════════════════════════════════════
  //  DELETE — soft-delete selected transactions with a reason
  //  POST /owner/transaction-management/delete
  // ═══════════════════════════════════════════════════════════
  .post(
    "/delete",
    async ({ body, set, userId, userRole }: any) => {
      try {
        const remark = (body.remark || "").trim();
        const ids: string[] = body.transactionIds || [];
        const source = body.source === "declare" ? "declare" : "live";

        if (!remark) {
          set.status = 400;
          return { success: false, error: "A delete reason (remark) is required" };
        }
        if (!ids.length) {
          set.status = 400;
          return { success: false, error: "No transactions selected" };
        }

        const isDeclare = source === "declare";
        const tTable: any = isDeclare ? transactionsDeclare : transactions;
        const tdTable: any = isDeclare
          ? transactionDetailsDeclare
          : transactionDetails;
        const tcTable: any = isDeclare
          ? transactionCommissionsDeclare
          : transactionCommissions;

        // Resolve which of the requested ids are (a) still active and (b) within
        // the caller's commission hierarchy. Never trust the id list blindly.
        const scoped = await db
          .select({
            id: tTable.id,
            userId: tTable.userId,
            marketId: tTable.marketId,
            matchId: tTable.matchId,
          })
          .from(tTable)
          .innerJoin(
            tcTable,
            and(
              eq(tcTable.transactionId, tTable.id),
              eq(tcTable.recordStatus, RecordStatus.Active)
            )
          )
          .where(
            and(
              inArray(tTable.id, ids),
              eq(tTable.recordStatus, RecordStatus.Active),
              hierarchyCondition(tcTable, userId, userRole)
            )
          );

        const validIds = [...new Set(scoped.map((r) => r.id))];
        const affectedUsers = [...new Set(scoped.map((r) => r.userId))];

        if (!validIds.length) {
          set.status = 404;
          return {
            success: false,
            error: "No matching transactions found within your scope",
          };
        }

        // Mark the transaction details deleted + stamp the reason on them.
        await db
          .update(tdTable)
          .set({
            recordStatus: RecordStatus.Deleted,
            remark,
            updateBy: userId,
          })
          .where(inArray(tdTable.transactionId, validIds));

        // Mark the transactions themselves deleted.
        await db
          .update(tTable)
          .set({ recordStatus: RecordStatus.Deleted, updateBy: userId })
          .where(inArray(tTable.id, validIds));

        // Release exposure for every affected user (only matters for live,
        // matched bets — settled/declared bets are already out of the calc,
        // so the recompute is a harmless no-op there).
        for (const uid of affectedUsers) {
          try {
            await db.execute(sql`CALL set_limit_used_of_user(${uid}::uuid)`);
          } catch (e) {
            console.error(
              `[transaction-management] limit recompute failed for ${uid}:`,
              e
            );
          }
        }

        // Publish the delete reason as the market notice so users on the match
        // page see why the market was reverted. One distinct market → one notice.
        const validIdSet = new Set(validIds);
        const marketsTouched = new Map<string, string>(); // marketId → eventId
        for (const r of scoped) {
          if (!validIdSet.has(r.id)) continue;
          const mId = String(r.marketId);
          if (!marketsTouched.has(mId)) {
            marketsTouched.set(mId, String(r.matchId));
          }
        }
        for (const [mId, evId] of marketsTouched) {
          try {
            await AdminMarketService.updateMarketNotice(mId, remark, evId);
          } catch (e) {
            console.error(
              `[transaction-management] notice update failed for market ${mId}:`,
              e
            );
          }
        }

        return {
          success: true,
          data: {
            deleted: validIds.length,
            affectedUsers: affectedUsers.length,
            marketsNoticed: marketsTouched.size,
          },
        };
      } catch (error) {
        console.error("transaction-management/delete error:", error);
        set.status = 500;
        return { success: false, error: "Failed to delete transactions" };
      }
    },
    {
      beforeHandle: requirePermission("transaction_management.delete"),
      body: t.Object({
        transactionIds: t.Array(t.String(), { minItems: 1 }),
        remark: t.String({ minLength: 1 }),
        source: t.Optional(t.String()),
      }),
    }
  );
