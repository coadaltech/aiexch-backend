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
import { RecordStatus, UserRole } from "../../types/enums";

// Synthetic event_type_id used to mark matka result rows in market_results.
const MATKA_EVENT_TYPE_ID = 999;

// Returns a 403 response object if the caller is not an Owner. Used to gate
// shift CRUD and result-declaration endpoints. Returning from `beforeHandle`
// short-circuits the request.
const ownerOnly = ({ store, set }: any) => {
  if (store.role !== UserRole.Owner) {
    set.status = 403;
    return { success: false, message: "Owner access only" };
  }
};

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
      const conditions = [eq(matkaShifts.recordStatus, RecordStatus.Active)];

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
    async ({ body, set, store }) => {
      try {
        // Auto-increment order: get the max shiftOrder for active shifts
        const [maxOrder] = await db
          .select({ max: sql<number>`COALESCE(MAX(${matkaShifts.shiftOrder}), 0)` })
          .from(matkaShifts)
          .where(eq(matkaShifts.recordStatus, RecordStatus.Active));

        const nextOrder = (maxOrder?.max ?? 0) + 1;

        const [shift] = await db
          .insert(matkaShifts)
          .values({
            name: body.name,
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
            addedBy: (store as any).id || SYSTEM_USER_ID,
            updateBy: (store as any).id || SYSTEM_USER_ID,
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
      beforeHandle: ownerOnly,
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

  // ── Reorder shifts (bulk update order) — owner only ─────────────────────
  // NOTE: must be before /shifts/:id to avoid path conflict
  .put(
    "/shifts/reorder",
    async ({ body, set, store }) => {
      try {
        const updates = body.orders.map((item) =>
          db
            .update(matkaShifts)
            .set({
              shiftOrder: item.shiftOrder,
              updateBy: (store as any).id || SYSTEM_USER_ID,
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
      beforeHandle: ownerOnly,
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

  // ── Update a shift — owner only ──────────────────────────────────────────
  .put(
    "/shifts/:id",
    async ({ body, params, set, store }) => {
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
          updateBy: (store as any).id || SYSTEM_USER_ID,
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
      beforeHandle: ownerOnly,
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

  // ── Delete a shift (soft delete) — owner only ────────────────────────────
  .delete(
    "/shifts/:id",
    async ({ params, set, store }) => {
      try {
        const [updated] = await db
          .update(matkaShifts)
          .set({
            recordStatus: RecordStatus.Deleted,
            updateBy: (store as any).id || SYSTEM_USER_ID,
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
    { beforeHandle: ownerOnly }
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
  .get("/live-prediction/:shiftId", async ({ params, set, store }) => {
    try {
      const viewerId = (store as any).id;
      const viewerRole = Number((store as any).role);
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

      // Call the existing SQL function directly. It returns (shift_id, nums,
      // amount, profit) for nums 1..100. We display whatever it gives back —
      // the function's logic is maintained separately in 01_matka_procedures.sql.
      let jantriRows: any[] = [];
      try {
        const jr = await db.execute(sql`
          SELECT nums, amount::text AS sale, profit::text AS profit
          FROM public.get_user_matka_jantri_of_group(
            ${viewerId}::uuid, ${params.shiftId}::uuid, ${viewerRole}::int
          )
        `);
        jantriRows = (jr as any).rows ?? jr;
      } catch (e) {
        console.error("[live-prediction] jantri function call failed:", e);
      }

      const declaredMap = new Map<string, number>();

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
          declared_count: declaredMap.get(`1:${n}`) ?? 0,
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

  // ── Live Prediction: party breakdown for a single number ────────────────
  .get(
    "/live-prediction/:shiftId/whitelabels",
    async ({ params, query, set, store }) => {
      try {
        const viewerId = (store as any).id;
        const viewerRole = Number((store as any).role);
        const cfg = roleConfig(viewerRole);

        const num = Number(query?.nums);
        // Determine which number_type this nums belongs to:
        //   1..100             → type 1 (dara)
        //   111..999 repeating → type 2 (bahar)
        //   1111..9999 repeating → type 3 (ander)
        let numType: 1 | 2 | 3 | null = null;
        if (Number.isInteger(num) && num >= 1 && num <= 100) numType = 1;
        else if ([111, 222, 333, 444, 555, 666, 777, 888, 999].includes(num)) numType = 2;
        else if ([1111, 2222, 3333, 4444, 5555, 6666, 7777, 8888, 9999].includes(num)) numType = 3;

        if (!numType) {
          set.status = 400;
          return {
            success: false,
            error:
              "Invalid nums (must be 1-100, 111/222/.../999, or 1111/2222/.../9999)",
          };
        }
        if (!cfg) {
          set.status = 403;
          return { success: false, error: "Role not supported" };
        }

        // "Party" is the viewer's nearest non-null downline level.
        // We INNER-JOIN commissions filtered by the viewer's role column so
        // only bets in which the viewer actually has a stake show up, and
        // the P/L column uses that viewer's commission percentage.
        const partyIdExpr = sql.raw(`(${cfg.downlineSql})::text`);
        const partyJoinExpr = sql.raw(`pu.id = ${cfg.downlineSql}`);

        // Profit/sale only consider bets of the SAME number_type as the
        // selected number — a dara bet on 50 doesn't affect bahar 333.
        // Profit/sale only consider bets of the SAME number_type as the
        // selected number — a dara bet on 50 doesn't affect bahar 333.
        const breakdown = await db.execute(sql`
          WITH base AS (
            SELECT
              ${partyIdExpr}             AS party_id,
              COALESCE(pu.username, '—') AS party_name,
              SUM(CASE
                WHEN mtd.number_type = ${numType}
                 AND mtd.number::integer = ${num}
                THEN mtd.amount ELSE 0
              END) AS sale,
              SUM(
                (CASE
                  WHEN mtd.number_type = ${numType} THEN
                    CASE WHEN mtd.number::integer = ${num}
                      THEN mtd.amount * mtd.rate
                      ELSE -mtd.amount
                    END
                  ELSE 0
                END) * (${sql.raw("mtc." + cfg.percentCol)} / 100)
              ) AS player_profit_share
            FROM matka_transactions mt
            JOIN matka_transaction_commissions mtc
              ON mtc.matka_transaction_id = mt.id
             AND mtc.record_status = 0
             AND ${sql.raw("mtc." + cfg.viewerCol)} = ${viewerId}::uuid
            JOIN matka_transaction_details mtd
              ON mtd.transaction_id = mt.id AND mtd.record_status = 0
            LEFT JOIN users pu ON ${partyJoinExpr}
            WHERE mt.shift_id = ${params.shiftId}::uuid
              AND mt.record_status = 0
            GROUP BY ${partyIdExpr}, pu.username
          )
          SELECT
            party_id                                          AS whitelabel_id,
            party_name                                        AS whitelabel_name,
            ROUND(COALESCE(sale, 0), 2)::text                 AS sale,
            ROUND(-COALESCE(player_profit_share, 0), 2)::text AS profit
          FROM base
          ORDER BY player_profit_share ASC
        `);

        const wlRows: any[] = (breakdown as any).rows ?? breakdown;

        // Last-N-shift consecutive W/L streak per party. A "W" is when the
        // viewer's net profit on that party for the declared shift is
        // positive (i.e. that party's bets lost overall).
        const recentDeclared = await db.execute(sql`
          SELECT id, runs, declared_at,
                 (api_response->>'shiftId')::uuid AS shift_id
          FROM market_results
          WHERE event_type_id = ${MATKA_EVENT_TYPE_ID}
            AND status = 'DECLARED'
            AND record_status = 0
            AND runs IS NOT NULL
            AND api_response ? 'shiftId'
          ORDER BY declared_at DESC
          LIMIT 20
        `);
        const declaredList: any[] = (recentDeclared as any).rows ?? recentDeclared;

        const streakByWl = new Map<string, { status: "W" | "L"; count: number }>();
        for (const wl of wlRows) {
          const wlId = wl.whitelabel_id as string | null;
          if (!wlId) {
            streakByWl.set("null", { status: "L", count: 0 });
            continue;
          }
          let status: "W" | "L" | null = null;
          let count = 0;
          const partyMatchSql = sql`(${sql.raw(cfg.downlineSql)})::text = ${wlId}`;
          for (const dec of declaredList) {
            const r = await db.execute(sql`
              SELECT COALESCE(SUM(
                (CASE
                  WHEN mtd.number_type = 1
                    THEN (CASE WHEN mtd.number::integer = ${dec.runs}                                THEN mtd.amount * mtd.rate ELSE -mtd.amount END)
                  WHEN mtd.number_type = 2
                    THEN (CASE WHEN mtd.number::integer = (${dec.runs} % 10) * 111                  THEN mtd.amount * mtd.rate ELSE -mtd.amount END)
                  WHEN mtd.number_type = 3
                    THEN (CASE WHEN mtd.number::integer = (${dec.runs} / 10) * 1111 THEN mtd.amount * mtd.rate ELSE -mtd.amount END)
                  ELSE 0
                END) * (${sql.raw("mtc." + cfg.percentCol)} / 100)
              ), 0)::numeric AS player_share
              FROM matka_transactions mt
              JOIN matka_transaction_commissions mtc
                ON mt.id = mtc.matka_transaction_id AND mtc.record_status = 0
                AND ${sql.raw("mtc." + cfg.viewerCol)} = ${viewerId}::uuid
              JOIN matka_transaction_details mtd
                ON mt.id = mtd.transaction_id AND mtd.record_status = 0
              WHERE mt.shift_id = ${dec.shift_id}::uuid
                AND ${partyMatchSql}
                AND mt.record_status = 0
            `);
            const playerShare = Number(((r as any).rows ?? r)[0]?.player_share ?? 0);
            if (playerShare === 0) continue; // no exposure on this shift, skip
            const ownerProfit = -playerShare;
            const cur: "W" | "L" = ownerProfit > 0 ? "W" : "L";
            if (status === null) {
              status = cur;
              count = 1;
            } else if (cur === status) {
              count += 1;
            } else {
              break;
            }
          }
          streakByWl.set(wlId, { status: status ?? "L", count });
        }

        const data = wlRows.map((r) => {
          const key = (r.whitelabel_id as string) ?? "null";
          const s = streakByWl.get(key) ?? { status: "L", count: 0 };
          return {
            whitelabelId: r.whitelabel_id,
            whitelabelName: r.whitelabel_name,
            sale: r.sale,
            profit: r.profit,
            lastWinStatus: s.status,
            consecutiveCount: s.count,
          };
        });

        return { success: true, data };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to fetch whitelabel breakdown",
        };
      }
    }
  )

  // ── Live Prediction: per-whitelabel (or all) jantri grid for a shift ──────
  .get(
    "/live-prediction/:shiftId/jantri",
    async ({ params, query, set, store }) => {
      try {
        const viewerId = (store as any).id;
        const viewerRole = Number((store as any).role);
        const cfg = roleConfig(viewerRole);
        if (!cfg) {
          set.status = 403;
          return { success: false, error: "Role not supported" };
        }

        const wlParam = (query?.whitelabelId as string | undefined) ?? "all";
        const isAll = wlParam === "all" || !wlParam;

        // Party id from the breakdown is the resolved downline uuid. Filter
        // rows so we only see bets that pass through both the viewer AND the
        // selected party.
        const partyFilter = isAll
          ? sql``
          : sql`AND (${sql.raw(cfg.downlineSql)})::text = ${wlParam}`;

        // Same candidate set as the Numbers list: dara 1..100, bahar 111..999
        // (repeating triplets), ander 1111..9999 (repeating quadruplets).
        const rows = await db.execute(sql`
          WITH all_nums AS (
            SELECT generate_series AS nums, 1 AS num_type FROM generate_series(1, 100)
            UNION ALL
            SELECT generate_series * 111,  2 FROM generate_series(1, 9)
            UNION ALL
            SELECT generate_series * 1111, 3 FROM generate_series(1, 9)
          )
          SELECT
            an.nums::int     AS nums,
            an.num_type::int AS num_type,
            COALESCE(SUM(CASE
              WHEN mtd.number_type = an.num_type
               AND mtd.number::integer = an.nums
              THEN mtd.amount ELSE 0
            END), 0)::text AS sale
          FROM all_nums an
          LEFT JOIN matka_transactions mt
            ON mt.shift_id = ${params.shiftId}::uuid
            AND mt.record_status = 0
          LEFT JOIN matka_transaction_commissions mtc
            ON mtc.matka_transaction_id = mt.id
            AND mtc.record_status = 0
            AND ${sql.raw("mtc." + cfg.viewerCol)} = ${viewerId}::uuid
            ${partyFilter}
          LEFT JOIN matka_transaction_details mtd
            ON mtd.transaction_id = mt.id
            AND mtd.record_status = 0
          GROUP BY an.nums, an.num_type
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

  // ── Live Prediction: declare a result for a shift ─────────────────────────
  .post(
    "/live-prediction/:shiftId/declare",
    async ({ params, body, set, store }) => {
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

        // marketId must be unique numeric — use epoch microseconds.
        const uniqueMarketId = String(Date.now() * 1000 + Math.floor(Math.random() * 1000));
        const ownerId = (store as any).id || SYSTEM_USER_ID;

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
      beforeHandle: ownerOnly,
      body: t.Object({ result: t.Number() }),
    }
  )

  // ── Live Prediction: history of previously declared matka results ─────────
  .get("/live-prediction/declared-history", async ({ query, set }) => {
    try {
      const limit = Math.min(Number(query?.limit ?? 50), 200);
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
