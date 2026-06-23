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
  profiles,
  declareResult,
} from "../db/schema";
import { eq, and, desc, sql, ne, gte, lte } from "drizzle-orm";
import { app_middleware } from "../middleware/auth";
import { parseUserAgent } from "../utils/parse-ua";
import { RecordStatus, UserRole, MatkaSportType } from "../types/enums";

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
            eq(matkaShifts.sportType, MatkaSportType.Matka),
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
            eq(matkaShifts.sportType, MatkaSportType.Matka),
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

      // Shifts whose result was just declared are parked at 1970-01-01
      // until the daily cron rolls them to the next date. Surface them so
      // the UI can show the shift name + declared number in place of the
      // countdown.
      const declaredShifts = await db
        .select()
        .from(matkaShifts)
        .where(
          and(
            eq(matkaShifts.isActive, true),
            eq(matkaShifts.recordStatus, RecordStatus.Active),
            eq(matkaShifts.sportType, MatkaSportType.Matka),
            eq(matkaShifts.shiftDate, "1970-01-01")
          )
        )
        .orderBy(matkaShifts.shiftOrder);

      // Attach the latest declared number to each parked shift. One query
      // covers them all; map by shift_id client-side.
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

  // ── Public: get single shift details ──────────────────────────────────────
  .get("/shifts/:id", async ({ params, set }) => {
    try {
      const [shift] = await db
        .select()
        .from(matkaShifts)
        .where(
          and(
            eq(matkaShifts.id, params.id),
            eq(matkaShifts.sportType, MatkaSportType.Matka),
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
  // Optional ?date=YYYY-MM-DD to filter by transactionDate
  .get("/shifts/:id/jantri", async ({ params, set, query }) => {
    try {
      const dateFilter = (query as any)?.date as string | undefined;

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

  // ── Protected routes ──────────────────────────────────────────────────────
  // Per-request user context via .resolve() (NOT .state(), which is module-shared
  // and leaks userId across concurrent requests). See betting.ts for the full
  // explanation of the original bug.
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

  // ── Place bet (submit jantri) ─────────────────────────────────────────────
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

        // Resolve whitelabelId from the user's record if not provided
        let resolvedWhitelabelId = whitelabelId;
        if (!resolvedWhitelabelId) {
          const [betUser] = await db
            .select({ whitelabelId: users.whitelabelId })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
          resolvedWhitelabelId = betUser?.whitelabelId ?? undefined;
        }

        // Validate shift exists and is active
        const [shift] = await db
          .select()
          .from(matkaShifts)
          .where(
            and(
              eq(matkaShifts.id, shiftId),
              eq(matkaShifts.isActive, true),
              eq(matkaShifts.sportType, MatkaSportType.Matka),
              eq(matkaShifts.recordStatus, RecordStatus.Active)
            )
          );

        if (!shift) {
          set.status = 404;
          return { success: false, error: "Shift not found or inactive" };
        }

        // Shift's date was reset (result already declared). Block any bet.
        if (shift.shiftDate === "1970-01-01") {
          set.status = 400;
          return { success: false, error: "Shift is closed (result declared)" };
        }

        // Block betting once the shift end_time has passed — even by one
        // second. `end_time` is HH:MM local to the shift_date (extended to
        // the next day when nextDayAllow is true).
        if (shift.endTime) {
          const [endH, endM] = shift.endTime.split(":").map(Number);
          const endAt = new Date(shift.shiftDate);
          endAt.setHours(endH, endM, 0, 0);
          if (shift.nextDayAllow) {
            endAt.setDate(endAt.getDate() + 1);
          }
          if (new Date().getTime() >= endAt.getTime()) {
            set.status = 400;
            return { success: false, error: "Shift betting time has closed" };
          }
        }

        // Additional main-jantri cutoff (kept for shifts that use it).
        if (shift.mainJantriTime) {
          const now = new Date();
          const [hours, minutes] = shift.mainJantriTime.split(":").map(Number);
          const shiftTime = new Date(shift.shiftDate);
          shiftTime.setHours(hours, minutes, 0, 0);
          if (shift.nextDayAllow) {
            shiftTime.setDate(shiftTime.getDate() + 1);
          }
          if (now > shiftTime) {
            set.status = 400;
            return { success: false, error: "Shift betting time has closed" };
          }
        }

        // Check capping (per-number bet limit for this shift per day)
        const cappingLimit = Number(shift.capping);
        if (cappingLimit > 0) {
          // Get amount already bet per number by this user on this shift TODAY
          const existingPerNumber = await db
            .select({
              number: matkaTransactionDetails.number,
              numberType: matkaTransactionDetails.numberType,
              total: sql<string>`COALESCE(SUM(CAST(${matkaTransactionDetails.amount} AS NUMERIC)), 0)`,
            })
            .from(matkaTransactionDetails)
            .innerJoin(matkaTransactions, eq(matkaTransactionDetails.transactionId, matkaTransactions.id))
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

          // Build a map of existing amounts: "numberType:number" → amount
          const existingMap = new Map<string, number>();
          for (const row of existingPerNumber) {
            existingMap.set(`${row.numberType}:${row.number}`, Number(row.total));
          }

          // Check each bet's number total doesn't exceed capping, collect all violations
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
            addedBy: userId,
            updateBy: userId,
          };
        });

        const finalAmount = totalAmount - totalCommission;

        // Check user balance
        const [ledger] = await db
          .select()
          .from(ledgerLimit)
          .where(eq(ledgerLimit.userId, userId));

        if (ledger) {
          // const available = Number(ledger.creditLimit) - Number(ledger.limitConsumed);
          if (totalAmount > Number(ledger.finalLimit)) {
            set.status = 400;
            return { success: false, error: "Insufficient balance" };
          }
        }

        // Create transaction + details in a single batch
        const [transaction] = await db
          .insert(matkaTransactions)
          .values({
            userId: userId,
            shiftId,
            transactionDate: shift.shiftDate,
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

        // Insert all bet details
        if (detailRows.length > 0) {
          await db.insert(matkaTransactionDetails).values(
            detailRows.map((row) => ({
              ...row,
              transactionId: transaction.id,
            }))
          );
        }

        // Recalculate exposure and update ledger_limit
        await db.execute(sql`CALL set_limit_used_of_user(${userId}::uuid)`);

        // Insert matka transaction log
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

        // ── Commission snapshot ──
        // Walk up the hierarchy: User → Agent → Master → Super → Admin → Owner
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

        const ancestors = Array.isArray(hierarchyRows) ? hierarchyRows : (hierarchyRows as any)?.rows || [];

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
            numberType: t.Number(),
            amount: t.Number({ minimum: 1 }),
          })
        ),
        copyReferenceShiftId: t.Optional(t.String()),
        whitelabelId: t.Optional(t.String()),
      }),
    }
  )

  // ── Get user's matka bet history ──────────────────────────────────────────
  // Query params:
  //   ?shiftId=uuid   – filter by shift
  //   ?status=active  – only today's transactions (default)
  //   ?status=inactive – only transactions before today
  .get("/my-bets", async ({ userId, set, query }) => {
    try {
      const filterShiftId = (query as any)?.shiftId as string | undefined;
      const filterStatus = ((query as any)?.status as string | undefined) ?? "active";

      // Single SQL function handles: matka-only sport_type filter, optional
      // shiftId, active/inactive date window, order+limit, and the copy-
      // reference shift name LEFT JOIN. Replaces the 1 header query + 1
      // follow-up refShift query + JS-side merging.
      const rows = await db.execute(sql`
        SELECT fn_get_user_matka_bets(
          ${userId}::uuid,
          ${MatkaSportType.Matka}::int,
          ${filterShiftId ?? null}::uuid,
          ${filterStatus}::text,
          ${200}::int
        ) AS data
      `);

      const rowArray = Array.isArray(rows) ? rows : (rows as any)?.rows ?? [];
      const data: any[] = (rowArray[0]?.data as any[] | null) ?? [];

      return { success: true, data };
    } catch (error) {
      set.status = 500;
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch bets",
      };
    }
  })

  // ── Live Prediction: per-number sale + P/L for the logged-in player ──────
  // Numbers the user has placed bets on, plus the player-side profit if
  // that number wins. Mirrors the math in public.get_user_matka_jantri so
  // the page shows correct wins/losses for dara + bahar + ander.
  .get("/live-prediction/:shiftId", async ({ params, userId, set }) => {
    try {

      const [shift] = await db
        .select()
        .from(matkaShifts)
        .where(eq(matkaShifts.id, params.shiftId));

      if (!shift) {
        set.status = 404;
        return { success: false, error: "Shift not found" };
      }

      const rows = await db.execute(sql`
        WITH all_nums AS (
          SELECT generate_series AS nums, 1 AS num_type FROM generate_series(1, 100)
          UNION ALL
          SELECT generate_series * 111,  2 FROM generate_series(1, 9)
          UNION ALL
          SELECT generate_series * 1111, 3 FROM generate_series(1, 9)
        ),
        rows AS (
          SELECT nums, num_type,
            CASE num_type
              WHEN 1 THEN nums
              WHEN 2 THEN nums / 111
              WHEN 3 THEN (nums / 1111) * 10
            END AS r
          FROM all_nums
        )
        SELECT
          an.nums::int     AS nums,
          an.num_type::int AS num_type,
          COALESCE(SUM(CASE
            WHEN mtd.number_type = an.num_type
             AND mtd.number::integer = an.nums
            THEN mtd.amount ELSE 0
          END), 0)::text AS sale,
          ROUND(COALESCE(SUM(CASE
            WHEN mtd.number_type = 1 THEN
              CASE WHEN mtd.number::integer = an.r
                THEN mtd.amount * mtd.rate ELSE -mtd.amount END
            WHEN mtd.number_type = 2 THEN
              CASE WHEN mtd.number::integer = (an.r % 10) * 111
                THEN mtd.amount * mtd.rate ELSE -mtd.amount END
            WHEN mtd.number_type = 3 THEN
              CASE WHEN mtd.number::integer = (an.r / 10) * 1111
                THEN mtd.amount * mtd.rate ELSE -mtd.amount END
            ELSE 0
          END), 0), 2)::text AS profit
        FROM rows an
        LEFT JOIN matka_transactions mt
          ON mt.user_id  = ${userId}::uuid
         AND mt.shift_id = ${params.shiftId}::uuid
         AND mt.record_status = 0
        LEFT JOIN matka_transaction_details mtd
          ON mtd.transaction_id = mt.id
         AND mtd.record_status = 0
        GROUP BY an.nums, an.num_type
        ORDER BY an.num_type, an.nums
      `);

      const numbers = ((rows as any).rows ?? rows).map((r: any) => ({
        nums: Number(r.nums),
        num_type: Number(r.num_type),
        sale: r.sale,
        profit: r.profit,
      }));

      return { success: true, data: { shift, numbers } };
    } catch (error) {
      console.error("[user live-prediction] failed:", error);
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

  // ── Declared matka results history (read-only for players) ────────────────
  .get("/declared-history", async ({ query, set }) => {
    try {
      const limit = Math.min(Number((query as any)?.limit ?? 50), 200);
      const rows = await db.execute(sql`
        SELECT
          id, runs, declared_at,
          (api_response->>'shiftName') AS shift_name,
          (api_response->>'shiftDate') AS shift_date,
          (api_response->>'shiftId')   AS shift_id
        FROM market_results
        WHERE event_type_id = 999
          AND status = 'DECLARED'
          AND record_status = 0
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
  })

  // ── Get single transaction with details ───────────────────────────────────
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
            eq(matkaShifts.sportType, MatkaSportType.Matka)
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

  // ── Soft-delete a transaction ─────────────────────────────────────────────
  .delete("/transactions/:id", async ({ params, userId, set }) => {
    try {
      // Verify ownership
      const [txn] = await db
        .select()
        .from(matkaTransactions)
        .where(
          and(
            eq(matkaTransactions.id, params.id),
            eq(matkaTransactions.userId, userId),
            eq(matkaTransactions.recordStatus, RecordStatus.Active)
          )
        );

      if (!txn) {
        set.status = 404;
        return { success: false, error: "Transaction not found" };
      }

      // Soft-delete transaction and its details
      await db
        .update(matkaTransactions)
        .set({ recordStatus: RecordStatus.Deleted })
        .where(eq(matkaTransactions.id, params.id));

      await db
        .update(matkaTransactionDetails)
        .set({ recordStatus: RecordStatus.Deleted })
        .where(eq(matkaTransactionDetails.transactionId, params.id));

      // Recalculate exposure and update ledger_limit
      await db.execute(sql`CALL set_limit_used_of_user(${userId}::uuid)`);

      return { success: true };
    } catch (error) {
      set.status = 500;
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to delete transaction",
      };
    }
  })

  // ── Update (edit) a transaction ───────────────────────────────────────────
  .put(
    "/transactions/:id",
    async ({ params, userId, set, body }) => {
      try {
        const { bets } = body as {
          bets: { number: string; numberType: number; amount: number }[];
        };

        if (!bets || bets.length === 0) {
          set.status = 400;
          return { success: false, error: "Bets are required" };
        }

        // Verify ownership
        const [txn] = await db
          .select()
          .from(matkaTransactions)
          .where(
            and(
              eq(matkaTransactions.id, params.id),
              eq(matkaTransactions.userId, userId),
              eq(matkaTransactions.recordStatus, RecordStatus.Active)
            )
          );

        if (!txn) {
          set.status = 404;
          return { success: false, error: "Transaction not found" };
        }

        // Validate shift still open
        if (!txn.shiftId) {
          set.status = 400;
          return { success: false, error: "Transaction has no associated shift" };
        }

        const [shift] = await db
          .select()
          .from(matkaShifts)
          .where(
            and(
              eq(matkaShifts.id, txn.shiftId),
              eq(matkaShifts.isActive, true),
              eq(matkaShifts.recordStatus, RecordStatus.Active)
            )
          );

        if (!shift) {
          set.status = 400;
          return { success: false, error: "Shift not found or inactive" };
        }

        if (shift.mainJantriTime) {
          const now = new Date();
          const [hours, minutes] = shift.mainJantriTime.split(":").map(Number);
          const shiftTime = new Date(shift.shiftDate);
          shiftTime.setHours(hours, minutes, 0, 0);
          if (shift.nextDayAllow) {
            shiftTime.setDate(shiftTime.getDate() + 1);
          }
          if (now > shiftTime) {
            set.status = 400;
            return { success: false, error: "Shift betting time has closed" };
          }
        }

        // Calculate new totals
        const daraRate = Number(shift.daraRate);
        const daraCommission = Number(shift.daraCommission);
        const akharRate = Number(shift.akharRate);
        const akharCommission = Number(shift.akharCommission);

        let newTotalAmount = 0;
        let newTotalCommission = 0;

        const newDetailRows = bets.map((bet, idx) => {
          const isAkhar = bet.numberType === 2 || bet.numberType === 3;
          const rate = isAkhar ? akharRate : daraRate;
          const commPercent = isAkhar ? akharCommission : daraCommission;
          const commission = (bet.amount * commPercent) / 100;
          const finalAmt = bet.amount - commission;

          newTotalAmount += bet.amount;
          newTotalCommission += commission;

          return {
            transactionId: params.id,
            numberType: bet.numberType,
            number: bet.number,
            amount: String(bet.amount),
            rate: String(rate),
            commission: String(commission),
            finalAmount: String(finalAmt),
            orderNumber: idx + 1,
            addedBy: userId,
            updateBy: userId,
          };
        });

        const newFinalAmount = newTotalAmount - newTotalCommission;

        // Recalculate exposure and update ledger_limit
        await db.execute(sql`CALL set_limit_used_of_user(${userId}::uuid)`);

        // Soft-delete existing details
        await db
          .update(matkaTransactionDetails)
          .set({ recordStatus: RecordStatus.Deleted })
          .where(eq(matkaTransactionDetails.transactionId, params.id));

        // Insert new details
        await db.insert(matkaTransactionDetails).values(newDetailRows);

        // Update transaction header
        await db
          .update(matkaTransactions)
          .set({
            totalAmount: String(newTotalAmount),
            totalCommission: String(newTotalCommission),
            finalAmount: String(newFinalAmount),
            updateBy: userId,
          })
          .where(eq(matkaTransactions.id, params.id));

        return {
          success: true,
          data: {
            transactionId: params.id,
            totalAmount: newTotalAmount,
            totalCommission: newTotalCommission,
            finalAmount: newFinalAmount,
            betCount: bets.length,
          },
        };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to update transaction",
        };
      }
    },
    {
      body: t.Object({
        bets: t.Array(
          t.Object({
            number: t.String(),
            numberType: t.Number(),
            amount: t.Number({ minimum: 1 }),
          })
        ),
      }),
    }
  );
