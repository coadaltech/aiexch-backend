import cron from "node-cron";
import { db } from "../db";
import { transactions } from "../db/schema";
import { eq, and, sql } from "drizzle-orm";
import { SportsService } from "./sports";
import { MarketType } from "../types/enums";

export interface UndeclaredMarket {
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
 * Fetch undeclared markets from the `transactions` table grouped by marketId,
 * enriched with sport / competition / event names.
 *
 * All of the logic — GROUP BY on transactions, "not yet declared" filter
 * against market_results, and the three enrichment LEFT JOINs — lives in the
 * SQL function fn_get_undeclared_markets. This replaces 5 queries + JS maps
 * with a single round trip.
 */
export async function getUndeclaredMarkets(
  marketTypes: number[]
): Promise<UndeclaredMarket[]> {
  try {
    // postgres.js doesn't auto-serialize a JS number[] as an int[]; build the
    // Postgres array literal ourselves. Inputs are compile-time MarketType ints,
    // so there's no injection risk — but we still narrow to integers to be safe.
    const arrayLiteral = `{${marketTypes.map((n) => Number(n) | 0).join(",")}}`;

    const result = await db.execute(sql`
      SELECT * FROM fn_get_undeclared_markets(${arrayLiteral}::int[])
    `);

    const rows: Array<Record<string, any>> = Array.isArray(result)
      ? (result as any[])
      : (result as any)?.rows ?? [];

    // Map snake_case SQL columns back to the UndeclaredMarket (camelCase) shape
    // the rest of the cron service expects.
    return rows.map((r) => ({
      marketId: String(r.market_id),
      matchId: Number(r.match_id),
      eventTypeId: Number(r.event_type_id),
      competitionId: r.competition_id != null ? Number(r.competition_id) : null,
      marketType: Number(r.market_type),
      marketName: r.market_name ?? null,
      eventTypeName: r.event_type_name ?? "",
      competitionName: r.competition_name ?? "",
      eventName: r.event_name ?? "",
    }));
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
export async function buildResultsMap(
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
export async function getWinnerName(marketId: string, selectionId: number): Promise<string> {
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
export async function fetchAndStoreResult(market: UndeclaredMarket): Promise<void> {
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

    if (status === "DECLARED" && WinnerId != null) {
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

      // Record the void/rollback in market_results so this market is not retried
      await db.execute(sql`
        INSERT INTO public.market_results (
          id, event_id, event_type_id, competition_id, market_id, market_type,
          status, source, api_response, settled_at, declared_at,
          added_by, added_date, update_by, update_date, record_status
        ) VALUES (
          gen_random_uuid(),
          ${market.matchId}::bigint,
          ${market.eventTypeId}::bigint,
          ${market.competitionId ?? 0}::bigint,
          ${market.marketId}::numeric,
          ${market.marketType}::int,
          ${status}::varchar,
          'api'::varchar,
          ${JSON.stringify(apiResult)}::jsonb,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
          '00000000-0000-0000-0000-000000000000'::uuid,
          CURRENT_TIMESTAMP,
          '00000000-0000-0000-0000-000000000000'::uuid,
          CURRENT_TIMESTAMP, 0
        )
        ON CONFLICT (market_id) DO UPDATE SET
          status = EXCLUDED.status,
          api_response = EXCLUDED.api_response,
          settled_at = EXCLUDED.settled_at,
          update_date = CURRENT_TIMESTAMP
      `);

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

    // Step 1: Check which markets have WINNER/LOSER in odds data (used for logging only)
    const allMarketIds = undeclaredMarkets.map((m) => m.marketId);
    const resolvedMarketIds = await checkMarketOddsStatus(allMarketIds);

    console.log(
      `[MarketResultCron] ${resolvedMarketIds.size} of ${undeclaredMarkets.length} ${label} markets confirmed by Books API`
    );

    // Step 2: Process ALL markets via the Result API.
    // Books-API-confirmed markets are processed first as a priority hint,
    // but we do NOT skip the rest — the Result API is the authoritative source
    // and markets must not get permanently stuck when the Books API lags.
    const prioritized = [
      ...undeclaredMarkets.filter((m) => resolvedMarketIds.has(m.marketId)),
      ...undeclaredMarkets.filter((m) => !resolvedMarketIds.has(m.marketId)),
    ];

    for (const market of prioritized) {
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
