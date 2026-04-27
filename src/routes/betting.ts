import { Elysia } from "elysia";
import { db } from "../db";
import { transactions, transactionDetails, transactionLogs, users, profiles, ledgerLimit, transactionCommissions, marketSettings } from "../db/schema";
// Note: profiles is still imported for betStatus/parentBetStatus checks
import { parseUserAgent } from "../utils/parse-ua";
import { eq, and, sql } from "drizzle-orm";
import { addResultToQueue } from "../queues/betting";
import { app_middleware } from "../middleware/auth";
import { redis } from "../db/redis";
import { parseBetType, UserRole, MarketType, parseMarketType } from "../types/enums";
import { SportsService } from "../services/sports";

// Bound the upstream odds re-fetch so a slow provider can't stall bet placement.
// Typical books/bookmaker calls return in 150-400ms; getSessions can be heavier.
const FRESH_ODDS_TIMEOUT_MS = 1500;

// Pull the freshest price for the exact slot the user clicked
// (runner × back/lay × priceIndex). Returns:
//   { suspended: true,  reason }  → reject the bet
//   { suspended: false, rawPrice } → override odds with this price
//   null                            → provider failed/timed out, keep request odds
async function fetchFreshSelectionPrice(args: {
  matchId: string | number;
  marketId: string;
  eventTypeId: string | number;
  selectionId: number;
  isFancy: boolean;
  isBookmaker: boolean;
  isLay: boolean;
  priceIndex: number;
  timeoutMs: number;
}): Promise<
  | { suspended: true; reason: string }
  | { suspended: false; rawPrice: number }
  | null
> {
  const timeoutPromise = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), args.timeoutMs),
  );

  const fetchPromise = (async () => {
    try {
      if (args.isFancy) {
        const sessions = await SportsService.getSessions({
          eventTypeId: String(args.eventTypeId),
          matchId: String(args.matchId),
        });
        const item = (sessions as any[])?.find(
          (s) => String(s.SelectionId) === String(args.selectionId),
        );
        if (!item) return null;

        const gs = (item.GameStatus || "").toUpperCase();
        const ballRunning = gs === "BALL RUNNING" || item.ballsess === 1 || item.ballsess === "1";
        if (gs === "SUSPENDED") return { suspended: true as const, reason: "Bet rejected: market is suspended" };
        if (ballRunning) return { suspended: true as const, reason: "Bet rejected: ball is running" };
        if (gs === "CLOSED" || gs === "INACTIVE") return { suspended: true as const, reason: "Bet rejected: market is closed" };

        const raw = args.isLay ? item.LayPrice1 : item.BackPrice1;
        const num = Number(raw);
        if (!Number.isFinite(num) || num <= 0) return null;
        return { suspended: false as const, rawPrice: num };
      }

      if (args.isBookmaker) {
        const list = await SportsService.getBookmakers({
          eventTypeId: String(args.eventTypeId),
          marketId: String(args.marketId),
        });
        const market = (list as any[])?.[0];
        if (!market) return null;

        const mStatus = (market.status || "").toUpperCase();
        if (mStatus === "SUSPENDED") return { suspended: true as const, reason: "Bet rejected: market is suspended" };
        if (mStatus === "CLOSED" || mStatus === "INACTIVE") return { suspended: true as const, reason: "Bet rejected: market is closed" };

        const runner = market.runners?.find(
          (r: any) => String(r.selectionId) === String(args.selectionId),
        );
        if (!runner) return null;
        const rStatus = (runner.status || "").toUpperCase();
        if (rStatus === "SUSPENDED") return { suspended: true as const, reason: "Bet rejected: runner is suspended" };

        const side = args.isLay ? runner.lay : runner.back;
        const slot = Array.isArray(side) ? side[args.priceIndex] : null;
        const raw = slot?.price ?? (Array.isArray(slot) ? slot[0] : null);
        const num = Number(raw);
        if (!Number.isFinite(num) || num <= 0) return null;
        return { suspended: false as const, rawPrice: num };
      }

      // Default: ODDS markets — /sports/books/{marketId}
      const oddsObj = await SportsService.getOdds({ marketId: String(args.marketId) });
      const market = (oddsObj as any)?.[String(args.marketId)];
      if (!market) return null;

      const mStatus = (market.status || "").toUpperCase();
      if (mStatus === "SUSPENDED") return { suspended: true as const, reason: "Bet rejected: market is suspended" };
      if (mStatus === "CLOSED" || mStatus === "INACTIVE") return { suspended: true as const, reason: "Bet rejected: market is closed" };
      if (market.sportingEvent) return { suspended: true as const, reason: "Bet rejected: ball is running" };

      const runner = market.runners?.find(
        (r: any) => String(r.selectionId) === String(args.selectionId),
      );
      if (!runner) return null;
      const rStatus = (runner.status || "").toUpperCase();
      if (rStatus === "SUSPENDED") return { suspended: true as const, reason: "Bet rejected: runner is suspended" };
      if (rStatus === "REMOVED") return { suspended: true as const, reason: "Bet rejected: runner is removed" };

      const side = args.isLay ? runner.lay : runner.back;
      const slot = Array.isArray(side) ? side[args.priceIndex] : null;
      // ODDS shape supports both [price,size] tuples and {price,size} objects
      const raw = Array.isArray(slot) ? slot[0] : slot?.price;
      const num = Number(raw);
      if (!Number.isFinite(num) || num <= 0) return null;
      return { suspended: false as const, rawPrice: num };
    } catch {
      return null;
    }
  })();

  return await Promise.race([fetchPromise, timeoutPromise]);
}

// Mirror the client's toDecimalOdds / toDecimalfancyOdds so the stored odds
// match the format the user saw on screen.
function rawPriceToDecimalOdds(
  raw: number,
  provider: string | undefined,
  marketType: string | undefined,
  isFancy: boolean,
): number {
  const isBetfair = provider?.toUpperCase() === "BETFAIR";
  if (isFancy) {
    if (isBetfair && raw < 10) return raw;
    return raw / 100;
  }
  if (isBetfair) return raw;
  if (marketType?.toUpperCase() === "WINNING_ODDS") return raw;
  return raw / 100;
}

export const bettingRoutes = new Elysia({ prefix: "/betting" })
  .state({ id: "" as string, role: 0 as number })
  .guard({
    async beforeHandle({ cookie, headers, set, store }) {
      const state_result = await app_middleware({ cookie, headers });

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
        provider,
        priceIndex,
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
        provider?: string;
        priceIndex?: number;
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

      // ── STEP 0: Run independent checks in parallel ──
      // These 3 DB queries + 1 Redis check are independent — run them concurrently
      const ipAddress =
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        request.headers.get("x-real-ip") ||
        null;
      const ua = parseUserAgent(request.headers.get("user-agent"));

      // Fire all independent queries in parallel
      const [userData, userRecord, [ledger], marketStatusResult] = await Promise.all([
        // 1. User profile (betStatus check)
        db.select({
          betStatus: profiles.betStatus,
          parentBetStatus: profiles.parentBetStatus,
        }).from(profiles).where(eq(profiles.userId, store.id)).limit(1),

        // 2. User whitelabelId
        db.select({ whitelabelId: users.whitelabelId })
          .from(users).where(eq(users.id, store.id)).limit(1),

        // 3. Ledger limits
        db.select({ userLimit: ledgerLimit.userLimit, finalLimit: ledgerLimit.finalLimit })
          .from(ledgerLimit).where(eq(ledgerLimit.userId, store.id)).limit(1),

        // 4. Redis market status check (non-blocking)
        (async () => {
          let resolvedMinBet = 0;
          let resolvedMaxBet = 0;
          try {
            if (redis.isReady) {
              const liveJson = await redis.get(`live:markets:${matchId}`);
              if (liveJson) {
                const liveMarkets: any[] = JSON.parse(liveJson);
                const targetMarket = liveMarkets.find((m: any) => m.marketId === marketId);
                if (targetMarket) {
                  if (targetMarket.status === "CLOSED" || targetMarket.status === "INACTIVE") {
                    return { rejected: true, error: "Bet rejected: market is closed" };
                  }
                  if (targetMarket.status === "SUSPENDED") {
                    return { rejected: true, error: "Bet rejected: market is suspended" };
                  }
                  if (targetMarket.sportingEvent) {
                    return { rejected: true, error: "Bet rejected: ball is running" };
                  }
                  if (targetMarket.marketCondition?.betLock) {
                    return { rejected: true, error: "Bet rejected: market is locked" };
                  }
                  if (targetMarket.marketCondition?.minBet) {
                    resolvedMinBet = parseFloat(targetMarket.marketCondition.minBet) || 0;
                  }
                  if (targetMarket.marketCondition?.maxBet) {
                    resolvedMaxBet = parseFloat(targetMarket.marketCondition.maxBet) || 0;
                  }
                }
              }
            }
          } catch {
            // Non-critical: if Redis check fails, allow the bet through
          }
          return { rejected: false, resolvedMinBet, resolvedMaxBet };
        })(),
      ]);

      if (!userData[0]) {
        set.status = 404;
        return { success: false, error: "User not found" };
      }

      const canBet = (userData[0].betStatus ?? true) && (userData[0].parentBetStatus ?? true);
      if (!canBet) {
        set.status = 403;
        return { success: false, error: "Betting is disabled for your account" };
      }

      // Check market status result from Redis
      if (marketStatusResult.rejected) {
        set.status = 400;
        return { success: false, error: (marketStatusResult as any).error };
      }

      let { resolvedMinBet = 0, resolvedMaxBet = 0 } = marketStatusResult as { rejected: false; resolvedMinBet: number; resolvedMaxBet: number };

      // Fallback: fetch min/max from market_settings DB when Redis didn't provide them
      if (resolvedMinBet === 0 && resolvedMaxBet === 0) {
        try {
          const [mktSetting] = await db
            .select({ minBet: marketSettings.minBet, maxBet: marketSettings.maxBet })
            .from(marketSettings)
            .where(eq(marketSettings.marketId, String(marketId)))
            .limit(1);
          if (mktSetting) {
            resolvedMinBet = parseFloat(mktSetting.minBet ?? "0") || 0;
            resolvedMaxBet = parseFloat(mktSetting.maxBet ?? "0") || 0;
          }
        } catch {
          // Non-critical: DB lookup failed, skip min/max enforcement
        }
      }

      // Enforce min/max bet limits
      if (resolvedMinBet > 0 && stake < resolvedMinBet) {
        set.status = 400;
        return { success: false, error: `Bet rejected: minimum bet is ${resolvedMinBet}` };
      }
      if (resolvedMaxBet > 0 && stake > resolvedMaxBet) {
        set.status = 400;
        return { success: false, error: `Bet rejected: maximum bet is ${resolvedMaxBet}` };
      }

      const whitelabelId = userRecord[0]?.whitelabelId ?? null;

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

      // NOTE: We no longer compare stake or single-bet exposure against finalLimit here.
      // The DB trigger (trg_recalc_ledger_on_bet) calculates the TOTAL worst-case exposure
      // across all markets after inserting this bet, and checks total_exposure <= user_limit.
      // This allows e.g. a lay bet with stake 5000 if the worst-case loss is only 800 and
      // the user's limit covers that.

      // ── STEP 1.5: Re-fetch authoritative odds from upstream provider ──
      // The client's odds may be stale (especially live fancy where the line
      // moves every second). Pull the fresh price for the exact runner+side
      // +slot the user clicked, and use it as the bet's odds.
      const numericSelectionId = Number(selectionId);
      const isLayBet = type === "lay";
      const isBookmaker = marketTypeInt === MarketType.Bookmaker;
      const slotIndex = Number.isFinite(Number(priceIndex)) ? Number(priceIndex) : 0;

      const fresh = await fetchFreshSelectionPrice({
        matchId,
        marketId: String(marketId),
        eventTypeId: eventTypeId ?? 4,
        selectionId: numericSelectionId,
        isFancy: isFancyBet,
        isBookmaker,
        isLay: isLayBet,
        priceIndex: slotIndex,
        timeoutMs: FRESH_ODDS_TIMEOUT_MS,
      });

      let finalOdds = odds;
      let finalRun: number | null | undefined = run;

      if (fresh && fresh.suspended) {
        set.status = 400;
        return { success: false, error: fresh.reason };
      }

      if (fresh && !fresh.suspended) {
        finalOdds = rawPriceToDecimalOdds(fresh.rawPrice, provider, marketType, isFancyBet);
        if (isFancyBet) {
          // Fancy: client-sent `run` is the raw line value (e.g. 61) and `odds`
          // is line/100 — keep both in sync with the fresh upstream price.
          finalRun = fresh.rawPrice;
        }
      }

      // ── STEP 2: Insert bet + details in a single transaction ──
      const today = new Date();

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
            odds: finalOdds.toString(),
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
        const isBetfair = provider?.toUpperCase() === "BETFAIR";
        const isWinningOdds = marketType?.toUpperCase() === "WINNING_ODDS";
        const isFancy = marketTypeInt === MarketType.Fancy;
        const isBack = type === "back";
        const detailRows = runners.map((runner) => {
          const runnerId = Number(runner.id);
          const isSelected = runnerId === numericSelectionId;
          // For the selected runner, use the authoritative `finalOdds` (which
          // has already been replaced with the upstream-fresh price when
          // available) to guarantee transaction_details.price matches
          // transactions.odds exactly. Other runners keep their request prices.
          const runnerOdds = isSelected ? finalOdds : (runner.price ?? 0);
          // Betfair fancy (LINE) markets: odds are already the raw run value (e.g. 1), never subtract 1.
          // Betfair non-fancy and WINNING_ODDS: odds are decimal (e.g. 1.98), subtract 1 for profit ratio.
          const storedPrice = (isBetfair && isFancy) ? runnerOdds : (isBetfair || isWinningOdds) ? runnerOdds - 1 : runnerOdds;

          // potentialReturn = P&L for this runner if IT wins
          // Back bet:  selected runner wins → +stake * storedPrice; other runners win → -stake
          // Lay bet:   selected runner wins → -(stake * storedPrice) liability; others win → +stake
          let runnerPotentialReturn: number;
          if (isBack) {
            runnerPotentialReturn = isSelected ? stake * storedPrice : -stake;
          } else {
            runnerPotentialReturn = isSelected ? -(stake * storedPrice) : stake;
          }

          return {
            transactionId: newTxn.id,
            runnerId,
            runnerName: runner.name || null,
            isUserSelection: isSelected,
            betType: parseBetType(type),
            price: storedPrice.toString(),
            basePrice: runnerOdds.toString(),
            run: isSelected && finalRun != null ? Math.round(finalRun) : 0,
            stake: stake.toString(),
            potentialReturn: runnerPotentialReturn.toFixed(2),
            addedBy: store.id,
            updateBy: store.id,
          };
        });

        await tx.insert(transactionDetails).values(detailRows);

        // Insert transaction log
        await tx.insert(transactionLogs).values({
          transactionId: newTxn.id,
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

  // Get user's bets — delegated to the SQL function fn_get_user_sports_bets,
  // which folds the transactions / transaction_details / sports / competitions
  // / events joins into a single query. Keeps the old response shape.
  .get("/my-bets", async ({ store, query, set }) => {
    try {
      const status = (query?.status as string) || "all";
      const limit = parseInt((query?.limit as string) || "50");
      const offset = parseInt((query?.offset as string) || "0");

      const rows = await db.execute(sql`
        SELECT fn_get_user_sports_bets(
          ${store.id}::uuid,
          ${status}::text,
          ${limit}::int,
          ${offset}::int
        ) AS data
      `);

      const rowArray = Array.isArray(rows) ? rows : (rows as any)?.rows ?? [];
      const result: any[] = (rowArray[0]?.data as any[] | null) ?? [];

      set.status = 200;
      return { success: true, data: result };
    } catch (error) {
      console.error("Failed to fetch bets:", error);
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

  // Get the user's per-row exposure usage (event/market/shift + amount).
  // Backed by get_limituse_of_user_detail() which returns one row per market
  // (or matka shift) with the worst-case loss already negated.
  .get("/exposure-usage", async ({ store, set }) => {
    try {
      const rows = await db.execute(
        sql`
          SELECT
            lu.market_id         AS "marketId",
            lu.shift_id          AS "shiftId",
            lu."intflag"         AS "intFlag",
            lu.limit_use         AS "limitUse",
            lu."sportname"       AS "sportName",
            lu.market_name       AS "marketName",
            lu."competitionname" AS "competitionName",
            lu."eventname"       AS "eventName",
            lu."shiftname"       AS "shiftName"
          FROM get_limituse_of_user_detail(${store.id}::uuid) lu
          WHERE COALESCE(lu.limit_use, 0) <> 0
          ORDER BY lu.limit_use DESC
        `
      );
      const data = Array.isArray(rows) ? rows : (rows as any)?.rows || [];
      set.status = 200;
      return { success: true, data };
    } catch (error) {
      console.error("Failed to fetch exposure usage:", error);
      set.status = 500;
      return { success: false, error: "Failed to fetch exposure usage" };
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
