import { Elysia } from "elysia";
import { db } from "../db";
import { transactions, transactionDetails, transactionLogs, users, profiles, ledgerLimit, transactionCommissions } from "../db/schema";
// Note: profiles is still imported for betStatus/parentBetStatus checks
import { parseUserAgent } from "../utils/parse-ua";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { addResultToQueue } from "../queues/betting";
import { app_middleware } from "../middleware/auth";
import { redis } from "../db/redis";
import { parseBetType, UserRole, MarketType, parseMarketType, marketTypeToString } from "../types/enums";

export const bettingRoutes = new Elysia({ prefix: "/betting" })
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
        bettingType,
        eventTypeId,
        competitionId,
        odds,
        stake,
        run,
        type,
        runners,
      } = body as {
        matchId: string | number;
        marketId: string | number;
        selectionId: string | number;
        selectionName?: string;
        marketName?: string;
        marketType?: string;
        bettingType?: string;
        eventTypeId?: string | number;
        competitionId?: string | number | null;
        odds: number;
        stake: number;
        run?: number | null;
        type: "back" | "lay";
        runners: { id: string | number; name: string; price: number }[];
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

      const marketTypeInt = parseMarketType(bettingType || marketType, marketType);
      const isFancyBet = marketTypeInt === MarketType.Fancy;
      if (!runners || runners.length < (isFancyBet ? 1 : 2)) {
        set.status = 400;
        return {
          success: false,
          error: isFancyBet ? "Runner is required" : "At least two runners are required",
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
        if (redis.isReady) {
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

      // ── STEP 1: Validate ledger limits ──
      const [ledger] = await db
        .select({ userLimit: ledgerLimit.userLimit, finalLimit: ledgerLimit.finalLimit })
        .from(ledgerLimit)
        .where(eq(ledgerLimit.userId, store.id))
        .limit(1);

      if (!ledger) {
        set.status = 400;
        return { success: false, error: "Bet rejected: ledger not found for user" };
      }

      const userLimitNum = parseFloat(ledger.userLimit ?? "0");
      const finalLimitNum = parseFloat(ledger.finalLimit ?? "0");

      if (finalLimitNum <= 0) {
        set.status = 400;
        return { success: false, error: "Bet rejected: no available limit" };
      }

      if (stake > finalLimitNum) {
        set.status = 400;
        return { success: false, error: "Bet rejected: stake " + stake + " exceeds your available limit " + finalLimitNum };
      }

      // ── STEP 2: Calculate exposure for THIS bet only ──
      // No need to fetch all existing bets — ledger already tracks cumulative exposure.
      // We only calculate how much NEW exposure this single bet adds.
      const potentialReturn = stake * odds;
      let betExposure: number;

      if (type === "back") {
        // Back bet: worst case = you lose your stake
        betExposure = stake;
      } else {
        // Lay bet: worst case = you pay out (potentialReturn - stake) = liability
        betExposure = potentialReturn - stake;
      }

      if (betExposure > finalLimitNum) {
        set.status = 400;
        return { success: false, error: "Bet rejected: exposure " + betExposure + " exceeds available limit " + finalLimitNum };
      }

      // ── STEP 3: Insert bet + details in a single transaction ──
      const today = new Date();
      const numericSelectionId = Number(selectionId);

      const [txn] = await db.transaction(async (tx) => {
        // Insert into transactions
        const [newTxn] = await tx
          .insert(transactions)
          .values({
            userId: store.id,
            whitelabelId: whitelabelId ?? undefined,
            eventTypeId: Number(eventTypeId) || 4,
            competitionId: competitionId ? Number(competitionId) : null,
            matchId: Number(matchId),
            marketId: String(marketId),
            marketName: marketName || null,
            marketType: marketTypeInt,
            selectionId: numericSelectionId,
            selectionName: selectionName || null,
            betType: parseBetType(type),
            stake: stake.toString(),
            odds: odds.toString(),
            status: "matched",
            ipAddress,
            matchedAt: today,
            addedBy: store.id,
            updateBy: store.id,
          })
          .returning();

        // Insert one row per runner into transaction_details
        // Odds market: 3 rows (Team A, Team B, Draw)
        // Bookmaker market: 2 rows (Team A, Team B)
        // Line market: 1 row (session runner with run value)
        const detailRows = runners.map((runner) => {
          const runnerId = Number(runner.id);
          const isSelected = runnerId === numericSelectionId;
          return {
            transactionId: newTxn.id,
            runnerId,
            runnerName: runner.name || null,
            isUserSelection: isSelected,
            betType: parseBetType(type),
            price: runner.price.toString(),
            run: isSelected && run != null ? Math.round(run) : 0,
            stake: stake.toString(),
            potentialReturn: isSelected ? potentialReturn.toFixed(2) : "0",
            addedBy: store.id,
            updateBy: store.id,
          };
        });

        await tx.insert(transactionDetails).values(detailRows);

        // Insert transaction log
        await tx.insert(transactionLogs).values({
          transactionId: newTxn.id,
          userId: store.id,
          ipAddress,
          ...ua,
          addedBy: store.id,
          updateBy: store.id,
        });

        // ── Commission snapshot ──
        // Walk up the hierarchy: User → Agent → Master → Super → Admin → Owner
        // Each parent's downline% is THEIR share. The remainder goes to THEIR parent.
        // Example: Owner creates Admin with downline 85%
        //          Admin creates User with downline 100%
        //          → Admin gets 85%, Owner gets 15% (100 - 85)
        const hierarchyRows = await tx.execute(sql`
          WITH RECURSIVE hierarchy AS (
            SELECT
              u.id AS ancestor_id,
              u.role AS ancestor_role,
              p.downline::DECIMAL(5,2) AS downline,
              1 AS depth
            FROM users u
            JOIN profiles p ON p.user_id = u.id
            WHERE u.id = (SELECT added_by FROM users WHERE id = ${store.id})

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

        // Calculate each level's commission share from the downline chain.
        // Each person's downline% is the CUMULATIVE share flowing to that level and below.
        // So each level keeps: their_downline% - their_child's_downline%
        // Owner keeps: 100% - the highest non-owner downline%
        //
        // Example: Owner → Admin(downline=85) → User
        //   Admin gets: 85 - 0 = 85%
        //   Owner gets: 100 - 85 = 15%
        //
        // Example: Owner → Admin(85) → Agent(70) → User
        //   Agent gets: 70 - 0 = 70%
        //   Admin gets: 85 - 70 = 15%
        //   Owner gets: 100 - 85 = 15%
        const snapshotData: typeof transactionCommissions.$inferInsert = {
          transactionId: newTxn.id,
          userId: store.id,
          addedBy: store.id,
          updateBy: store.id,
        };

        let previousDownline = 0; // start from 0 (bottom of chain, below the first ancestor)
        for (let i = 0; i < ancestors.length; i++) {
          const row = ancestors[i];
          const role = Number(row.ancestor_role);
          const downline = parseFloat(row.downline ?? "0");

          // Each non-Owner level keeps: their downline% - child's downline%
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
            // Owner gets whatever remains above the last non-owner downline
            snapshotData.ownerId = row.ancestor_id;
            snapshotData.ownerPercent = Math.max(100 - previousDownline, 0).toFixed(2);
          }

          previousDownline = downline;
        }

        await tx.insert(transactionCommissions).values(snapshotData);

        return [newTxn];
      });

      // Call procedure to recalculate exposure and update ledger_limit
      await db.execute(sql`CALL set_limit_used_of_user(${store.id}::uuid)`);

      set.status = 201;
      return { success: true, transactionId: txn.id };
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to place bet";
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
        .orderBy(desc(transactions.addedDate))
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
        marketType: marketTypeToString(t.marketType),
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

      await db
        .update(transactions)
        .set({ status: "cancelled", cancelledAt: new Date() })
        .where(eq(transactions.id, params.transactionId));

      // Recalculate exposure after cancellation
      await db.execute(sql`CALL set_limit_used_of_user(${store.id}::uuid)`);

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
        matchId: string | number;
        results: Record<string, "winner" | "loser">;
      };

      // Add to result processing queue
      await addResultToQueue({ matchId: Number(matchId), results });

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

  // Get per-market exposure for the user (from DB function)
  // Pass marketId query param to filter by specific market, or omit for all markets
  .get("/market-exposure", async ({ store, query, set }) => {
    try {
      const marketId = query?.marketId ? Number(query.marketId) : 0;
      const rows = await db.execute(
        sql`SELECT * FROM get_limituse_of_user_market(${store.id}::uuid, ${marketId}::numeric)`
      );
      const data = Array.isArray(rows) ? rows : (rows as any)?.rows || [];
      set.status = 200;
      return { success: true, data };
    } catch (error) {
      set.status = 500;
      return { success: false, error: "Failed to fetch market exposure" };
    }
  })

  // Get per-market exposure for fancy/session markets (market_type = 4)
  // Returns worst-case P&L per market (not per runner)
  .get("/market-exposure-fancy", async ({ store, query, set }) => {
    try {
      const marketId = query?.marketId ? Number(query.marketId) : 0;
      const rows = await db.execute(
        sql`SELECT * FROM get_limituse_of_user_market_fancy(${store.id}::uuid, ${marketId}::numeric)`
      );
      const data = Array.isArray(rows) ? rows : (rows as any)?.rows || [];
      set.status = 200;
      return { success: true, data };
    } catch (error) {
      set.status = 500;
      return { success: false, error: "Failed to fetch fancy market exposure" };
    }
  })

  // Get detailed run-by-run exposure chart for a single fancy market
  .get("/fancy-exposure-chart", async ({ store, query, set }) => {
    try {
      const marketId = query?.marketId ? Number(query.marketId) : 0;
      if (!marketId) {
        set.status = 400;
        return { success: false, error: "marketId is required" };
      }
      const rows = await db.execute(
        sql`SELECT * FROM get_user_market_detail_of_fancy(${store.id}::uuid, ${marketId}::numeric)`
      );
      const data = Array.isArray(rows) ? rows : (rows as any)?.rows || [];
      set.status = 200;
      return { success: true, data };
    } catch (error) {
      set.status = 500;
      return { success: false, error: "Failed to fetch fancy exposure chart" };
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
