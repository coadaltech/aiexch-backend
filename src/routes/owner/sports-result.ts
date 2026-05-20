import { Elysia, t } from "elysia";
import { db } from "@db/index";
import { transactions, transactionDetails, marketSettings } from "@db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { redis } from "@db/redis";
import { SportsService } from "../../services/sports";
import { MarketType } from "../../types/enums";
import {
  getUndeclaredMarkets,
  getWinnerName,
  buildResultsMap,
  type UndeclaredMarket,
} from "../../services/market-result-cron-service";

export const sportsResultRoutes = new Elysia({ prefix: "/sports-result" })

  // GET /owner/sports-result/undeclared — list all undeclared markets
  .get("/undeclared", async ({ set }) => {
    try {
      const allMarketTypes = [
        MarketType.MatchOdds,
        MarketType.TiedMatch,
        MarketType.CompleteMatch,
        MarketType.Bookmaker,
        MarketType.Fancy,
      ];

      const markets = await getUndeclaredMarkets(allMarketTypes);

      // For each market, fetch distinct runners from transaction_details
      // transaction_details has ALL runners per transaction (not just the one bet on)
      const enriched = await Promise.all(
        markets.map(async (m) => {
          const runners = await db
            .selectDistinctOn([transactionDetails.runnerId], {
              selectionId: transactionDetails.runnerId,
              selectionName: transactionDetails.runnerName,
            })
            .from(transactionDetails)
            .innerJoin(
              transactions,
              eq(transactionDetails.transactionId, transactions.id)
            )
            .where(
              and(
                eq(transactions.marketId, m.marketId),
                eq(transactions.status, "matched")
              )
            );

          return {
            ...m,
            runners,
          };
        })
      );

      return { success: true, data: enriched };
    } catch (error) {
      console.error("sports-result/undeclared error:", error);
      set.status = 500;
      return { success: false, error: "Failed to fetch undeclared markets" };
    }
  })

  // POST /owner/sports-result/check-result — check result from external API
  .post(
    "/check-result",
    async ({ body, set }) => {
      try {
        const { marketId } = body;

        const apiResult = await SportsService.getNewMarketResult({ marketId });

        if (!apiResult?.isSuccess || !apiResult?.items) {
          return { success: true, data: { status: null, winnerId: null, apiResult: null } };
        }

        const { Status, WinnerId } = apiResult.items;
        return {
          success: true,
          data: {
            status: Status?.toUpperCase() || null,
            winnerId: WinnerId != null ? Number(WinnerId) : null,
            apiResult,
          },
        };
      } catch (error) {
        console.error("sports-result/check-result error:", error);
        set.status = 500;
        return { success: false, error: "Failed to check result from API" };
      }
    },
    { body: t.Object({ marketId: t.String() }) }
  )

  // POST /owner/sports-result/declare — declare result (same logic as cron)
  .post(
    "/declare",
    async ({ body, set }) => {
      try {
        const { marketId, winnerId, marketType, eventTypeId, competitionId, matchId, eventTypeName, competitionName, eventName, marketName } = body;

        const market: UndeclaredMarket = {
          marketId,
          matchId,
          eventTypeId,
          competitionId,
          marketType,
          marketName,
          eventTypeName,
          competitionName,
          eventName,
        };

        const winnerIdNum = Number(winnerId);
        const isFancy = marketType === MarketType.Fancy;
        const winRunnerId = winnerIdNum;
        const winRun = isFancy ? winnerIdNum : 0;

        const winnerName = isFancy
          ? (marketName ?? "")
          : await getWinnerName(marketId, winnerIdNum);

        const resultsMap = await buildResultsMap(market, winnerIdNum);
        const runners = Object.entries(resultsMap).map(([selId, result]) => ({
          selectionId: Number(selId),
          name: "",
          result,
        }));

        const apiResult = {
          isSuccess: true,
          items: { MarketId: marketId, Status: "DECLARED", WinnerId: winnerId },
          message: "Manual declaration from owner panel",
        };

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
            'manual'::varchar,
            ${JSON.stringify(apiResult)}::jsonb
          )
        `);

        await db.execute(sql`
          CALL public.update_limit_after_declare(${market.marketId}::numeric)
        `);

        // After result declaration: mark the market inactive in market_settings
        // and drop it from the live custom-markets Redis set so it disappears
        // from both the custom-markets management page and the public matchid
        // page. The market_results row (status='declared') keeps the audit trail.
        const settingsRow = await db
          .select({ eventId: marketSettings.eventId, isCustom: marketSettings.isCustom })
          .from(marketSettings)
          .where(eq(marketSettings.marketId, marketId))
          .limit(1);

        if (settingsRow.length > 0) {
          await db
            .update(marketSettings)
            .set({ isActive: false })
            .where(eq(marketSettings.marketId, marketId));

          if (redis.isOpen) {
            // Keep the Redis override hash in sync with the DB flag.
            await redis.hSet(`admin:market:${marketId}`, "isActive", "false");

            // For custom markets, drop the marketId from the per-event set so
            // the live pipeline (getCustomMarkets) stops including it on the
            // public matchid page.
            if (settingsRow[0].isCustom) {
              await redis.sRem(
                `custom:markets:${settingsRow[0].eventId}`,
                marketId
              );
            }
          }
        }

        return { success: true, message: `Market ${marketId} declared successfully` };
      } catch (error) {
        console.error("sports-result/declare error:", error);
        set.status = 500;
        return { success: false, error: "Failed to declare result" };
      }
    },
    {
      body: t.Object({
        marketId: t.String(),
        winnerId: t.Union([t.String(), t.Number()]),
        marketType: t.Number(),
        eventTypeId: t.Number(),
        competitionId: t.Union([t.Number(), t.Null()]),
        matchId: t.Number(),
        eventTypeName: t.String(),
        competitionName: t.String(),
        eventName: t.String(),
        marketName: t.Union([t.String(), t.Null()]),
      }),
    }
  );
