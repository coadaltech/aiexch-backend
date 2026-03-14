import { Elysia } from "elysia";
import { db } from "../db";
import { transactions, transactionDetails, transactionLogs, users, profiles, ledgerLimit, betCommissionSnapshot } from "../db/schema";
// Note: profiles is still imported for betStatus/parentBetStatus checks
import { parseUserAgent } from "../utils/parse-ua";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { addResultToQueue } from "../queues/betting";
import { app_middleware } from "../middleware/auth";
import { redis } from "../db/redis";

export const bettingRoutes = new Elysia({ prefix: "/betting" })
  .state({ id: "" as string, role: "" })
  .guard({
    beforeHandle({ cookie, set, store }) {
      const state_result = app_middleware({ cookie });

      set.status = state_result.code;
      if (!state_result.data) return state_result;

      store.id = state_result.data.id;
      store.role = state_result.data.role;
    },
  })

  // Place a bet
  .post("/place", async ({ body, store, set, request }) => {
    try {
      const {
        matchId,
        marketId,
        selectionId,
        selectionName,
        marketName,
        marketType,
        eventTypeId,
        odds,
        stake,
        run,
        type,
        runners,
      } = body as {
        matchId: string;
        marketId: string;
        selectionId: string;
        selectionName?: string;
        marketName?: string;
        marketType?: string;
        eventTypeId?: string;
        odds: number;
        stake: number;
        run?: number | null;
        type: "back" | "lay";
        runners: { id: string; name: string; price: number }[];
      };

      // Validate input
      if (!matchId || !marketId || !selectionId || !odds || !stake || !type) {
        set.status = 400;
        return { success: false, error: "Missing required fields" };
      }

      if (stake <= 0 || odds <= 0) {
        set.status = 400;
        return { success: false, error: "Invalid stake or odds values" };
      }

      const isLineBet = marketType === "sessions";
      if (!runners || runners.length < (isLineBet ? 1 : 2)) {
        set.status = 400;
        return {
          success: false,
          error: isLineBet ? "Runner is required" : "At least two runners are required",
        };
      }

      const userData = await db
        .select({
          betStatus: profiles.betStatus,
          parentBetStatus: profiles.parentBetStatus,
        })
        .from(profiles)
        .where(eq(profiles.userId, store.id))
        .limit(1);

      if (!userData[0]) {
        set.status = 404;
        return { success: false, error: "User not found" };
      }

      const canBet = (userData[0].betStatus ?? true) && (userData[0].parentBetStatus ?? true);
      if (!canBet) {
        set.status = 403;
        return { success: false, error: "Betting is disabled for your account" };
      }

      // Server-side market status check: reject if suspended or ball running
      try {
        if (redis.isOpen) {
          const liveJson = await redis.get(`live:markets:${matchId}`);
          if (liveJson) {
            const liveMarkets: any[] = JSON.parse(liveJson);
            const targetMarket = liveMarkets.find((m: any) => m.marketId === marketId);
            if (targetMarket) {
              if (targetMarket.status === "SUSPENDED") {
                set.status = 400;
                return { success: false, error: "Bet rejected: market is suspended" };
              }
              if (targetMarket.sportingEvent) {
                set.status = 400;
                return { success: false, error: "Bet rejected: ball is running" };
              }
              if (targetMarket.marketCondition?.betLock) {
                set.status = 400;
                return { success: false, error: "Bet rejected: market is locked" };
              }
            }
          }
        }
      } catch (e) {
        // Non-critical: if Redis check fails, allow the bet through
        // (the DB trigger will still enforce limits)
      }

      // Fetch whitelabelId from users table
      const userRecord = await db
        .select({ whitelabelId: users.whitelabelId })
        .from(users)
        .where(eq(users.id, store.id))
        .limit(1);

      const whitelabelId = userRecord[0]?.whitelabelId ?? null;

      const ipAddress =
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        request.headers.get("x-real-ip") ||
        null;

      const ua = parseUserAgent(request.headers.get("user-agent"));

      const [txn] = await db.transaction(async (tx) => {
        // Insert main transaction record
        // Note: no balance deduction — the DB trigger on transaction_details
        // recalculates exposure and enforces the credit limit automatically.
        const [newTxn] = await tx
          .insert(transactions)
          .values({
            userId: store.id,
            whitelabelId: whitelabelId ?? undefined,
            eventTypeId: eventTypeId || "4",
            matchId,
            marketId,
            marketName: marketName || null,
            marketType: marketType || "odds",
            selectionId,
            selectionName: selectionName || null,
            betType: type,
            stake: stake.toString(),
            odds: odds.toString(),
            status: "matched",
            ipAddress,
            matchedAt: new Date(),
          })
          .returning();

        // Insert one row per runner into transaction_details.
        // Selected runner MUST be last so it is inserted after all other runners.
        // The DB trigger fires WHEN is_user_selection = TRUE; at that point all
        // sibling runner rows must already be visible for correct P&L calculation.
        const detailRows = runners
          .map((runner) => {
            const isSelected = runner.id === selectionId;
            const runnerReturn = isSelected ? (stake * odds).toFixed(2) : "0";
            return {
              transactionId: newTxn.id,
              runnerId: runner.id,
              runnerName: runner.name || null,
              isUserSelection: isSelected,
              betType: type,
              price: runner.price.toString(),
              run: isSelected && run != null ? run.toString() : "0",
              stake: stake.toString(),
              potentialReturn: runnerReturn,
            };
          })
          .sort((a, b) => (a.isUserSelection ? 1 : 0) - (b.isUserSelection ? 1 : 0));

        await tx.insert(transactionDetails).values(detailRows);

        await tx.insert(transactionLogs).values({
          transactionId: newTxn.id,
          userId: store.id,
          ipAddress,
          ...ua,
        });

        // Capture commission snapshot — freeze hierarchy percentages at bet time
        // Walk up the created_by chain to find agent → master → super → admin → owner
        const hierarchyRows = await tx.execute(sql`
          WITH RECURSIVE hierarchy AS (
            SELECT
              u.id AS ancestor_id,
              u.role AS ancestor_role,
              u.group_id,
              p.upline::DECIMAL(5,2) AS upline,
              1 AS depth
            FROM users u
            JOIN profiles p ON p.user_id = u.id
            WHERE u.id = (SELECT created_by FROM users WHERE id = ${store.id})

            UNION ALL

            SELECT
              u2.id,
              u2.role,
              u2.group_id,
              p2.upline::DECIMAL(5,2),
              h.depth + 1
            FROM hierarchy h
            JOIN users u2 ON u2.id = (SELECT created_by FROM users WHERE id = h.ancestor_id)
            JOIN profiles p2 ON p2.user_id = u2.id
            WHERE h.depth < 10
              AND u2.id IS NOT NULL
          )
          SELECT ancestor_id, ancestor_role, group_id, upline
          FROM hierarchy
          ORDER BY depth ASC
        `);

        const ancestors = Array.isArray(hierarchyRows) ? hierarchyRows : (hierarchyRows as any)?.rows || [];
        const snapshotData: typeof betCommissionSnapshot.$inferInsert = {
          transactionId: newTxn.id,
          userId: store.id,
        };

        for (const row of ancestors) {
          const role = String(row.ancestor_role).toLowerCase();
          const pct = row.upline != null ? String(row.upline) : "0";
          if (role === "agent") {
            snapshotData.agentId = row.ancestor_id;
            snapshotData.agentPercent = pct;
          } else if (role === "master") {
            snapshotData.masterId = row.ancestor_id;
            snapshotData.masterPercent = pct;
          } else if (role === "super") {
            snapshotData.superId = row.ancestor_id;
            snapshotData.superPercent = pct;
          } else if (role === "admin") {
            snapshotData.adminId = row.ancestor_id;
            snapshotData.adminPercent = pct;
          } else if (role === "owner") {
            snapshotData.ownerId = row.ancestor_id;
            snapshotData.ownerPercent = pct;
          }
        }

        await tx.insert(betCommissionSnapshot).values(snapshotData);

        return [newTxn];
      });

      set.status = 201;
      return { success: true, transactionId: txn.id };
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to place bet";
      // Trigger raises an exception when exposure exceeds the user's limit
      if (msg.startsWith("Bet rejected:")) {
        set.status = 400;
        return { success: false, error: msg };
      }
      set.status = 500;
      return { success: false, error: msg };
    }
  })

  // Get user's bets
  .get("/my-bets", async ({ store, query, set }) => {
    try {
      const status = (query?.status as string) || "all";
      const limit = parseInt((query?.limit as string) || "50");
      const offset = parseInt((query?.offset as string) || "0");

      let whereClause = eq(transactions.userId, store.id);
      if (status !== "all") {
        whereClause =
          and(eq(transactions.userId, store.id), eq(transactions.status, status)) ||
          eq(transactions.userId, store.id);
      }

      const userTransactions = await db
        .select()
        .from(transactions)
        .where(whereClause)
        .orderBy(desc(transactions.createdAt))
        .limit(limit)
        .offset(offset);

      // Fetch details for each transaction
      const txnIds = userTransactions.map((t) => t.id);
      const details =
        txnIds.length > 0
          ? await db
            .select()
            .from(transactionDetails)
            .where(inArray(transactionDetails.transactionId, txnIds))
          : [];

      // Group details by transactionId
      const detailsMap = details.reduce<Record<string, typeof details>>((acc, d) => {
        const key = d.transactionId;
        if (!acc[key]) acc[key] = [];
        acc[key].push(d);
        return acc;
      }, {});

      const result = userTransactions.map((t) => ({
        ...t,
        details: detailsMap[t.id] || [],
      }));

      set.status = 200;
      return { success: true, data: result };
    } catch (error) {
      console.error("Failed to fetch bets:");
      set.status = 500;
      return { success: false, error: "Failed to fetch bets" };
    }
  })

  // Cancel a transaction (matched bet)
  .post("/cancel/:transactionId", async ({ params, store, set }) => {
    try {
      const txn = await db
        .select()
        .from(transactions)
        .where(
          and(
            eq(transactions.id, params.transactionId),
            eq(transactions.userId, store.id),
            eq(transactions.status, "matched")
          )
        )
        .limit(1);

      if (!txn[0]) {
        set.status = 404;
        return {
          success: false,
          error: "Transaction not found or cannot be cancelled",
        };
      }

      // Cancel the bet — the ledger exposure will be recalculated by
      // the next bet placement. A dedicated recalc can be triggered on demand.
      await db
        .update(transactions)
        .set({ status: "cancelled", cancelledAt: new Date() })
        .where(eq(transactions.id, params.transactionId));

      set.status = 200;
      return { success: true };
    } catch (error) {
      console.error("Failed to cancel transaction:");
      set.status = 500;
      return { success: false, error: "Failed to cancel transaction" };
    }
  })

  // Owner: Declare match results
  .post("/owner/declare-result", async ({ body, set }) => {
    try {
      const { matchId, results } = body as {
        matchId: string;
        results: Record<string, "winner" | "loser">;
      };

      // Add to result processing queue
      await addResultToQueue({ matchId, results });

      set.status = 200;
      return { success: true, message: "Results queued for processing" };
    } catch (error) {
      console.error("Failed to declare results:");
      set.status = 500;
      return { success: false, error: "Failed to declare results" };
    }
  })

  .get("/ledger-info", async ({ store, set }) => {
    try {
      const ledgerData = await db
        .select()
        .from(ledgerLimit)
        .where(eq(ledgerLimit.userId, store.id))
        .limit(1);

      set.status = 200;
      return { success: true, data: ledgerData[0] || null };
    } catch (error) {
      set.status = 500;
      return { success: false, error: "Failed to fetch ledger info" };
    }
  })

  .get("/balance", async ({ store, set }) => {
    try {
      const ledgerData = await db
        .select({ userBalance: ledgerLimit.userBalance, finalLimit: ledgerLimit.finalLimit })
        .from(ledgerLimit)
        .where(eq(ledgerLimit.userId, store.id))
        .limit(1);

      set.status = 200;
      return {
        success: true,
        balance: ledgerData[0]?.userBalance || "0",
        finalLimit: ledgerData[0]?.finalLimit || "0",
      };
    } catch (error) {
      console.error("Failed to fetch balance:");
      set.status = 500;
      return { success: false, error: "Failed to fetch balance" };
    }
  });
