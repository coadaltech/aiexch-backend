import { Elysia, t } from "elysia";
import { db } from "../../db";
import {
  matkaShifts,
  matkaTransactions,
  matkaTransactionDetails,
  marketResults,
  SYSTEM_USER_ID,
} from "../../db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { RecordStatus, UserRole, MatkaSportType } from "../../types/enums";
import { requirePermission } from "../../middleware/permissions";
import { istInstantMs } from "../../utils/shift-time";

// Synthetic event_type_id used to mark matka result rows in market_results.
const MATKA_EVENT_TYPE_ID = 999;

// Per-action permission gates (replacing the previous Owner-only check).
// Owner role bypasses these via services/permissions.ts. The OPS_FULL backfill
// template excludes all matka CRUD verbs, preserving pre-RBAC behavior for
// existing Admin/Super/Master/Agent users.
const canCreateShift = requirePermission("matka.create");
const canEditShift = requirePermission("matka.edit");
const canDeleteShift = requirePermission("matka.delete");
const canReorderShifts = requirePermission("matka.reorder");
const canDeclarePrediction = requirePermission("live_prediction.declare");

// For the currently-logged-in viewer, return which commission-table column
// holds their id and a SQL expression for the next-non-null downline level
// to group the Party list by.
//
//   Owner (0)  sees Admins  (preferred), or whatever next role exists in the
//                            chain when admins are skipped: super → master →
//                            agent → the user that placed the bet.
//   Admin (3)  sees Supers  (or master → agent → user)
//   Super (4)  sees Masters (or agent → user)
//   Master(5)  sees Agents  (or user)
//   Agent (6)  sees Users   (mt.user_id directly)
//
// percentCol is the viewer's own commission slice — multiply player P/L by
// `<percentCol> / 100` to get the viewer's net P/L on that bet.
//
// downlineSql is a SQL fragment that resolves to the party id for grouping
// and joining to `users`. It uses table aliases `mtc` and `mt` so the query
// must use those names.
function roleConfig(role: number) {
  switch (role) {
    case UserRole.Owner:
      return {
        viewerCol: "owner_id",
        percentCol: "owner_percent",
        downlineSql: "COALESCE(mtc.admin_id, mtc.super_id, mtc.master_id, mtc.agent_id, mt.user_id)",
      };
    case UserRole.Admin:
      return {
        viewerCol: "admin_id",
        percentCol: "admin_percent",
        downlineSql: "COALESCE(mtc.super_id, mtc.master_id, mtc.agent_id, mt.user_id)",
      };
    case UserRole.Super:
      return {
        viewerCol: "super_id",
        percentCol: "super_percent",
        downlineSql: "COALESCE(mtc.master_id, mtc.agent_id, mt.user_id)",
      };
    case UserRole.Master:
      return {
        viewerCol: "master_id",
        percentCol: "master_percent",
        downlineSql: "COALESCE(mtc.agent_id, mt.user_id)",
      };
    case UserRole.Agent:
      return {
        viewerCol: "agent_id",
        percentCol: "agent_percent",
        downlineSql: "mt.user_id",
      };
    default:
      return null;
  }
}

export const matkaOwnerRoutes = new Elysia({ prefix: "/matka" })

  // ── List all shifts (with optional date filter) ───────────────────────────
  .get("/shifts", async ({ set, query }) => {
    try {
      const conditions = [
        eq(matkaShifts.recordStatus, RecordStatus.Active),
        eq(matkaShifts.sportType, MatkaSportType.Matka),
      ];

      if (query?.date) {
        conditions.push(eq(matkaShifts.shiftDate, query.date));
      }

      const shifts = await db
        .select()
        .from(matkaShifts)
        .where(and(...conditions))
        .orderBy(desc(matkaShifts.shiftDate), matkaShifts.shiftOrder);

      return { success: true, data: shifts };
    } catch (error) {
      set.status = 500;
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch shifts",
      };
    }
  })

  // ── Create a new shift (owner only) ──────────────────────────────────────
  .post(
    "/shifts",
    async ({ body, set, userId }: any) => {
      try {
        // Auto-increment order: get the max shiftOrder for active shifts
        const [maxOrder] = await db
          .select({ max: sql<number>`COALESCE(MAX(${matkaShifts.shiftOrder}), 0)` })
          .from(matkaShifts)
          .where(
            and(
              eq(matkaShifts.recordStatus, RecordStatus.Active),
              eq(matkaShifts.sportType, MatkaSportType.Matka)
            )
          );

        const nextOrder = (maxOrder?.max ?? 0) + 1;

        const [shift] = await db
          .insert(matkaShifts)
          .values({
            name: body.name,
            sportType: MatkaSportType.Matka,
            shiftDate: body.shiftDate,
            endTime: body.endTime,
            shiftOrder: nextOrder,
            daraRate: String(body.daraRate ?? 100),
            daraCommission: String(body.daraCommission ?? 0),
            akharRate: String(body.akharRate ?? 10),
            akharCommission: String(body.akharCommission ?? 0),
            mainJantriTime: body.mainJantriTime || null,
            isActive: body.isActive ?? true,
            nextDayAllow: body.nextDayAllow ?? false,
            capping: String(body.capping ?? 0),
            addedBy: userId || SYSTEM_USER_ID,
            updateBy: userId || SYSTEM_USER_ID,
          })
          .returning();

        set.status = 201;
        return { success: true, data: shift };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to create shift",
        };
      }
    },
    {
      beforeHandle: canCreateShift,
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 100 }),
        shiftDate: t.String(),
        endTime: t.String(),
        daraRate: t.Optional(t.Number()),
        daraCommission: t.Optional(t.Number()),
        akharRate: t.Optional(t.Number()),
        akharCommission: t.Optional(t.Number()),
        mainJantriTime: t.Optional(t.String()),
        isActive: t.Optional(t.Boolean()),
        nextDayAllow: t.Optional(t.Boolean()),
        capping: t.Optional(t.Number()),
      }),
    }
  )

  // ── Reorder shifts (bulk update order) ─────────────────────────────────
  // NOTE: must be before /shifts/:id to avoid path conflict
  .put(
    "/shifts/reorder",
    async ({ body, set, userId }: any) => {
      try {
        const updates = body.orders.map((item: any) =>
          db
            .update(matkaShifts)
            .set({
              shiftOrder: item.shiftOrder,
              updateBy: userId || SYSTEM_USER_ID,
            })
            .where(eq(matkaShifts.id, item.id))
        );

        await Promise.all(updates);

        return { success: true };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to reorder shifts",
        };
      }
    },
    {
      beforeHandle: canReorderShifts,
      body: t.Object({
        orders: t.Array(
          t.Object({
            id: t.String(),
            shiftOrder: t.Number(),
          })
        ),
      }),
    }
  )

  // ── Update a shift ───────────────────────────────────────────────────────
  .put(
    "/shifts/:id",
    async ({ body, params, set, userId }: any) => {
      try {
        const [existing] = await db
          .select()
          .from(matkaShifts)
          .where(eq(matkaShifts.id, params.id));

        if (!existing) {
          set.status = 404;
          return { success: false, error: "Shift not found" };
        }

        const updateData: Record<string, any> = {
          updateBy: userId || SYSTEM_USER_ID,
        };

        if (body.name !== undefined) updateData.name = body.name;
        if (body.shiftDate !== undefined) updateData.shiftDate = body.shiftDate;
        if (body.endTime !== undefined) updateData.endTime = body.endTime;
        if (body.shiftOrder !== undefined) updateData.shiftOrder = body.shiftOrder;
        if (body.daraRate !== undefined) updateData.daraRate = String(body.daraRate);
        if (body.daraCommission !== undefined) updateData.daraCommission = String(body.daraCommission);
        if (body.akharRate !== undefined) updateData.akharRate = String(body.akharRate);
        if (body.akharCommission !== undefined) updateData.akharCommission = String(body.akharCommission);
        if (body.mainJantriTime !== undefined) updateData.mainJantriTime = body.mainJantriTime;
        if (body.isActive !== undefined) updateData.isActive = body.isActive;
        if (body.nextDayAllow !== undefined) updateData.nextDayAllow = body.nextDayAllow;
        if (body.capping !== undefined) updateData.capping = String(body.capping);

        const [updated] = await db
          .update(matkaShifts)
          .set(updateData)
          .where(eq(matkaShifts.id, params.id))
          .returning();

        return { success: true, data: updated };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to update shift",
        };
      }
    },
    {
      beforeHandle: canEditShift,
      body: t.Object({
        name: t.Optional(t.String()),
        shiftDate: t.Optional(t.String()),
        endTime: t.Optional(t.String()),
        shiftOrder: t.Optional(t.Number()),
        daraRate: t.Optional(t.Number()),
        daraCommission: t.Optional(t.Number()),
        akharRate: t.Optional(t.Number()),
        akharCommission: t.Optional(t.Number()),
        mainJantriTime: t.Optional(t.String()),
        isActive: t.Optional(t.Boolean()),
        nextDayAllow: t.Optional(t.Boolean()),
        capping: t.Optional(t.Number()),
      }),
    }
  )

  // ── Delete a shift (soft delete) ─────────────────────────────────────────
  .delete(
    "/shifts/:id",
    async ({ params, set, userId, userRole }: any) => {
      try {
        const [updated] = await db
          .update(matkaShifts)
          .set({
            recordStatus: RecordStatus.Deleted,
            updateBy: userId || SYSTEM_USER_ID,
          })
          .where(eq(matkaShifts.id, params.id))
          .returning();

        if (!updated) {
          set.status = 404;
          return { success: false, error: "Shift not found" };
        }

        return { success: true, data: updated };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to delete shift",
        };
      }
    },
    { beforeHandle: canDeleteShift }
  )

  // ── Get jantri summary for a shift (admin view with totals) ───────────────
  .get("/shifts/:id/jantri", async ({ params, set }) => {
    try {
      const totals = await db
        .select({
          number: matkaTransactionDetails.number,
          numberType: matkaTransactionDetails.numberType,
          totalAmount: sql<string>`SUM(CAST(${matkaTransactionDetails.amount} AS NUMERIC))`,
          betCount: sql<number>`COUNT(*)`,
        })
        .from(matkaTransactionDetails)
        .innerJoin(
          matkaTransactions,
          eq(matkaTransactionDetails.transactionId, matkaTransactions.id)
        )
        .where(
          and(
            eq(matkaTransactions.shiftId, params.id),
            eq(matkaTransactions.recordStatus, RecordStatus.Active),
            eq(matkaTransactionDetails.recordStatus, RecordStatus.Active)
          )
        )
        .groupBy(matkaTransactionDetails.number, matkaTransactionDetails.numberType);

      return { success: true, data: totals };
    } catch (error) {
      set.status = 500;
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch jantri",
      };
    }
  })

  // ── Live Prediction: per-number sale / profit + 30-day declared count ─────
  .get("/live-prediction/:shiftId", async ({ params, set, userId, userRole }: any) => {
    try {
      const viewerId = userId;
      const viewerRole = Number(userRole);
      const cfg = roleConfig(viewerRole);

      const [shift] = await db
        .select()
        .from(matkaShifts)
        .where(eq(matkaShifts.id, params.shiftId));

      if (!shift) {
        set.status = 404;
        return { success: false, error: "Shift not found" };
      }

      if (!cfg) {
        set.status = 403;
        return { success: false, error: "Role not supported" };
      }

      // Call the SQL function that returns (shift_id, nums, amount, profit,
      // declare_count) for nums 1..100. Logic is in 01_matka_procedures.sql.
      let jantriRows: any[] = [];
      try {
        const jr = await db.execute(sql`
          SELECT nums, amount::text AS sale, profit::text AS profit, declare_count
          FROM public.get_matka_sel_preductiondata_allnumber(
            ${params.shiftId}::uuid, ${shift.shiftDate}::date
          )
        `);
        jantriRows = (jr as any).rows ?? jr;
      } catch (e) {
        console.error("[live-prediction] prediction function call failed:", e);
      }

      // Always return a full 1..100 grid. The SQL function returns at most
      // 100 rows; any gaps get filled with zeros.
      const byNum = new Map<number, any>();
      for (const r of jantriRows) byNum.set(Number(r.nums), r);
      const numbers = Array.from({ length: 100 }, (_, i) => {
        const n = i + 1;
        const r = byNum.get(n);
        return {
          nums: n,
          num_type: 1,
          sale: r?.sale ?? "0",
          profit: r?.profit ?? "0",
          declared_count: Number(r?.declare_count ?? 0),
        };
      });

      // Diagnostic: txns in shift vs commission rows attributing them to this
      // viewer. If commCount=0 the viewer isn't in any bet's upline chain.
      let txCount = 0;
      let commCount = 0;
      try {
        const diag = await db.execute(sql`
          SELECT
            (SELECT COUNT(*) FROM matka_transactions
             WHERE shift_id = ${params.shiftId}::uuid AND record_status = 0) AS tx,
            (SELECT COUNT(*) FROM matka_transactions mt
             JOIN matka_transaction_commissions mtc
               ON mtc.matka_transaction_id = mt.id AND mtc.record_status = 0
              AND ${sql.raw("mtc." + cfg.viewerCol)} = ${viewerId}::uuid
             WHERE mt.shift_id = ${params.shiftId}::uuid AND mt.record_status = 0) AS comm
        `);
        const d: any = ((diag as any).rows ?? diag)[0] ?? {};
        txCount = Number(d.tx ?? 0);
        commCount = Number(d.comm ?? 0);
      } catch (e) {
        console.error("[live-prediction] diag query failed:", e);
      }

      return {
        success: true,
        data: {
          shift,
          numbers,
          meta: { viewerId, viewerRole, txCount, commCount },
        },
      };
    } catch (error) {
      console.error("[live-prediction] failed:", error);
      set.status = 500;
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch live prediction",
      };
    }
  })

  // ── Live Prediction: party (user) breakdown for a single number ──────────
  .get(
    "/live-prediction/:shiftId/whitelabels",
    async ({ params, query, set }) => {
      try {
        const num = Number(query?.nums);
        if (!Number.isInteger(num) || num < 1 || num > 100) {
          set.status = 400;
          return { success: false, error: "Invalid number (must be 1-100)" };
        }

        const [shift] = await db
          .select()
          .from(matkaShifts)
          .where(eq(matkaShifts.id, params.shiftId));

        if (!shift) {
          set.status = 404;
          return { success: false, error: "Shift not found" };
        }

        const rows = await db.execute(sql`
          SELECT
            user_id::text  AS user_id,
            name,
            amount::text   AS sale,
            profit::text   AS profit,
            COALESCE(streak, 0)::int AS streak,
            streak_type
          FROM get_matka_sel_user_sale_profit(
            ${params.shiftId}::uuid,
            ${shift.shiftDate}::date,
            ${num}
          )
        `);

        return { success: true, data: (rows as any).rows ?? rows };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to fetch party breakdown",
        };
      }
    }
  )

  // ── Live Prediction: per-whitelabel (or all) jantri grid for a shift ──────
  .get(
    "/live-prediction/:shiftId/jantri",
    async ({ params, query, set, userId, userRole }: any) => {
      try {
        const viewerId = userId;
        const viewerRole = Number(userRole);
        const cfg = roleConfig(viewerRole);
        if (!cfg) {
          set.status = 403;
          return { success: false, error: "Role not supported" };
        }

        const [shift] = await db
          .select()
          .from(matkaShifts)
          .where(eq(matkaShifts.id, params.shiftId));

        if (!shift) {
          set.status = 404;
          return { success: false, error: "Shift not found" };
        }

        const wlParam = (query?.whitelabelId as string | undefined) ?? "all";
        const isAll = wlParam === "all" || !wlParam;

        const partyFilter = isAll
          ? sql``
          : sql`AND (${sql.raw(cfg.downlineSql)})::text = ${wlParam}`;

        const rows = await db.execute(sql`
          WITH all_nums AS (
            SELECT generate_series AS nums, 1 AS num_type FROM generate_series(1, 100)
            UNION ALL
            SELECT generate_series * 111,  2 FROM generate_series(1, 9)
            UNION ALL
            SELECT generate_series * 1111, 3 FROM generate_series(1, 9)
          ),
          filtered_bets AS (
            SELECT mtd.number_type, mtd.number::integer AS num,
                   SUM(mtd.amount) AS total_amount
            FROM matka_transactions mt
            JOIN matka_transaction_commissions mtc
              ON mtc.matka_transaction_id = mt.id
              AND mtc.record_status = 0
              AND ${sql.raw("mtc." + cfg.viewerCol)} = ${viewerId}::uuid
              ${partyFilter}
            JOIN matka_transaction_details mtd
              ON mtd.transaction_id = mt.id
              AND mtd.record_status = 0
            WHERE mt.shift_id = ${params.shiftId}::uuid
              AND mt.transaction_date = ${shift.shiftDate}::date
              AND mt.record_status = 0
            GROUP BY mtd.number_type, mtd.number::integer
          )
          SELECT
            an.nums::int     AS nums,
            an.num_type::int AS num_type,
            COALESCE(fb.total_amount, 0)::text AS sale
          FROM all_nums an
          LEFT JOIN filtered_bets fb
            ON fb.number_type = an.num_type AND fb.num = an.nums
          ORDER BY an.num_type, an.nums
        `);

        return { success: true, data: (rows as any).rows ?? rows };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to fetch jantri grid",
        };
      }
    }
  )

  // ── Live Prediction: per-whitelabel sale for a single number (Agent Group) ──
  .get(
    "/live-prediction/:shiftId/agent-sale",
    async ({ params, query, set, userId, userRole }: any) => {
      try {
        const num = Number(query?.nums);
        if (!Number.isInteger(num) || num < 1 || num > 100) {
          set.status = 400;
          return {
            success: false,
            error: "Invalid number (must be 1-100)",
          };
        }

        const [shift] = await db
          .select()
          .from(matkaShifts)
          .where(eq(matkaShifts.id, params.shiftId));

        if (!shift) {
          set.status = 404;
          return { success: false, error: "Shift not found" };
        }

        const rows = await db.execute(sql`
          SELECT whitelabel_id, name, amount::text
          FROM get_matka_sel_whitelabel_sale(
            ${params.shiftId}::uuid,
            ${shift.shiftDate}::date,
            ${num}
          )
        `);

        return { success: true, data: (rows as any).rows ?? rows };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to fetch agent sale",
        };
      }
    }
  )

  // ── Live Prediction: declare a result for a shift ─────────────────────────
  .post(
    "/live-prediction/:shiftId/declare",
    async ({ params, body, set, userId }: any) => {
      try {
        const num = Number(body.result);
        if (!Number.isFinite(num) || num < 0 || num > 100) {
          set.status = 400;
          return { success: false, error: "Result must be between 0 and 100" };
        }

        const [shift] = await db
          .select()
          .from(matkaShifts)
          .where(eq(matkaShifts.id, params.shiftId));

        if (!shift) {
          set.status = 404;
          return { success: false, error: "Shift not found" };
        }

        if (shift.shiftDate === "1970-01-01") {
          set.status = 400;
          return {
            success: false,
            error: "Result already declared for this shift",
          };
        }

        // Block declaring before main_jantri_time. End-user-facing UX shows
        // a countdown; this enforces it on the server so the UI can't be
        // bypassed. End time is HH:MM local to shift_date (extended by one
        // day when nextDayAllow is true).
        if (shift.mainJantriTime) {
          // main_jantri_time is IST wall-clock; compute the instant in IST so
          // the check is independent of the server's timezone (dev=IST, prod=UTC).
          const jantriMs = istInstantMs(
            shift.shiftDate,
            shift.mainJantriTime,
            shift.nextDayAllow
          );
          const msLeft = jantriMs - Date.now();
          if (msLeft > 0) {
            set.status = 400;
            return {
              success: false,
              error: "Main jantri time not reached",
              msLeft,
              mainJantriAt: new Date(jantriMs).toISOString(),
            };
          }
        }

        // Run the full matka declare flow: creates vouchers + voucher_details,
        // archives matka_transactions* rows into their _declare counterparts,
        // deletes them from the live tables, and inserts declare_result.
        // Defined in triggers/all_matks_procedures_functions.sql.
        await db.execute(sql`
          CALL public.declare_process_matka(
            ${params.shiftId}::uuid,
            CURRENT_DATE,
            ${shift.shiftDate}::date,
            ${num}::int
          )
        `);

        // Park the shift at the epoch sentinel so it's clear the result is
        // out and the daily cron knows to roll it forward to a fresh date.
        await db
          .update(matkaShifts)
          .set({
            shiftDate: "1970-01-01",
            updateBy: userId || SYSTEM_USER_ID,
          })
          .where(eq(matkaShifts.id, params.shiftId));

        // marketId must be unique numeric — use epoch microseconds.
        const uniqueMarketId = String(Date.now() * 1000 + Math.floor(Math.random() * 1000));
        const ownerId = userId || SYSTEM_USER_ID;

        const [inserted] = await db
          .insert(marketResults)
          .values({
            eventId: 0,
            eventTypeId: MATKA_EVENT_TYPE_ID,
            competitionId: null,
            marketId: uniqueMarketId,
            marketType: 0,
            status: "DECLARED",
            winnerId: num,
            winnerName: String(num),
            runs: num,
            source: "manual",
            apiResponse: {
              shiftId: shift.id,
              shiftName: shift.name,
              shiftDate: shift.shiftDate,
            } as any,
            declaredAt: new Date(),
            addedBy: ownerId,
            updateBy: ownerId,
          })
          .returning();

        return { success: true, data: inserted };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to declare result",
        };
      }
    },
    {
      beforeHandle: canDeclarePrediction,
      body: t.Object({ result: t.Number() }),
    }
  )

  // ── Live Prediction: history of previously declared matka results ─────────
  .get("/live-prediction/declared-history", async ({ query, set }) => {
    try {
      const limit = Math.min(Number(query?.limit ?? 50), 200);
      // Optional: restrict history to a single shift (the one selected in the
      // live-prediction header). Applying it in SQL means the limit counts
      // that shift's rows, not the latest across every shift.
      const shiftId = (query?.shiftId as string | undefined) || undefined;
      const rows = await db.execute(sql`
        SELECT
          id,
          runs,
          declared_at,
          (api_response->>'shiftName') AS shift_name,
          (api_response->>'shiftDate') AS shift_date,
          (api_response->>'shiftId')   AS shift_id
        FROM market_results
        WHERE event_type_id = ${MATKA_EVENT_TYPE_ID}
          AND status = 'DECLARED'
          AND record_status = 0
          ${shiftId ? sql`AND (api_response->>'shiftId') = ${shiftId}` : sql``}
        ORDER BY declared_at DESC
        LIMIT ${limit}
      `);
      return { success: true, data: (rows as any).rows ?? rows };
    } catch (error) {
      set.status = 500;
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch declared history",
      };
    }
  });
