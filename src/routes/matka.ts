import { Elysia, t } from "elysia";
import { db } from "../db";
import {
  matkaShifts,
  matkaTransactions,
  matkaTransactionDetails,
  ledgerLimit,
  users,
} from "../db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { app_middleware } from "../middleware/auth";
import { RecordStatus } from "../types/enums";

export const matkaRoutes = new Elysia({ prefix: "/matka" })

  // ── Public: list active shifts (today) ────────────────────────────────────
  .get("/shifts", async ({ set, query }) => {
    try {
      const dateFilter = query?.date || new Date().toISOString().split("T")[0];

      // Get shifts for the requested date
      const todayShifts = await db
        .select()
        .from(matkaShifts)
        .where(
          and(
            eq(matkaShifts.isActive, true),
            eq(matkaShifts.recordStatus, RecordStatus.Active),
            eq(matkaShifts.shiftDate, dateFilter)
          )
        )
        .orderBy(matkaShifts.shiftOrder);

      // Also get yesterday's shifts that have nextDayAllow enabled
      // (they extend into today, e.g. end time 3 AM means tomorrow 3 AM)
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
            eq(matkaShifts.shiftDate, yesterdayStr),
            eq(matkaShifts.nextDayAllow, true)
          )
        )
        .orderBy(matkaShifts.shiftOrder);

      // Filter carry-over shifts: only include if the end time hasn't passed yet today
      const now = new Date();
      const activeCarryOvers = carryOverShifts.filter((s) => {
        if (!s.endTime) return false;
        const [h, m] = s.endTime.split(":").map(Number);
        const endToday = new Date(dateFilter);
        endToday.setHours(h, m, 0, 0);
        return now < endToday;
      });

      return { success: true, data: [...activeCarryOvers, ...todayShifts] };
    } catch (error) {
      set.status = 500;
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch shifts",
      };
    }
  })

  // ── Public: get single shift details ──────────────────────────────────────
  .get("/shifts/:id", async ({ params, set }) => {
    try {
      const [shift] = await db
        .select()
        .from(matkaShifts)
        .where(
          and(
            eq(matkaShifts.id, params.id),
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

  // ── Public: get jantri totals for a shift ─────────────────────────────────
  // Returns aggregated bet amounts per number for display in the grid
  .get("/shifts/:id/jantri", async ({ params, set }) => {
    try {
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

  // ── Protected routes ──────────────────────────────────────────────────────
  .state({ id: "" as string, role: 0 as number })
  .guard({
    beforeHandle({ cookie, headers, set, store }) {
      const state_result = app_middleware({ cookie, headers });
      set.status = state_result.code;
      if (!state_result.data) return state_result;
      store.id = state_result.data.id;
      store.role = state_result.data.role;
    },
  })

  // ── Place bet (submit jantri) ─────────────────────────────────────────────
  .post(
    "/place",
    async ({ body, store, set }) => {
      try {
        const { shiftId, bets } = body as {
          shiftId: string;
          bets: { number: string; numberType: number; amount: number }[];
        };

        if (!shiftId || !bets || bets.length === 0) {
          set.status = 400;
          return { success: false, error: "Shift ID and bets are required" };
        }

        // Validate shift exists and is active
        const [shift] = await db
          .select()
          .from(matkaShifts)
          .where(
            and(
              eq(matkaShifts.id, shiftId),
              eq(matkaShifts.isActive, true),
              eq(matkaShifts.recordStatus, RecordStatus.Active)
            )
          );

        if (!shift) {
          set.status = 404;
          return { success: false, error: "Shift not found or inactive" };
        }

        // Check if shift time has passed
        if (shift.mainJantriTime) {
          const now = new Date();
          const [hours, minutes] = shift.mainJantriTime.split(":").map(Number);
          const shiftTime = new Date(shift.shiftDate);
          shiftTime.setHours(hours, minutes, 0, 0);
          // If nextDayAllow is true, the cutoff extends to the next day
          if (shift.nextDayAllow) {
            shiftTime.setDate(shiftTime.getDate() + 1);
          }
          if (now > shiftTime) {
            set.status = 400;
            return { success: false, error: "Shift betting time has closed" };
          }
        }

        // Check capping (user bet limit per shift)
        const cappingLimit = Number(shift.capping);
        if (cappingLimit > 0) {
          // Get total amount already bet by this user on this shift
          const [existing] = await db
            .select({
              total: sql<string>`COALESCE(SUM(CAST(${matkaTransactions.totalAmount} AS NUMERIC)), 0)`,
            })
            .from(matkaTransactions)
            .where(
              and(
                eq(matkaTransactions.userId, store.id),
                eq(matkaTransactions.shiftId, shiftId),
                eq(matkaTransactions.recordStatus, RecordStatus.Active)
              )
            );

          const alreadyBet = Number(existing?.total ?? 0);
          const newBetTotal = bets.reduce((sum, b) => sum + b.amount, 0);

          if (alreadyBet + newBetTotal > cappingLimit) {
            set.status = 400;
            const remaining = Math.max(0, cappingLimit - alreadyBet);
            return {
              success: false,
              error: `Bet limit exceeded. Shift cap: ${cappingLimit}, already bet: ${alreadyBet}, remaining: ${remaining}`,
            };
          }
        }

        // Calculate totals
        const daraRate = Number(shift.daraRate);
        const daraCommission = Number(shift.daraCommission);
        const akharRate = Number(shift.akharRate);
        const akharCommission = Number(shift.akharCommission);

        let totalAmount = 0;
        let totalCommission = 0;

        const detailRows = bets.map((bet, idx) => {
          const isAkhar = bet.numberType === 2 || bet.numberType === 3;
          const rate = isAkhar ? akharRate : daraRate;
          const commPercent = isAkhar ? akharCommission : daraCommission;
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
            addedBy: store.id,
            updateBy: store.id,
          };
        });

        const finalAmount = totalAmount - totalCommission;

        // Check user balance
        const [ledger] = await db
          .select()
          .from(ledgerLimit)
          .where(eq(ledgerLimit.userId, store.id));

        if (ledger) {
          const available = Number(ledger.creditLimit) - Number(ledger.limitConsumed);
          if (totalAmount > available) {
            set.status = 400;
            return { success: false, error: "Insufficient balance" };
          }
        }

        // Create transaction + details in a single batch
        const [transaction] = await db
          .insert(matkaTransactions)
          .values({
            userId: store.id,
            shiftId,
            transactionDate: shift.shiftDate,
            daraRate: String(daraRate),
            daraCommission: String(daraCommission),
            akharRate: String(akharRate),
            akharCommission: String(akharCommission),
            totalAmount: String(totalAmount),
            totalCommission: String(totalCommission),
            finalAmount: String(finalAmount),
            addedBy: store.id,
            updateBy: store.id,
          })
          .returning();

        // Insert all bet details
        if (detailRows.length > 0) {
          await db.insert(matkaTransactionDetails).values(
            detailRows.map((row) => ({
              ...row,
              transactionId: transaction.id,
            }))
          );
        }

        // Update ledger consumption
        if (ledger) {
          await db
            .update(ledgerLimit)
            .set({
              limitConsumed: String(Number(ledger.limitConsumed) + totalAmount),
            })
            .where(eq(ledgerLimit.userId, store.id));
        }

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
            numberType: t.Number(),
            amount: t.Number({ minimum: 1 }),
          })
        ),
      }),
    }
  )

  // ── Get user's matka bet history ──────────────────────────────────────────
  .get("/my-bets", async ({ store, set, query }) => {
    try {
      const txns = await db
        .select({
          id: matkaTransactions.id,
          shiftId: matkaTransactions.shiftId,
          shiftName: matkaShifts.name,
          shiftDate: matkaShifts.shiftDate,
          result: matkaShifts.result,
          transactionDate: matkaTransactions.transactionDate,
          totalAmount: matkaTransactions.totalAmount,
          totalCommission: matkaTransactions.totalCommission,
          finalAmount: matkaTransactions.finalAmount,
          addedDate: matkaTransactions.addedDate,
        })
        .from(matkaTransactions)
        .innerJoin(matkaShifts, eq(matkaTransactions.shiftId, matkaShifts.id))
        .where(
          and(
            eq(matkaTransactions.userId, store.id),
            eq(matkaTransactions.recordStatus, RecordStatus.Active)
          )
        )
        .orderBy(desc(matkaTransactions.addedDate))
        .limit(50);

      return { success: true, data: txns };
    } catch (error) {
      set.status = 500;
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch bets",
      };
    }
  });
