import cron from "node-cron";
import { db } from "../db";
import { transactions, marketResults, events, sports, competitions } from "../db/schema";
import { eq, and, inArray, ne, sql } from "drizzle-orm";
import { SportsService } from "./sports";
import { MarketType } from "../types/enums";

interface UndeclaredMarket {
  marketId: string;
  matchId: number;
  eventTypeId: number;
  competitionId: number | null;
  marketType: number;
  marketName: string | null;
  eventTypeName: string;
  competitionName: string;
  eventName: string;
}

/**
 * Fetch undeclared markets from transactions table grouped by marketId.
 * Only returns markets whose result has not been declared in market_results yet.
 */
async function getUndeclaredMarkets(
  marketTypes: number[]
): Promise<UndeclaredMarket[]> {
  try {
    const unsettledMarkets = await db
      .select({
        marketId: transactions.marketId,
        matchId: transactions.matchId,
        eventTypeId: transactions.eventTypeId,
        competitionId: transactions.competitionId,
        marketType: transactions.marketType,
        marketName: transactions.marketName,
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
        transactions.marketType,
        transactions.marketName
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
    const filtered = unsettledMarkets.filter(
      (m) => !declaredSet.has(m.marketId)
    );

    if (filtered.length === 0) return [];

    // Enrich with names from sports / competitions / events tables
    return await enrichWithNames(filtered as any);
  } catch (error) {
    console.error("[MarketResultCron] Error fetching undeclared markets:", error);
    return [];
  }
}

async function enrichWithNames(
  markets: Omit<UndeclaredMarket, "eventTypeName" | "competitionName" | "eventName">[]
): Promise<UndeclaredMarket[]> {
  const eventTypeIds = [...new Set(markets.map((m) => m.eventTypeId))];
  const competitionIds = [...new Set(markets.map((m) => m.competitionId).filter(Boolean))] as number[];
  const matchIds = [...new Set(markets.map((m) => m.matchId))];

  const [sportsRows, competitionRows, eventRows] = await Promise.all([
    db
      .select({ sportId: sports.sport_id, name: sports.name })
      .from(sports)
      .where(inArray(sports.sport_id, eventTypeIds)),
    competitionIds.length > 0
      ? db
          .select({ competitionId: competitions.competition_id, name: competitions.name })
          .from(competitions)
          .where(inArray(competitions.competition_id, competitionIds))
      : Promise.resolve([]),
    db
      .select({ eventId: events.eventId, name: events.name })
      .from(events)
      .where(inArray(events.eventId, matchIds)),
  ]);

  const sportMap = new Map(sportsRows.map((r) => [r.sportId, r.name]));
  const competitionMap = new Map(competitionRows.map((r) => [r.competitionId, r.name]));
  const eventMap = new Map(eventRows.map((r) => [r.eventId, r.name]));

  return markets.map((m) => ({
    ...m,
    eventTypeName: sportMap.get(m.eventTypeId) ?? "",
    competitionName: m.competitionId ? (competitionMap.get(m.competitionId) ?? "") : "",
    eventName: eventMap.get(m.matchId) ?? "",
  }));
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
 * Build a results map (selectionId → "winner" | "loser") using the Books API
 * and the winnerId from the Result API. Used to populate varrunners for the procedure.
 */
async function buildResultsMap(
  market: UndeclaredMarket,
  winnerId: number
): Promise<Record<string, "winner" | "loser">> {
  const results: Record<string, "winner" | "loser"> = {};

  try {
    if (market.marketType === MarketType.Fancy) {
      const sessionResults = await SportsService.getSessionResults({
        eventTypeId: String(market.eventTypeId),
        marketIds: [market.marketId],
      });

      for (const result of sessionResults) {
        if (result.id && result.result) {
          const s = result.result.toUpperCase();
          results[result.id] = s === "WINNER" || s === "WON" ? "winner" : "loser";
        }
      }

      if (Object.keys(results).length === 0) {
        const fancyResults = await SportsService.getFancyResults({
          eventTypeId: String(market.eventTypeId),
          marketIds: [market.marketId],
        });

        for (const result of fancyResults) {
          if (result.id && result.result) {
            const s = result.result.toUpperCase();
            results[result.id] = s === "WINNER" || s === "WON" ? "winner" : "loser";
          }
        }
      }

      return results;
    }

    const oddsData = await SportsService.getOdds({ marketId: market.marketId });
    const marketOdds = oddsData[market.marketId];

    if (marketOdds?.runners && Array.isArray(marketOdds.runners)) {
      for (const runner of marketOdds.runners) {
        const selId = runner.selectionId?.toString();
        if (!selId) continue;

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
          results[selId] = Number(selId) === winnerId ? "winner" : "loser";
        }
      }
    } else {
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
 * Look up the winner's selection name from the transactions table.
 */
async function getWinnerName(marketId: string, selectionId: number): Promise<string> {
  try {
    const rows = await db
      .select({ selectionName: transactions.selectionName })
      .from(transactions)
      .where(
        and(
          eq(transactions.marketId, marketId),
          eq(transactions.selectionId, selectionId)
        )
      )
      .limit(1);

    return rows[0]?.selectionName ?? "";
  } catch {
    return "";
  }
}

/**
 * Fetch result from the external Result API and, on a DECLARED result,
 * call declare_process + update_limit_after_declare stored procedures.
 * For VOID/ROLLBACK, cancel all matched bets for the market.
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

    const { Status, WinnerId } = apiResult.items;
    const status = Status?.toUpperCase();

    if (!status || status === "PENDING" || status === "INACTIVE" || status === "CLOSED") {
      return;
    }

    console.log(
      `[MarketResultCron] Result for market ${market.marketId}: Status=${status}, WinnerId=${WinnerId}`
    );

    if (status === "DECLARED" && WinnerId) {
      const winnerIdNum = Number(WinnerId);

      // For fancy markets: WinnerId is the actual run value (line result).
      // For odds/bookmaker: WinnerId is the winning selectionId.
      const isFancy = market.marketType === MarketType.Fancy;
      const winRunnerId = winnerIdNum;
      const winRun = isFancy ? winnerIdNum : 0;

      // Winner name — meaningful for odds/bookmaker, not for fancy
      const winnerName = isFancy
        ? (market.marketName ?? "")
        : await getWinnerName(market.marketId, winnerIdNum);

      // Build runners array for storage in market_results (via the procedure)
      const resultsMap = await buildResultsMap(market, winnerIdNum);
      const runners = Object.entries(resultsMap).map(([selId, result]) => ({
        selectionId: Number(selId),
        name: "",
        result,
      }));

      // Call declare_process — archives transactions, creates vouchers, inserts market_results
      await db.execute(sql`
        CALL public.declare_process(
          ${market.marketId}::numeric,
          ${market.marketType}::int,
          ${market.eventTypeId}::bigint,
          ${market.competitionId ?? 0}::bigint,
          ${market.matchId}::bigint,
          ${market.eventTypeName}::varchar,
          ${market.competitionName}::varchar,
          ${market.eventName}::varchar,
          ${market.marketName ?? ""}::varchar,
          ${winRunnerId}::bigint,
          ${winRun}::int,
          ${winnerName}::varchar,
          ${JSON.stringify(runners)}::jsonb,
          'api'::varchar,
          ${JSON.stringify(apiResult)}::jsonb
        )
      `);

      // Call update_limit_after_declare — recalculates limit_used for all affected users
      await db.execute(sql`
        CALL public.update_limit_after_declare(${market.marketId}::numeric)
      `);

      console.log(
        `[MarketResultCron] Declared market ${market.marketId} via stored procedures`
      );
    } else if (status === "VOID" || status === "ROLLBACK") {
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

    // Step 2: For resolved markets, fetch result and run procedures
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
