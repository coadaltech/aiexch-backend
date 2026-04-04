import cron from "node-cron";
import { db } from "../db";
import { transactions, marketResults } from "../db/schema";
import { eq, and, inArray, ne, sql } from "drizzle-orm";
import { SportsService } from "./sports";
import { addResultToQueue } from "../queues/betting";
import { MarketType } from "../types/enums";

interface UndeclaredMarket {
  marketId: string;
  matchId: number;
  eventTypeId: number;
  competitionId: number | null;
  marketType: number;
}

/**
 * Fetch undeclared markets from transactions table grouped by marketId.
 * Only returns markets whose result has not been declared in market_results yet.
 */
async function getUndeclaredMarkets(
  marketTypes: number[]
): Promise<UndeclaredMarket[]> {
  try {
    // Get distinct markets from matched transactions
    const unsettledMarkets = await db
      .select({
        marketId: transactions.marketId,
        matchId: transactions.matchId,
        eventTypeId: transactions.eventTypeId,
        competitionId: transactions.competitionId,
        marketType: transactions.marketType,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.status, "matched"),
          inArray(transactions.marketType, marketTypes)
        )
      )
      .groupBy(
        transactions.marketId,
        transactions.matchId,
        transactions.eventTypeId,
        transactions.competitionId,
        transactions.marketType
      );

    if (unsettledMarkets.length === 0) return [];

    // Filter out markets that already have a declared/void/rollback result
    const marketIds = unsettledMarkets.map((m) => m.marketId);

    const alreadyDeclared = await db
      .select({ marketId: marketResults.marketId })
      .from(marketResults)
      .where(
        and(
          inArray(marketResults.marketId, marketIds),
          ne(marketResults.status, "PENDING")
        )
      );

    const declaredSet = new Set(alreadyDeclared.map((r) => r.marketId));

    return unsettledMarkets.filter(
      (m) => !declaredSet.has(m.marketId)
    ) as UndeclaredMarket[];
  } catch (error) {
    console.error("[MarketResultCron] Error fetching undeclared markets:", error);
    return [];
  }
}

/**
 * Check runner statuses via the Books API (getOdds).
 * Returns market IDs where at least one runner has WINNER or LOSER status.
 */
async function checkMarketOddsStatus(
  marketIds: string[]
): Promise<Set<string>> {
  const resolvedMarketIds = new Set<string>();

  try {
    // Chunk into groups of 30 (API limit)
    const chunks: string[][] = [];
    for (let i = 0; i < marketIds.length; i += 30) {
      chunks.push(marketIds.slice(i, i + 30));
    }

    for (const chunk of chunks) {
      const oddsData = await SportsService.getOdds({ marketId: chunk });

      for (const marketId of chunk) {
        const market = oddsData[marketId];
        if (!market?.runners || !Array.isArray(market.runners)) continue;

        const hasResult = market.runners.some((runner: any) => {
          const status = runner.status?.toUpperCase() || "";
          return (
            status === "WINNER" ||
            status === "LOSER" ||
            status === "WON" ||
            status === "LOST"
          );
        });

        if (hasResult) {
          resolvedMarketIds.add(marketId);
        }
      }
    }
  } catch (error) {
    console.error("[MarketResultCron] Error checking odds status:", error);
  }

  return resolvedMarketIds;
}

/**
 * Fetch result from the new Result API and store it in market_results table.
 * Then trigger bet settlement via the result queue.
 */
async function fetchAndStoreResult(market: UndeclaredMarket): Promise<void> {
  try {
    const apiResult = await SportsService.getNewMarketResult({
      marketId: market.marketId,
    });

    if (!apiResult?.isSuccess || !apiResult?.items) {
      console.warn(
        `[MarketResultCron] No result from API for market ${market.marketId}`
      );
      return;
    }

    const { Status, WinnerId, MarketId } = apiResult.items;
    const status = Status?.toUpperCase();

    // Only process DECLARED, VOID, ROLLBACK statuses
    if (!status || status === "PENDING" || status === "INACTIVE" || status === "CLOSED") {
      return;
    }

    console.log(
      `[MarketResultCron] Result for market ${market.marketId}: Status=${status}, WinnerId=${WinnerId}`
    );

    // Upsert into market_results table
    await db
      .insert(marketResults)
      .values({
        eventId: market.matchId,
        eventTypeId: market.eventTypeId,
        competitionId: market.competitionId,
        marketId: market.marketId,
        marketType: market.marketType,
        status: status,
        winnerId: WinnerId ? Number(WinnerId) : null,
        source: "api",
        apiResponse: apiResult,
        declaredAt: new Date(),
      })
      .onConflictDoUpdate({
        target: marketResults.marketId,
        set: {
          status: status,
          winnerId: WinnerId ? Number(WinnerId) : null,
          apiResponse: apiResult,
          declaredAt: new Date(),
          updateDate: new Date(),
        },
      });

    // If result is DECLARED, settle the bets
    if (status === "DECLARED" && WinnerId) {
      // Build results map: fetch runner details from odds to map all runners
      const resultsMap = await buildResultsMap(market, Number(WinnerId));

      if (Object.keys(resultsMap).length > 0) {
        // Update market_results with runners info
        const runners = Object.entries(resultsMap).map(([selId, result]) => ({
          selectionId: Number(selId),
          name: "",
          result,
        }));

        await db
          .update(marketResults)
          .set({ runners })
          .where(eq(marketResults.marketId, market.marketId));

        // Queue bet settlement
        await addResultToQueue({
          matchId: market.matchId,
          results: resultsMap,
        });

        console.log(
          `[MarketResultCron] Queued settlement for market ${market.marketId}, match ${market.matchId}`
        );
      }
    } else if (status === "VOID" || status === "ROLLBACK") {
      // For VOID/ROLLBACK, cancel all matched bets for this market
      await db
        .update(transactions)
        .set({ status: "void", settledAt: new Date() })
        .where(
          and(
            eq(transactions.marketId, market.marketId),
            eq(transactions.status, "matched")
          )
        );

      console.log(
        `[MarketResultCron] Voided all bets for market ${market.marketId} (${status})`
      );
    }
  } catch (error) {
    console.error(
      `[MarketResultCron] Error processing result for market ${market.marketId}:`,
      error
    );
  }
}

/**
 * Build a results map (selectionId → "winner" | "loser") using the Books API
 * and the winnerId from the Result API.
 */
async function buildResultsMap(
  market: UndeclaredMarket,
  winnerId: number
): Promise<Record<string, "winner" | "loser">> {
  const results: Record<string, "winner" | "loser"> = {};

  try {
    // For Fancy/Line markets, winnerId is the line value, not a selectionId
    if (market.marketType === MarketType.Fancy) {
      // For fancy markets, we use the old result endpoints which give per-runner results
      const sessionResults = await SportsService.getSessionResults({
        eventTypeId: String(market.eventTypeId),
        marketIds: [market.marketId],
      });

      for (const result of sessionResults) {
        if (result.id && result.result) {
          const resultStatus = result.result.toUpperCase();
          results[result.id] =
            resultStatus === "WINNER" || resultStatus === "WON"
              ? "winner"
              : "loser";
        }
      }

      // Fallback: if session results are empty, try fancy results
      if (Object.keys(results).length === 0) {
        const fancyResults = await SportsService.getFancyResults({
          eventTypeId: String(market.eventTypeId),
          marketIds: [market.marketId],
        });

        for (const result of fancyResults) {
          if (result.id && result.result) {
            const resultStatus = result.result.toUpperCase();
            results[result.id] =
              resultStatus === "WINNER" || resultStatus === "WON"
                ? "winner"
                : "loser";
          }
        }
      }

      return results;
    }

    // For Odds/Bookmaker markets: fetch runners from Books API to get all selectionIds
    const oddsData = await SportsService.getOdds({
      marketId: market.marketId,
    });

    const marketOdds = oddsData[market.marketId];
    if (marketOdds?.runners && Array.isArray(marketOdds.runners)) {
      for (const runner of marketOdds.runners) {
        const selId = runner.selectionId?.toString();
        if (!selId) continue;

        // Check runner status from odds data first
        const runnerStatus = runner.status?.toUpperCase() || "";
        if (runnerStatus === "WINNER" || runnerStatus === "WON") {
          results[selId] = "winner";
        } else if (
          runnerStatus === "LOSER" ||
          runnerStatus === "LOST" ||
          runnerStatus === "REMOVED" ||
          runnerStatus === "REMOVED_VACANT"
        ) {
          results[selId] = "loser";
        } else {
          // Fallback: use winnerId from Result API
          results[selId] =
            Number(selId) === winnerId ? "winner" : "loser";
        }
      }
    } else {
      // If no runners from odds, fallback: get selections from transactions
      const marketBets = await db
        .select({ selectionId: transactions.selectionId })
        .from(transactions)
        .where(
          and(
            eq(transactions.marketId, market.marketId),
            eq(transactions.status, "matched")
          )
        )
        .groupBy(transactions.selectionId);

      for (const bet of marketBets) {
        const selId = bet.selectionId.toString();
        results[selId] = Number(selId) === winnerId ? "winner" : "loser";
      }
    }
  } catch (error) {
    console.error(
      `[MarketResultCron] Error building results map for market ${market.marketId}:`,
      error
    );
  }

  return results;
}

/**
 * Main cron handler: checks undeclared markets and processes their results.
 */
async function processUndeclaredMarkets(marketTypes: number[]): Promise<void> {
  const label =
    marketTypes.includes(MarketType.Fancy) ? "Fancy" : "Odds/Bookmaker";

  try {
    console.log(`[MarketResultCron] Starting ${label} result check...`);

    const undeclaredMarkets = await getUndeclaredMarkets(marketTypes);

    if (undeclaredMarkets.length === 0) {
      console.log(`[MarketResultCron] No undeclared ${label} markets found`);
      return;
    }

    console.log(
      `[MarketResultCron] Found ${undeclaredMarkets.length} undeclared ${label} markets`
    );

    // Step 1: Check which markets have WINNER/LOSER in odds data
    const allMarketIds = undeclaredMarkets.map((m) => m.marketId);
    const resolvedMarketIds = await checkMarketOddsStatus(allMarketIds);

    if (resolvedMarketIds.size === 0) {
      console.log(
        `[MarketResultCron] No ${label} markets with resolved runners yet`
      );
      return;
    }

    console.log(
      `[MarketResultCron] ${resolvedMarketIds.size} ${label} markets have resolved runners`
    );

    // Step 2: For resolved markets, fetch result from Result API and process
    const resolvedMarkets = undeclaredMarkets.filter((m) =>
      resolvedMarketIds.has(m.marketId)
    );

    for (const market of resolvedMarkets) {
      await fetchAndStoreResult(market);
    }

    console.log(`[MarketResultCron] ${label} result check completed`);
  } catch (error) {
    console.error(`[MarketResultCron] Error in ${label} result check:`, error);
  }
}

/**
 * Start the market result cron jobs:
 * - Every 10 minutes: check Fancy markets (market_type = 4)
 * - Every 15 minutes: check Odds/Bookmaker markets (market_type = 0, 1, 2, 3)
 */
export function startMarketResultCronJobs(): void {
  console.log("[MarketResultCron] Starting market result cron jobs...");

  // Every 10 minutes: Fancy markets (market_type = 4)
  cron.schedule(
    "*/10 * * * *",
    () => {
      processUndeclaredMarkets([MarketType.Fancy]).catch((error) => {
        console.error("[MarketResultCron] Fancy cron error:", error);
      });
    },
    { timezone: "UTC" }
  );

  // Every 15 minutes: Odds, TiedMatch, CompleteMatch, Bookmaker (market_type = 0, 1, 2, 3)
  cron.schedule(
    "*/15 * * * *",
    () => {
      processUndeclaredMarkets([
        MarketType.MatchOdds,
        MarketType.TiedMatch,
        MarketType.CompleteMatch,
        MarketType.Bookmaker,
      ]).catch((error) => {
        console.error("[MarketResultCron] Odds/Bookmaker cron error:", error);
      });
    },
    { timezone: "UTC" }
  );

  console.log(
    "[MarketResultCron] Cron jobs started: Fancy every 10min, Odds/Bookmaker every 15min"
  );

  // Run initial check on startup
  processUndeclaredMarkets([MarketType.Fancy]).catch((error) => {
    console.error("[MarketResultCron] Initial Fancy check error:", error);
  });
  processUndeclaredMarkets([
    MarketType.MatchOdds,
    MarketType.TiedMatch,
    MarketType.CompleteMatch,
    MarketType.Bookmaker,
  ]).catch((error) => {
    console.error("[MarketResultCron] Initial Odds/Bookmaker check error:", error);
  });
}
