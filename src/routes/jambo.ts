import { Elysia, t } from "elysia";
import { db } from "../db";
import {
  matkaShifts,
  matkaTransactions,
  matkaTransactionDetails,
  matkaTransactionLogs,
  matkaTransactionCommissions,
  ledgerLimit,
  users,
  declareResult,
} from "../db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { app_middleware } from "../middleware/auth";
import { parseUserAgent } from "../utils/parse-ua";
import { istInstantMs } from "../utils/shift-time";
import { RecordStatus, UserRole, MatkaSportType } from "../types/enums";

// ── Jambo number-type enum ───────────────────────────────────────────────
// 0 - triple            (full 3-digit number, incl. 1000)
// 1 - bhar ki jodi      (2-digit, 0-99)
// 2 - andar ki jodi     (2-digit, 0-99)
// 3 - akhar bahar       (single digit, 0-9)
// 4 - akhar andar       (single digit, 0-9)
// 5 - middle akhar      (single digit, 0-9)
//
// Validation lives here so invalid bets are rejected before reaching the DB.
function validateJamboNumber(numberType: number, number: string): string | null {
  const n = parseInt(number, 10);
  if (!Number.isFinite(n) || n < 0) return "Invalid number";
  switch (numberType) {
    case 0:
      return n >= 1 && n <= 1000 ? null : "Triple must be 1-1000";
    case 1:
    case 2:
      return n >= 0 && n <= 99 ? null : "Jodi must be 0-99";
    case 3:
    case 4:
    case 5:
      return n >= 0 && n <= 9 ? null : "Akhar must be 0-9";
    default:
      return "Invalid number type (0-5)";
  }
}

export const jamboRoutes = new Elysia({ prefix: "/jambo" })

  // ── Public: list active shifts for Jambo ──────────────────────────────────
  .get("/shifts", async ({ set, query }) => {
    try {
      const dateFilter = query?.date || new Date().toISOString().split("T")[0];

      const todayShifts = await db
        .select()
        .from(matkaShifts)
        .where(
          and(
            eq(matkaShifts.isActive, true),
            eq(matkaShifts.recordStatus, RecordStatus.Active),
            eq(matkaShifts.sportType, MatkaSportType.Jambo),
            eq(matkaShifts.shiftDate, dateFilter)
          )
        )
        .orderBy(matkaShifts.shiftOrder);

      const yesterday = new Date(dateFilter);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split("T")[0];

      const carryOverShifts = await db
        .select()
        .from(matkaShifts)
        .where(
          and(
            eq(matkaShifts.isActive, true),
            eq(matkaShifts.recordStatus, RecordStatus.Active),
            eq(matkaShifts.sportType, MatkaSportType.Jambo),
            eq(matkaShifts.shiftDate, yesterdayStr),
            eq(matkaShifts.nextDayAllow, true)
          )
        )
        .orderBy(matkaShifts.shiftOrder);

      const nowMs = Date.now();
      const activeCarryOvers = carryOverShifts.filter((s) => {
        if (!s.endTime) return false;
        return nowMs < istInstantMs(dateFilter, s.endTime);
      });

      const declaredShifts = await db
        .select()
        .from(matkaShifts)
        .where(
          and(
            eq(matkaShifts.isActive, true),
            eq(matkaShifts.recordStatus, RecordStatus.Active),
            eq(matkaShifts.sportType, MatkaSportType.Jambo),
            eq(matkaShifts.shiftDate, "1970-01-01")
          )
        )
        .orderBy(matkaShifts.shiftOrder);

      let declaredByShift = new Map<string, number>();
      if (declaredShifts.length > 0) {
        const declaredRows = await db
          .select({
            shiftId: declareResult.shiftId,
            declareNumber: declareResult.declareNumber,
            addedDate: declareResult.addedDate,
          })
          .from(declareResult)
          .where(
            and(
              eq(declareResult.recordStatus, RecordStatus.Active),
              sql`${declareResult.shiftId} IN (${sql.join(
                declaredShifts.map((s) => sql`${s.id}::uuid`),
                sql`, `
              )})`
            )
          )
          .orderBy(desc(declareResult.addedDate));

        for (const row of declaredRows) {
          if (!declaredByShift.has(row.shiftId)) {
            declaredByShift.set(row.shiftId, row.declareNumber);
          }
        }
      }

      const declaredWithResult = declaredShifts.map((s) => ({
        ...s,
        result: declaredByShift.get(s.id) ?? null,
      }));

      return {
        success: true,
        data: [...declaredWithResult, ...activeCarryOvers, ...todayShifts],
      };
    } catch (error) {
      set.status = 500;
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch shifts",
      };
    }
  })

  // ── Public: single jambo shift ───────────────────────────────────────────
  .get("/shifts/:id", async ({ params, set }) => {
    try {
      const [shift] = await db
        .select()
        .from(matkaShifts)
        .where(
          and(
            eq(matkaShifts.id, params.id),
            eq(matkaShifts.sportType, MatkaSportType.Jambo),
            eq(matkaShifts.recordStatus, RecordStatus.Active)
          )
        );

      if (!shift) {
        set.status = 404;
        return { success: false, error: "Shift not found" };
      }

      return { success: true, data: shift };
    } catch (error) {
      set.status = 500;
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch shift",
      };
    }
  })

  // ── Public: aggregated jantri totals for a jambo shift ───────────────────
  .get("/shifts/:id/jantri", async ({ params, set, query }) => {
    try {
      const dateFilter = (query as any)?.date as string | undefined;

      const [shift] = await db
        .select()
        .from(matkaShifts)
        .where(
          and(
            eq(matkaShifts.id, params.id),
            eq(matkaShifts.sportType, MatkaSportType.Jambo)
          )
        );

      if (!shift) {
        set.status = 404;
        return { success: false, error: "Shift not found" };
      }

      const whereConditions = [
        eq(matkaTransactions.shiftId, params.id),
        eq(matkaTransactions.recordStatus, RecordStatus.Active),
        eq(matkaTransactionDetails.recordStatus, RecordStatus.Active),
      ];

      if (dateFilter) {
        whereConditions.push(eq(matkaTransactions.transactionDate, dateFilter));
      }

      const totals = await db
        .select({
          number: matkaTransactionDetails.number,
          numberType: matkaTransactionDetails.numberType,
          totalAmount: sql<string>`SUM(${matkaTransactionDetails.amount})`,
        })
        .from(matkaTransactionDetails)
        .innerJoin(
          matkaTransactions,
          eq(matkaTransactionDetails.transactionId, matkaTransactions.id)
        )
        .where(and(...whereConditions))
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

  // ── Protected routes ─────────────────────────────────────────────────────
  // Per-request user context via .resolve() (NOT .state(), which is module-shared
  // and would leak userId across concurrent bet placements).
  .resolve(async ({ cookie, headers, status, request }) => {
    const state_result = await app_middleware({ cookie, headers, request });
    if (!state_result.data) {
      return status(state_result.code as 401 | 403 | 404 | 500, state_result);
    }
    return {
      userId: state_result.data.id,
      userRole: state_result.data.role,
    };
  })

  // ── Place jambo bet ───────────────────────────────────────────────────────
  .post(
    "/place",
    async ({ body, userId, set, request }) => {
      try {
        const { shiftId, bets, copyReferenceShiftId, whitelabelId } = body as {
          shiftId: string;
          bets: { number: string; numberType: number; amount: number }[];
          copyReferenceShiftId?: string;
          whitelabelId?: string;
        };

        if (!shiftId || !bets || bets.length === 0) {
          set.status = 400;
          return { success: false, error: "Shift ID and bets are required" };
        }

        // Validate each bet's numberType + number combination
        for (const bet of bets) {
          const err = validateJamboNumber(bet.numberType, bet.number);
          if (err) {
            set.status = 400;
            return { success: false, error: `${err} (got ${bet.number})` };
          }
        }

        let resolvedWhitelabelId = whitelabelId;
        if (!resolvedWhitelabelId) {
          const [betUser] = await db
            .select({ whitelabelId: users.whitelabelId })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
          resolvedWhitelabelId = betUser?.whitelabelId ?? undefined;
        }

        const [shift] = await db
          .select()
          .from(matkaShifts)
          .where(
            and(
              eq(matkaShifts.id, shiftId),
              eq(matkaShifts.isActive, true),
              eq(matkaShifts.sportType, MatkaSportType.Jambo),
              eq(matkaShifts.recordStatus, RecordStatus.Active)
            )
          );

        if (!shift) {
          set.status = 404;
          return { success: false, error: "Shift not found or inactive" };
        }

        if (shift.shiftDate === "1970-01-01") {
          set.status = 400;
          return { success: false, error: "Shift is closed (result declared)" };
        }

        if (shift.endTime) {
          const endMs = istInstantMs(
            shift.shiftDate,
            shift.endTime,
            shift.nextDayAllow
          );
          if (Date.now() >= endMs) {
            set.status = 400;
            return { success: false, error: "Shift betting time has closed" };
          }
        }

        if (shift.mainJantriTime) {
          const shiftMs = istInstantMs(
            shift.shiftDate,
            shift.mainJantriTime,
            shift.nextDayAllow
          );
          if (Date.now() > shiftMs) {
            set.status = 400;
            return { success: false, error: "Shift betting time has closed" };
          }
        }

        // Capping (per-number daily limit)
        const cappingLimit = Number(shift.capping);
        if (cappingLimit > 0) {
          const existingPerNumber = await db
            .select({
              number: matkaTransactionDetails.number,
              numberType: matkaTransactionDetails.numberType,
              total: sql<string>`COALESCE(SUM(CAST(${matkaTransactionDetails.amount} AS NUMERIC)), 0)`,
            })
            .from(matkaTransactionDetails)
            .innerJoin(
              matkaTransactions,
              eq(matkaTransactionDetails.transactionId, matkaTransactions.id)
            )
            .where(
              and(
                eq(matkaTransactions.userId, userId),
                eq(matkaTransactions.shiftId, shiftId),
                eq(matkaTransactions.transactionDate, shift.shiftDate),
                eq(matkaTransactions.recordStatus, RecordStatus.Active),
                eq(matkaTransactionDetails.recordStatus, RecordStatus.Active)
              )
            )
            .groupBy(matkaTransactionDetails.number, matkaTransactionDetails.numberType);

          const existingMap = new Map<string, number>();
          for (const row of existingPerNumber) {
            existingMap.set(`${row.numberType}:${row.number}`, Number(row.total));
          }

          const exceeded: string[] = [];
          const allocatedMap = new Map(existingMap);

          for (const bet of bets) {
            const key = `${bet.numberType}:${bet.number}`;
            const allocated = allocatedMap.get(key) ?? 0;
            const remaining = Math.max(0, cappingLimit - allocated);
            if (bet.amount > remaining) {
              exceeded.push(
                `Number ${bet.number}: cap ${cappingLimit}, already bet ${allocated}, remaining ${remaining}`
              );
            } else {
              allocatedMap.set(key, allocated + bet.amount);
            }
          }

          if (exceeded.length > 0) {
            set.status = 400;
            return {
              success: false,
              error: `Capping limit exceeded. ${exceeded.join(". ")}`,
            };
          }
        }

        // Jambo rate routing by numberType:
        //   0           → tripleRate  (default 1000)
        //   1 | 2       → daraRate    (jodi, default 100)
        //   3 | 4 | 5   → akharRate   (default 10)
        // Commission columns mirror the same split.
        const tripleRate = Number(shift.tripleRate);
        const tripleCommission = Number(shift.tripleCommission);
        const daraRate = Number(shift.daraRate);
        const daraCommission = Number(shift.daraCommission);
        const akharRate = Number(shift.akharRate);
        const akharCommission = Number(shift.akharCommission);

        const resolveRate = (numberType: number) => {
          if (numberType === 0) return { rate: tripleRate, commPercent: tripleCommission };
          if (numberType === 1 || numberType === 2) return { rate: daraRate, commPercent: daraCommission };
          return { rate: akharRate, commPercent: akharCommission };
        };

        let totalAmount = 0;
        let totalCommission = 0;

        const detailRows = bets.map((bet, idx) => {
          const { rate, commPercent } = resolveRate(bet.numberType);
          const commission = (bet.amount * commPercent) / 100;
          const finalAmount = bet.amount - commission;

          totalAmount += bet.amount;
          totalCommission += commission;

          return {
            numberType: bet.numberType,
            number: bet.number,
            amount: String(bet.amount),
            rate: String(rate),
            commission: String(commission),
            finalAmount: String(finalAmount),
            orderNumber: idx + 1,
            addedBy: userId,
            updateBy: userId,
          };
        });

        const finalAmount = totalAmount - totalCommission;

        const [ledger] = await db
          .select()
          .from(ledgerLimit)
          .where(eq(ledgerLimit.userId, userId));

        if (ledger) {
          if (totalAmount > Number(ledger.finalLimit)) {
            set.status = 400;
            return { success: false, error: "Insufficient balance" };
          }
        }

        const [transaction] = await db
          .insert(matkaTransactions)
          .values({
            userId: userId,
            shiftId,
            transactionDate: shift.shiftDate,
            tripleRate: String(tripleRate),
            tripleCommission: String(tripleCommission),
            daraRate: String(daraRate),
            daraCommission: String(daraCommission),
            akharRate: String(akharRate),
            akharCommission: String(akharCommission),
            totalAmount: String(totalAmount),
            totalCommission: String(totalCommission),
            finalAmount: String(finalAmount),
            ...(copyReferenceShiftId ? { copyReferenceShiftId } : {}),
            ...(resolvedWhitelabelId ? { whitelabelId: resolvedWhitelabelId } : {}),
            addedBy: userId,
            updateBy: userId,
          })
          .returning();

        if (detailRows.length > 0) {
          await db.insert(matkaTransactionDetails).values(
            detailRows.map((row) => ({
              ...row,
              transactionId: transaction.id,
            }))
          );
        }

        await db.execute(sql`CALL set_limit_used_of_user(${userId}::uuid)`);

        const ipAddress =
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
          request.headers.get("x-real-ip") ||
          null;
        const ua = parseUserAgent(request.headers.get("user-agent"));

        await db.insert(matkaTransactionLogs).values({
          matkaTransactionId: transaction.id,
          ipAddress,
          ...ua,
          addedBy: userId,
          updateBy: userId,
        });

        // Commission snapshot (same hierarchy walk as matka)
        const hierarchyRows = await db.execute(sql`
          WITH RECURSIVE hierarchy AS (
            SELECT
              u.id AS ancestor_id,
              u.role AS ancestor_role,
              p.downline::DECIMAL(5,2) AS downline,
              1 AS depth
            FROM users u
            JOIN profiles p ON p.user_id = u.id
            WHERE u.id = (SELECT added_by FROM users WHERE id = ${userId})

            UNION ALL

            SELECT
              u2.id,
              u2.role,
              p2.downline::DECIMAL(5,2),
              h.depth + 1
            FROM hierarchy h
            JOIN users u2 ON u2.id = (SELECT added_by FROM users WHERE id = h.ancestor_id)
            JOIN profiles p2 ON p2.user_id = u2.id
            WHERE h.depth < 10
              AND u2.id IS NOT NULL
          )
          SELECT ancestor_id, ancestor_role, downline
          FROM hierarchy
          ORDER BY depth ASC
        `);

        const ancestors = Array.isArray(hierarchyRows)
          ? hierarchyRows
          : (hierarchyRows as any)?.rows || [];

        const snapshotData: typeof matkaTransactionCommissions.$inferInsert = {
          matkaTransactionId: transaction.id,
          addedBy: userId,
          updateBy: userId,
        };

        let previousDownline = 0;
        for (let i = 0; i < ancestors.length; i++) {
          const row = ancestors[i];
          const role = Number(row.ancestor_role);
          const downline = parseFloat(row.downline ?? "0");
          const share = downline - previousDownline;

          if (role === UserRole.Agent) {
            snapshotData.agentId = row.ancestor_id;
            snapshotData.agentPercent = Math.max(share, 0).toFixed(2);
          } else if (role === UserRole.Master) {
            snapshotData.masterId = row.ancestor_id;
            snapshotData.masterPercent = Math.max(share, 0).toFixed(2);
          } else if (role === UserRole.Super) {
            snapshotData.superId = row.ancestor_id;
            snapshotData.superPercent = Math.max(share, 0).toFixed(2);
          } else if (role === UserRole.Admin) {
            snapshotData.adminId = row.ancestor_id;
            snapshotData.adminPercent = Math.max(share, 0).toFixed(2);
          } else if (role === UserRole.Owner) {
            snapshotData.ownerId = row.ancestor_id;
            snapshotData.ownerPercent = Math.max(100 - previousDownline, 0).toFixed(2);
          }

          previousDownline = downline;
        }

        await db.insert(matkaTransactionCommissions).values(snapshotData);

        return {
          success: true,
          data: {
            transactionId: transaction.id,
            totalAmount,
            totalCommission,
            finalAmount,
            betCount: bets.length,
          },
        };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to place bet",
        };
      }
    },
    {
      body: t.Object({
        shiftId: t.String(),
        bets: t.Array(
          t.Object({
            number: t.String(),
            numberType: t.Number({ minimum: 0, maximum: 5 }),
            amount: t.Number({ minimum: 1 }),
          })
        ),
        copyReferenceShiftId: t.Optional(t.String()),
        whitelabelId: t.Optional(t.String()),
      }),
    }
  )

  // ── User's own jambo bet history ─────────────────────────────────────────
  .get("/my-bets", async ({ userId, set, query }) => {
    try {
      const today = new Date().toISOString().split("T")[0];
      const filterShiftId = (query as any)?.shiftId as string | undefined;
      const filterStatus = (query as any)?.status as string | undefined;

      const whereConditions: any[] = [
        eq(matkaTransactions.userId, userId),
        eq(matkaTransactions.recordStatus, RecordStatus.Active),
        eq(matkaShifts.sportType, MatkaSportType.Jambo),
      ];

      if (filterShiftId) {
        whereConditions.push(eq(matkaTransactions.shiftId, filterShiftId));
      }

      if (filterStatus === "inactive") {
        whereConditions.push(sql`${matkaTransactions.transactionDate} < ${today}::date`);
      } else {
        whereConditions.push(eq(matkaTransactions.transactionDate, today));
      }

      const txns = await db
        .select({
          id: matkaTransactions.id,
          shiftId: matkaTransactions.shiftId,
          shiftName: matkaShifts.name,
          shiftDate: matkaShifts.shiftDate,
          transactionDate: matkaTransactions.transactionDate,
          totalAmount: matkaTransactions.totalAmount,
          totalCommission: matkaTransactions.totalCommission,
          finalAmount: matkaTransactions.finalAmount,
          addedDate: matkaTransactions.addedDate,
        })
        .from(matkaTransactions)
        .innerJoin(matkaShifts, eq(matkaTransactions.shiftId, matkaShifts.id))
        .where(and(...whereConditions))
        .orderBy(desc(matkaTransactions.addedDate))
        .limit(200);

      return { success: true, data: txns };
    } catch (error) {
      set.status = 500;
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch bets",
      };
    }
  })

  // ── Single jambo transaction ─────────────────────────────────────────────
  .get("/transactions/:id", async ({ params, userId, set }) => {
    try {
      const [txn] = await db
        .select({
          id: matkaTransactions.id,
          shiftId: matkaTransactions.shiftId,
          shiftName: matkaShifts.name,
          shiftDate: matkaShifts.shiftDate,
          transactionDate: matkaTransactions.transactionDate,
          totalAmount: matkaTransactions.totalAmount,
          totalCommission: matkaTransactions.totalCommission,
          finalAmount: matkaTransactions.finalAmount,
          daraRate: matkaTransactions.daraRate,
          akharRate: matkaTransactions.akharRate,
          addedDate: matkaTransactions.addedDate,
        })
        .from(matkaTransactions)
        .innerJoin(matkaShifts, eq(matkaTransactions.shiftId, matkaShifts.id))
        .where(
          and(
            eq(matkaTransactions.id, params.id),
            eq(matkaTransactions.userId, userId),
            eq(matkaTransactions.recordStatus, RecordStatus.Active),
            eq(matkaShifts.sportType, MatkaSportType.Jambo)
          )
        );

      if (!txn) {
        set.status = 404;
        return { success: false, error: "Transaction not found" };
      }

      const details = await db
        .select({
          id: matkaTransactionDetails.id,
          numberType: matkaTransactionDetails.numberType,
          number: matkaTransactionDetails.number,
          amount: matkaTransactionDetails.amount,
          rate: matkaTransactionDetails.rate,
          commission: matkaTransactionDetails.commission,
        })
        .from(matkaTransactionDetails)
        .where(
          and(
            eq(matkaTransactionDetails.transactionId, params.id),
            eq(matkaTransactionDetails.recordStatus, RecordStatus.Active)
          )
        );

      return { success: true, data: { ...txn, details } };
    } catch (error) {
      set.status = 500;
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch transaction",
      };
    }
  })

  // ── Soft-delete a jambo transaction ──────────────────────────────────────
  .delete("/transactions/:id", async ({ params, userId, set }) => {
    try {
      const [txn] = await db
        .select()
        .from(matkaTransactions)
        .innerJoin(matkaShifts, eq(matkaTransactions.shiftId, matkaShifts.id))
        .where(
          and(
            eq(matkaTransactions.id, params.id),
            eq(matkaTransactions.userId, userId),
            eq(matkaTransactions.recordStatus, RecordStatus.Active),
            eq(matkaShifts.sportType, MatkaSportType.Jambo)
          )
        );

      if (!txn) {
        set.status = 404;
        return { success: false, error: "Transaction not found" };
      }

      await db
        .update(matkaTransactions)
        .set({ recordStatus: RecordStatus.Deleted })
        .where(eq(matkaTransactions.id, params.id));

      await db
        .update(matkaTransactionDetails)
        .set({ recordStatus: RecordStatus.Deleted })
        .where(eq(matkaTransactionDetails.transactionId, params.id));

      await db.execute(sql`CALL set_limit_used_of_user(${userId}::uuid)`);

      return { success: true };
    } catch (error) {
      set.status = 500;
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to delete transaction",
      };
    }
  });
