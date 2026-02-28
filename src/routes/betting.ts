import { Elysia } from "elysia";
import { db } from "../db";
import { transactions, transactionDetails, transactionLogs, users, profiles } from "../db/schema";
import { parseUserAgent } from "../utils/parse-ua";
import { eq, and, desc, inArray } from "drizzle-orm";
import { addResultToQueue } from "../queues/betting";
import { app_middleware } from "../middleware/auth";

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

      if (!runners || runners.length < 2) {
        set.status = 400;
        return { success: false, error: "At least two runners are required" };
      }

      const userData = await db
        .select({
          balance: profiles.balance,
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

      if (parseFloat(userData[0].balance || "0") < stake) {
        set.status = 400;
        return { success: false, error: "Insufficient balance" };
      }

      // Fetch whitelabelId from users table
      const userRecord = await db
        .select({ whitelabelId: users.whitelabelId })
        .from(users)
        .where(eq(users.id, store.id))
        .limit(1);

      const whitelabelId = userRecord[0]?.whitelabelId ?? null;
      console.log("Request ", request)

      const ipAddress =
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        request.headers.get("x-real-ip") ||
        null;

      const ua = parseUserAgent(request.headers.get("user-agent"));

      const potentialPayout = (stake * odds).toFixed(2);

      const [txn] = await db.transaction(async (tx) => {
        // Deduct stake from balance
        await tx
          .update(profiles)
          .set({
            balance: (parseFloat(userData[0].balance || "0") - stake).toString(),
          })
          .where(eq(profiles.userId, store.id));

        // Insert main transaction record
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
            potentialPayout,
            status: "matched",
            ipAddress,
            matchedAt: new Date(),
          })
          .returning();

        // Insert one row per runner into transaction_details
        const detailRows = runners.map((runner) => {
          const isSelected = runner.id === selectionId;
          const runnerReturn = isSelected
            ? (stake * odds).toFixed(2)
            : "0";
          return {
            transactionId: newTxn.id,
            runnerId: runner.id,
            runnerName: runner.name || null,
            isUserSelection: isSelected,
            price: runner.price.toString(),
            stake: stake.toString(),
            potentialReturn: runnerReturn,
          };
        });

        await tx.insert(transactionDetails).values(detailRows);

        await tx.insert(transactionLogs).values({
          transactionId: newTxn.id,
          userId: store.id,
          ipAddress,
          ...ua,
        });

        return [newTxn];
      });

      set.status = 201;
      return { success: true, transactionId: txn.id };
    } catch (error) {
      set.status = 500;
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to place bet",
      };
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

      // Refund the stake
      const profile = await db
        .select({ balance: profiles.balance })
        .from(profiles)
        .where(eq(profiles.userId, store.id))
        .limit(1);

      await db.transaction(async (tx) => {
        await tx
          .update(transactions)
          .set({ status: "cancelled", cancelledAt: new Date() })
          .where(eq(transactions.id, params.transactionId));

        if (profile[0]) {
          await tx
            .update(profiles)
            .set({
              balance: (
                parseFloat(profile[0].balance || "0") +
                parseFloat(txn[0].stake || "0")
              ).toString(),
            })
            .where(eq(profiles.userId, store.id));
        }
      });

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

  .get("/balance", async ({ store, set }) => {
    try {
      const userData = await db
        .select({ balance: profiles.balance })
        .from(profiles)
        .where(eq(profiles.userId, store.id))
        .limit(1);

      set.status = 200;
      return { success: true, balance: userData[0]?.balance || 0 };
    } catch (error) {
      console.error("Failed to fetch balance:");
      set.status = 500;
      return { success: false, error: "Failed to fetch balance" };
    }
  });
