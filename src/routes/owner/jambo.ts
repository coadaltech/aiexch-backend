import { Elysia, t } from "elysia";
import { db } from "../../db";
import {
  matkaShifts,
  matkaTransactions,
  matkaTransactionDetails,
  declareResult,
  SYSTEM_USER_ID,
} from "../../db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { RecordStatus, MatkaSportType } from "../../types/enums";
import { requirePermission } from "../../middleware/permissions";

// Highest jambo number. Triple bets span 1..1000; the live-prediction grid and
// the declared result share this range. Jodi/akhar bets are folded into the
// same 1..1000 space by the zambo SQL functions, so the UI only ever deals
// with this single number axis.
const JAMBO_MAX_NUMBER = 1000;

// Pre-RBAC: shift CRUD was Owner-only. OPS_FULL backfill excludes jambo.* CRUD.
const canCreateShift = requirePermission("jambo.create");
const canEditShift = requirePermission("jambo.edit");
const canDeleteShift = requirePermission("jambo.delete");
const canReorderShifts = requirePermission("jambo.reorder");
// Reuse the existing matka live-prediction declare permission so no new RBAC
// key has to be seeded. Owners bypass it; staff explicitly granted it can
// declare for both games.
const canDeclarePrediction = requirePermission("live_prediction.declare");

export const jamboOwnerRoutes = new Elysia({ prefix: "/jambo" })

  // ── List all jambo shifts ────────────────────────────────────────────────
  .get("/shifts", async ({ set, query }) => {
    try {
      const conditions = [
        eq(matkaShifts.recordStatus, RecordStatus.Active),
        eq(matkaShifts.sportType, MatkaSportType.Jambo),
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

  // ── Create jambo shift (owner only) ──────────────────────────────────────
  .post(
    "/shifts",
    async ({ body, set, userId }: any) => {
      try {
        const [maxOrder] = await db
          .select({ max: sql<number>`COALESCE(MAX(${matkaShifts.shiftOrder}), 0)` })
          .from(matkaShifts)
          .where(
            and(
              eq(matkaShifts.recordStatus, RecordStatus.Active),
              eq(matkaShifts.sportType, MatkaSportType.Jambo)
            )
          );

        const nextOrder = (maxOrder?.max ?? 0) + 1;

        const [shift] = await db
          .insert(matkaShifts)
          .values({
            name: body.name,
            sportType: MatkaSportType.Jambo,
            shiftDate: body.shiftDate,
            endTime: body.endTime,
            shiftOrder: nextOrder,
            // Jambo rate mapping:
            //   triple_rate  → number_type 0 (default 1000)
            //   dara_rate    → number_type 1,2 (jodi, default 100)
            //   akhar_rate   → number_type 3,4,5 (akhar, default 10)
            tripleRate: String(body.tripleRate ?? 1000),
            tripleCommission: String(body.tripleCommission ?? 0),
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
        tripleRate: t.Optional(t.Number()),
        tripleCommission: t.Optional(t.Number()),
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

  // ── Reorder jambo shifts (bulk) ──────────────────────────────────────────
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
            .where(
              and(
                eq(matkaShifts.id, item.id),
                eq(matkaShifts.sportType, MatkaSportType.Jambo)
              )
            )
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

  // ── Update jambo shift ───────────────────────────────────────────────────
  .put(
    "/shifts/:id",
    async ({ body, params, set, userId }: any) => {
      try {
        const [existing] = await db
          .select()
          .from(matkaShifts)
          .where(
            and(
              eq(matkaShifts.id, params.id),
              eq(matkaShifts.sportType, MatkaSportType.Jambo)
            )
          );

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
        if (body.tripleRate !== undefined) updateData.tripleRate = String(body.tripleRate);
        if (body.tripleCommission !== undefined) updateData.tripleCommission = String(body.tripleCommission);
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
        tripleRate: t.Optional(t.Number()),
        tripleCommission: t.Optional(t.Number()),
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

  // ── Soft delete jambo shift ──────────────────────────────────────────────
  .delete(
    "/shifts/:id",
    async ({ params, set, userId }: any) => {
      try {
        const [updated] = await db
          .update(matkaShifts)
          .set({
            recordStatus: RecordStatus.Deleted,
            updateBy: userId || SYSTEM_USER_ID,
          })
          .where(
            and(
              eq(matkaShifts.id, params.id),
              eq(matkaShifts.sportType, MatkaSportType.Jambo)
            )
          )
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

  // ── Aggregated jantri summary for a jambo shift ──────────────────────────
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
        .innerJoin(
          matkaShifts,
          eq(matkaTransactions.shiftId, matkaShifts.id)
        )
        .where(
          and(
            eq(matkaTransactions.shiftId, params.id),
            eq(matkaShifts.sportType, MatkaSportType.Jambo),
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

  // ── Live Prediction: per-number sale / profit + declared count ────────────
  // Data comes entirely from the SQL function get_zambo_sel_preductiondata_allnumber
  // (defined in triggers/all_jambo_procedures.sql) — no hand-written row SQL.
  .get("/live-prediction/:shiftId", async ({ params, set }: any) => {
    try {
      const [shift] = await db
        .select()
        .from(matkaShifts)
        .where(
          and(
            eq(matkaShifts.id, params.shiftId),
            eq(matkaShifts.sportType, MatkaSportType.Jambo)
          )
        );

      if (!shift) {
        set.status = 404;
        return { success: false, error: "Shift not found" };
      }

      // Returns (shift_id, nums, amount, profit, declare_count) for nums 1..1000.
      let predictionRows: any[] = [];
      try {
        const pr = await db.execute(sql`
          SELECT nums, amount::text AS sale, profit::text AS profit, declare_count
          FROM public.get_zambo_sel_preductiondata_allnumber(
            ${params.shiftId}::uuid, ${shift.shiftDate}::date
          )
        `);
        predictionRows = (pr as any).rows ?? pr;
      } catch (e) {
        console.error("[jambo live-prediction] prediction function call failed:", e);
      }

      // Always return a full 1..1000 grid; numbers with no bets fill with zeros.
      const byNum = new Map<number, any>();
      for (const r of predictionRows) byNum.set(Number(r.nums), r);
      const numbers = Array.from({ length: JAMBO_MAX_NUMBER }, (_, i) => {
        const n = i + 1;
        const r = byNum.get(n);
        return {
          nums: n,
          sale: r?.sale ?? "0",
          profit: r?.profit ?? "0",
          declared_count: Number(r?.declare_count ?? 0),
        };
      });

      return { success: true, data: { shift, numbers } };
    } catch (error) {
      console.error("[jambo live-prediction] failed:", error);
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

  // ── Live Prediction: party (user) breakdown for a single number ───────────
  // Backed by get_zambo_sel_user_sale_profit — returns per-user sale, owner
  // P&L, and the recent win/lose streak (mirrors matka's whitelabels endpoint).
  .get(
    "/live-prediction/:shiftId/whitelabels",
    async ({ params, query, set }: any) => {
      try {
        const num = Number(query?.nums);
        if (!Number.isInteger(num) || num < 1 || num > JAMBO_MAX_NUMBER) {
          set.status = 400;
          return {
            success: false,
            error: `Invalid number (must be 1-${JAMBO_MAX_NUMBER})`,
          };
        }

        const [shift] = await db
          .select()
          .from(matkaShifts)
          .where(
            and(
              eq(matkaShifts.id, params.shiftId),
              eq(matkaShifts.sportType, MatkaSportType.Jambo)
            )
          );

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
          FROM public.get_zambo_sel_user_sale_profit(
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

  // ── Live Prediction: per-whitelabel sale for a single number (Agent Group) ──
  // Backed by get_zambo_sel_whitelabel_sale (mirrors matka's agent-sale endpoint).
  .get(
    "/live-prediction/:shiftId/agent-sale",
    async ({ params, query, set }: any) => {
      try {
        const num = Number(query?.nums);
        if (!Number.isInteger(num) || num < 1 || num > JAMBO_MAX_NUMBER) {
          set.status = 400;
          return {
            success: false,
            error: `Invalid number (must be 1-${JAMBO_MAX_NUMBER})`,
          };
        }

        const [shift] = await db
          .select()
          .from(matkaShifts)
          .where(
            and(
              eq(matkaShifts.id, params.shiftId),
              eq(matkaShifts.sportType, MatkaSportType.Jambo)
            )
          );

        if (!shift) {
          set.status = 404;
          return { success: false, error: "Shift not found" };
        }

        const rows = await db.execute(sql`
          SELECT whitelabel_id::text AS whitelabel_id, name, amount::text AS amount
          FROM public.get_zambo_sel_whitelabel_sale(
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

  // ── Live Prediction: full 1..1000 jantri grid ────────────────────────────
  // partyId = "all" (or empty) → every user's consolidated grid, served by
  // get_zambo_sel_preductiondata_allnumber. partyId = a user uuid → just that
  // user's grid, served by get_user_zambo_jantri. (Mirrors matka's all/party jantri.)
  .get(
    "/live-prediction/:shiftId/jantri",
    async ({ params, query, set }: any) => {
      try {
        const partyId = (query?.partyId as string | undefined) ?? "all";
        const isAll = !partyId || partyId === "all";

        const [shift] = await db
          .select()
          .from(matkaShifts)
          .where(
            and(
              eq(matkaShifts.id, params.shiftId),
              eq(matkaShifts.sportType, MatkaSportType.Jambo)
            )
          );

        if (!shift) {
          set.status = 404;
          return { success: false, error: "Shift not found" };
        }

        const rows = isAll
          ? await db.execute(sql`
              SELECT nums, amount::text AS sale
              FROM public.get_zambo_sel_preductiondata_allnumber(
                ${params.shiftId}::uuid,
                ${shift.shiftDate}::date
              )
            `)
          : await db.execute(sql`
              SELECT nums, amount::text AS sale
              FROM public.get_user_zambo_jantri(
                ${partyId}::uuid,
                ${params.shiftId}::uuid,
                ${shift.shiftDate}::date
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
              : "Failed to fetch jantri grid",
        };
      }
    }
  )

  // ── Live Prediction: declare a result for a jambo shift ───────────────────
  .post(
    "/live-prediction/:shiftId/declare",
    async ({ params, body, set, userId }: any) => {
      try {
        const num = Number(body.result);
        if (!Number.isInteger(num) || num < 0 || num > JAMBO_MAX_NUMBER) {
          set.status = 400;
          return {
            success: false,
            error: `Result must be between 0 and ${JAMBO_MAX_NUMBER}`,
          };
        }

        const [shift] = await db
          .select()
          .from(matkaShifts)
          .where(
            and(
              eq(matkaShifts.id, params.shiftId),
              eq(matkaShifts.sportType, MatkaSportType.Jambo)
            )
          );

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

        // Server-side enforcement of the main-jantri cutoff (mirrors matka).
        if (shift.mainJantriTime) {
          const [jH, jM] = shift.mainJantriTime.split(":").map(Number);
          const jantriAt = new Date(shift.shiftDate);
          jantriAt.setHours(jH, jM, 0, 0);
          if (shift.nextDayAllow) {
            jantriAt.setDate(jantriAt.getDate() + 1);
          }
          const msLeft = jantriAt.getTime() - Date.now();
          if (msLeft > 0) {
            set.status = 400;
            return {
              success: false,
              error: "Main jantri time not reached",
              msLeft,
              mainJantriAt: jantriAt.toISOString(),
            };
          }
        }

        // Full jambo declare flow: creates vouchers + voucher_details, archives
        // matka_transactions* rows into their _declare counterparts, deletes the
        // live rows, and inserts declare_result. Defined in
        // triggers/all_jambo_procedures.sql.
        await db.execute(sql`
          CALL public.declare_process_zambo(
            ${params.shiftId}::uuid,
            CURRENT_DATE,
            ${shift.shiftDate}::date,
            ${num}::int
          )
        `);

        // Park the shift at the epoch sentinel — same convention as matka, and
        // the value the public jambo /shifts route reads to surface the result
        // (it joins declare_result for shifts parked at 1970-01-01).
        await db
          .update(matkaShifts)
          .set({
            shiftDate: "1970-01-01",
            updateBy: userId || SYSTEM_USER_ID,
          })
          .where(eq(matkaShifts.id, params.shiftId));

        return { success: true, data: { shiftId: params.shiftId, result: num } };
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

  // ── Live Prediction: history of previously declared jambo results ─────────
  // Read straight from declare_result (joined to the shift for its name) — the
  // same source the public jambo route uses, so matka's market_results history
  // is untouched.
  .get("/live-prediction/declared-history", async ({ query, set }: any) => {
    try {
      const limit = Math.min(Number(query?.limit ?? 50), 200);
      const rows = await db
        .select({
          id: declareResult.declareId,
          runs: declareResult.declareNumber,
          declared_at: declareResult.addedDate,
          shift_name: matkaShifts.name,
          shift_date: declareResult.declareDate,
          shift_id: declareResult.shiftId,
        })
        .from(declareResult)
        .innerJoin(matkaShifts, eq(declareResult.shiftId, matkaShifts.id))
        .where(
          and(
            eq(declareResult.recordStatus, RecordStatus.Active),
            eq(matkaShifts.sportType, MatkaSportType.Jambo)
          )
        )
        .orderBy(desc(declareResult.addedDate))
        .limit(limit);

      return { success: true, data: rows };
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
