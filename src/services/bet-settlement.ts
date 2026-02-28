import { db } from "../db";
import { transactions } from "../db/schema";
import { eq, and, inArray, isNull, or, lt } from "drizzle-orm";
import { SportsService } from "./sports";
import { addResultToQueue } from "../queues/betting";

interface MatchBetGroup {
  matchId: string;
  eventTypeId: string;
  marketIds: string[];
  marketTypes: Set<string>;
}

/**
 * Check if a match is finished based on score data
 */
async function isMatchFinished(
  eventTypeId: string,
  matchId: string
): Promise<boolean> {
  try {
    const score = await SportsService.getScore({ eventTypeId, matchId });
    if (!score || !score.data) {
      return false;
    }

    // Check if match has completed_message (indicates match is finished)
    const completedMessage = score.data.completed_message;
    if (completedMessage && completedMessage.trim().length > 0) {
      return true;
    }

    // Additional check: if msg indicates match is finished
    const msg = score.data.msg || "";
    const finishedKeywords = [
      "finished",
      "completed",
      "won by",
      "defeated",
      "match over",
      "result",
    ];
    if (finishedKeywords.some((keyword) => msg.toLowerCase().includes(keyword))) {
      return true;
    }

    return false;
  } catch (error) {
    console.error(`Error checking match status for ${matchId}:`, error);
    return false;
  }
}

/**
 * Fetch results from API based on market type and map to selection IDs
 */
async function fetchAndMapResults(
  eventTypeId: string,
  marketIds: string[],
  marketType: string
): Promise<Record<string, "winner" | "loser">> {
  const results: Record<string, "winner" | "loser"> = {};

  try {
    if (marketType === "odds") {
      const oddsResults = await SportsService.getOddsResults({
        eventTypeId,
        marketIds,
      });

      for (const market of oddsResults) {
        if (market.runners && Array.isArray(market.runners)) {
          for (const runner of market.runners) {
            const selectionId = runner.selectionId?.toString();
            if (selectionId) {
              // Check runner status - "WINNER" indicates winner
              const status = runner.status?.toUpperCase() || "";
              if (status === "WINNER" || status === "WON") {
                results[selectionId] = "winner";
              } else if (
                status === "LOSER" ||
                status === "LOST" ||
                status === "REMOVED"
              ) {
                results[selectionId] = "loser";
              }
            }
          }
        }
      }
    } else if (marketType === "bookmakers") {
      const bookmakerResults = await SportsService.getBookmakersResults({
        eventTypeId,
        marketIds,
      });

      for (const result of bookmakerResults) {
        // Bookmaker results format: { id: selectionId, result: "WINNER" | "LOSER" }
        if (result.id && result.result) {
          const resultStatus = result.result.toUpperCase();
          if (resultStatus === "WINNER" || resultStatus === "WON") {
            results[result.id] = "winner";
          } else {
            results[result.id] = "loser";
          }
        }
      }
    } else if (marketType === "sessions") {
      const sessionResults = await SportsService.getSessionResults({
        eventTypeId,
        marketIds,
      });

      for (const result of sessionResults) {
        if (result.id && result.result) {
          const resultStatus = result.result.toUpperCase();
          if (resultStatus === "WINNER" || resultStatus === "WON") {
            results[result.id] = "winner";
          } else {
            results[result.id] = "loser";
          }
        }
      }
    } else if (marketType === "fancy") {
      const fancyResults = await SportsService.getFancyResults({
        eventTypeId,
        marketIds,
      });

      for (const result of fancyResults) {
        if (result.id && result.result) {
          const resultStatus = result.result.toUpperCase();
          if (resultStatus === "WINNER" || resultStatus === "WON") {
            results[result.id] = "winner";
          } else {
            results[result.id] = "loser";
          }
        }
      }
    }
  } catch (error) {
    console.error(
      `Error fetching results for marketType ${marketType}:`,
      error
    );
  }

  return results;
}

/**
 * Process and settle transactions for a finished match
 */
async function settleMatchBets(
  matchId: string,
  eventTypeId: string,
  marketIds: string[],
  marketTypes: Set<string>
): Promise<void> {
  try {
    // Fetch results for each market type
    const allResults: Record<string, "winner" | "loser"> = {};

    for (const marketType of marketTypes) {
      // Get market IDs for this specific market type
      // Use default "odds" if marketType is null/undefined
      const effectiveMarketType = marketType || "odds";

      const transactionsForMarketType = await db
        .select({ marketId: transactions.marketId })
        .from(transactions)
        .where(
          and(
            eq(transactions.matchId, matchId),
            eq(transactions.eventTypeId, eventTypeId),
            eq(transactions.status, "matched"),
            eq(transactions.marketType, effectiveMarketType),
            inArray(transactions.marketId, marketIds)
          )
        )
        .groupBy(transactions.marketId);

      const marketIdsForType = transactionsForMarketType.map((b) => b.marketId);

      if (marketIdsForType.length > 0) {
        const typeResults = await fetchAndMapResults(
          eventTypeId,
          marketIdsForType,
          effectiveMarketType
        );
        Object.assign(allResults, typeResults);
      }
    }

    // If we have results, declare them
    if (Object.keys(allResults).length > 0) {
      console.log(
        `Declaring results for match ${matchId}:`,
        Object.keys(allResults).length,
        "selections"
      );
      await addResultToQueue({ matchId, results: allResults });
    } else {
      console.warn(
        `No results found for match ${matchId}, but match appears finished`
      );
    }
  } catch (error) {
    console.error(`Error settling transactions for match ${matchId}:`, error);
  }
}

/**
 * Check and settle transactions for finished matches
 */
export async function checkAndSettleBets(): Promise<void> {
  try {
    console.log("Starting bet settlement check...");

    // Get all matched transactions that haven't been settled
    // Check only transactions that haven't been checked recently (within last hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const unsettledBets = await db
      .select({
        matchId: transactions.matchId,
        eventTypeId: transactions.eventTypeId,
        marketId: transactions.marketId,
        marketType: transactions.marketType,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.status, "matched"),
          or(
            isNull(transactions.resultCheckedAt),
            lt(transactions.resultCheckedAt, oneHourAgo)
          )
        )
      )
      .groupBy(
        transactions.matchId,
        transactions.eventTypeId,
        transactions.marketId,
        transactions.marketType
      );

    if (unsettledBets.length === 0) {
      console.log("No unsettled transactions found");
      return;
    }

    console.log(`Found ${unsettledBets.length} groups of unsettled transactions`);

    // Group transactions by match
    const matchGroups = new Map<string, MatchBetGroup>();

    for (const bet of unsettledBets) {
      const key = `${bet.matchId}-${bet.eventTypeId}`;
      if (!matchGroups.has(key)) {
        matchGroups.set(key, {
          matchId: bet.matchId,
          eventTypeId: bet.eventTypeId,
          marketIds: [],
          marketTypes: new Set(),
        });
      }

      const group = matchGroups.get(key)!;
      if (!group.marketIds.includes(bet.marketId)) {
        group.marketIds.push(bet.marketId);
      }
      // Use default "odds" if marketType is null/undefined
      group.marketTypes.add(bet.marketType || "odds");
    }

    // Process each match
    for (const [key, group] of matchGroups) {
      try {
        // Ensure eventTypeId has a value (default to "4" for cricket if null)
        const eventTypeId = group.eventTypeId || "4";

        // Update resultCheckedAt to prevent duplicate checks
        await db
          .update(transactions)
          .set({ resultCheckedAt: new Date() })
          .where(
            and(
              eq(transactions.matchId, group.matchId),
              eq(transactions.eventTypeId, eventTypeId),
              eq(transactions.status, "matched")
            )
          );

        // Check if match is finished
        const isFinished = await isMatchFinished(eventTypeId, group.matchId);

        if (isFinished) {
          console.log(
            `Match ${group.matchId} is finished, settling transactions...`
          );
          await settleMatchBets(
            group.matchId,
            eventTypeId,
            group.marketIds,
            group.marketTypes
          );
        } else {
          // console.log(`Match ${group.matchId} is still in progress`);
        }
      } catch (error) {
        console.error(`Error processing match group ${key}:`, error);
      }
    }

    console.log("Bet settlement check completed");
  } catch (error) {
    console.error("Error in checkAndSettleBets:", error);
  }
}

/**
 * Start the automatic bet settlement service
 * Checks every 5 minutes for finished matches
 */
export function startBetSettlementService(): void {
  console.log("Starting automatic bet settlement service...");

  // Run immediately on startup
  checkAndSettleBets().catch((error) => {
    console.error("Error in initial bet settlement check:", error);
  });

  // Then run every 5 minutes
  const interval = setInterval(() => {
    checkAndSettleBets().catch((error) => {
      console.error("Error in scheduled bet settlement check:", error);
    });
  }, 5 * 60 * 1000); // 5 minutes

  // Store interval ID for potential cleanup
  (global as any).betSettlementInterval = interval;
}

