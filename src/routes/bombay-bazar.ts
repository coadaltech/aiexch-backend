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
import {
  BOMBAY_BAZAR_PANA_SET,
  isSinglePana,
  isDoublePana,
  isTriplePana,
} from "../utils/bombay-bazar-panas";

// ── Bombay Bazar number-type enum ─────────────────────────────────────────────
//   0 - single pana   (3 different digits, e.g. 128)
//   1 - double pana   (2 same + 1 different, e.g. 119, 577)
//   2 - triple pana   (3 same digits, e.g. 333, 000)
//   3 - jodi          (00-99)
//   4 - akhar bahar   (0-9)
//   5 - akhar andar   (0-9)
//   6 - sangam        (opening pana + closing pana, stored as concat "OOOCCC")

function validateBombayBazarNumber(numberType: number, raw: string): string | null {
  if (typeof raw !== "string") return "Invalid number";
  const s = raw.trim();
  if (!s) return "Number required";
  if (!/^\d+$/.test(s)) return "Digits only";

  switch (numberType) {
    case 0:
      if (s.length !== 3) return "Single pana must be 3 digits";
      if (!isSinglePana(s)) return "Not a valid single pana";
      if (!BOMBAY_BAZAR_PANA_SET.has(s)) return "Pana not in master list";
      return null;
    case 1:
      if (s.length !== 3) return "Double pana must be 3 digits";
      if (!isDoublePana(s)) return "Not a valid double pana";
      if (!BOMBAY_BAZAR_PANA_SET.has(s)) return "Pana not in master list";
      return null;
    case 2:
      if (s.length !== 3) return "Triple pana must be 3 digits";
      if (!isTriplePana(s)) return "Not a valid triple pana";
      return null;
    case 3: {
      if (s.length > 2) return "Jodi must be 0-99";
      const n = parseInt(s, 10);
      return n >= 0 && n <= 99 ? null : "Jodi must be 0-99";
    }
    case 4:
    case 5: {
      if (s.length !== 1) return "Akhar must be 0-9";
      const n = parseInt(s, 10);
      return n >= 0 && n <= 9 ? null : "Akhar must be 0-9";
    }
    case 6: {
      if (s.length !== 6) return "Sangam must be 6 digits (open+close)";
      const open = s.slice(0, 3);
      const close = s.slice(3, 6);
      if (!BOMBAY_BAZAR_PANA_SET.has(open)) return "Sangam opening pana not in master list";
      if (!BOMBAY_BAZAR_PANA_SET.has(close)) return "Sangam closing pana not in master list";
      return null;
    }
    default:
      return "Invalid number type (0-6)";
  }
}

export const bombayBazarRoutes = new Elysia({ prefix: "/bombay-bazar" })

  // ── Public: list active bombay-bazar shifts (mirrors jambo's listing rules) ─
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
            eq(matkaShifts.sportType, MatkaSportType.BombayBazar),
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
            eq(matkaShifts.sportType, MatkaSportType.BombayBazar),
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
            eq(matkaShifts.sportType, MatkaSportType.BombayBazar),
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

  // ── Public: single bombay-bazar shift ──────────────────────────────────────
  .get("/shifts/:id", async ({ params, set }) => {
    try {
      const [shift] = await db
        .select()
        .from(matkaShifts)
        .where(
          and(
            eq(matkaShifts.id, params.id),
            eq(matkaShifts.sportType, MatkaSportType.BombayBazar),
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

  // ── Public: aggregated jantri totals for a bombay-bazar shift ──────────────
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
        .innerJoin(matkaShifts, eq(matkaTransactions.shiftId, matkaShifts.id))
        .where(
          and(
            eq(matkaTransactions.shiftId, params.id),
            eq(matkaShifts.sportType, MatkaSportType.BombayBazar),
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

  // ── Place bombay-bazar bet ─────────────────────────────────────────────────
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

        for (const bet of bets) {
          const err = validateBombayBazarNumber(bet.numberType, bet.number);
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
              eq(matkaShifts.sportType, MatkaSportType.BombayBazar),
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
          const cutoffMs = istInstantMs(
            shift.shiftDate,
            shift.mainJantriTime,
            shift.nextDayAllow
          );
          if (Date.now() > cutoffMs) {
            set.status = 400;
            return { success: false, error: "Shift betting time has closed" };
          }
        }

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

          const allocatedMap = new Map<string, number>();
          for (const row of existingPerNumber) {
            allocatedMap.set(`${row.numberType}:${row.number}`, Number(row.total));
          }

          const exceeded: string[] = [];
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

        // Bombay Bazar rate routing by numberType:
        //   0 single pana → singlePanaRate
        //   1 double pana → doublePanaRate
        //   2 triple pana → tripleRate
        //   3 jodi        → daraRate
        //   4|5 akhar     → akharRate
        //   6 sangam      → sangamRate
        const singlePanaRate = Number(shift.singlePanaRate);
        const singlePanaCommission = Number(shift.singlePanaCommission);
        const doublePanaRate = Number(shift.doublePanaRate);
        const doublePanaCommission = Number(shift.doublePanaCommission);
        const tripleRate = Number(shift.tripleRate);
        const tripleCommission = Number(shift.tripleCommission);
        const daraRate = Number(shift.daraRate);
        const daraCommission = Number(shift.daraCommission);
        const akharRate = Number(shift.akharRate);
        const akharCommission = Number(shift.akharCommission);
        const sangamRate = Number(shift.sangamRate);
        const sangamCommission = Number(shift.sangamCommission);

        const resolveRate = (numberType: number) => {
          switch (numberType) {
            case 0: return { rate: singlePanaRate, commPercent: singlePanaCommission };
            case 1: return { rate: doublePanaRate, commPercent: doublePanaCommission };
            case 2: return { rate: tripleRate, commPercent: tripleCommission };
            case 3: return { rate: daraRate, commPercent: daraCommission };
            case 4:
            case 5: return { rate: akharRate, commPercent: akharCommission };
            case 6: return { rate: sangamRate, commPercent: sangamCommission };
            default: return { rate: 0, commPercent: 0 };
          }
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

        if (ledger && totalAmount > Number(ledger.finalLimit)) {
          set.status = 400;
          return { success: false, error: "Insufficient balance" };
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
            detailRows.map((row) => ({ ...row, transactionId: transaction.id }))
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

        // Commission snapshot — same hierarchy walk as matka/jambo
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
            numberType: t.Number({ minimum: 0, maximum: 6 }),
            amount: t.Number({ minimum: 1 }),
          })
        ),
        copyReferenceShiftId: t.Optional(t.String()),
        whitelabelId: t.Optional(t.String()),
      }),
    }
  )

  // ── User's own bombay-bazar bet history ────────────────────────────────────
  .get("/my-bets", async ({ userId, set, query }) => {
    try {
      const today = new Date().toISOString().split("T")[0];
      const filterShiftId = (query as any)?.shiftId as string | undefined;
      const filterStatus = (query as any)?.status as string | undefined;

      const whereConditions: any[] = [
        eq(matkaTransactions.userId, userId),
        eq(matkaTransactions.recordStatus, RecordStatus.Active),
        eq(matkaShifts.sportType, MatkaSportType.BombayBazar),
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

  // ── Single bombay-bazar transaction ────────────────────────────────────────
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
          tripleRate: matkaTransactions.tripleRate,
          addedDate: matkaTransactions.addedDate,
        })
        .from(matkaTransactions)
        .innerJoin(matkaShifts, eq(matkaTransactions.shiftId, matkaShifts.id))
        .where(
          and(
            eq(matkaTransactions.id, params.id),
            eq(matkaTransactions.userId, userId),
            eq(matkaTransactions.recordStatus, RecordStatus.Active),
            eq(matkaShifts.sportType, MatkaSportType.BombayBazar)
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

  // ── Soft-delete a bombay-bazar transaction ─────────────────────────────────
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
            eq(matkaShifts.sportType, MatkaSportType.BombayBazar)
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
