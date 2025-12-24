import { Elysia } from "elysia";
import { db } from "../db";
import { bets, users } from "../db/schema";
import { eq, and, desc } from "drizzle-orm";
import { addResultToQueue } from "../queues/betting";
import { app_middleware } from "../middleware/auth";

export const bettingRoutes = new Elysia({ prefix: "/betting" })
  .state({ id: 0, role: "" })
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
  .post("/place", async ({ body, store, set }) => {
    try {


      const {
        matchId,
        marketId,
        selectionId,
        marketName,
        runnerName,
        odds,
        stake,
        type,
      } = body as {
        matchId: string;
        marketId: string;
        selectionId: string;
        marketName?: string;
        runnerName?: string;
        odds: number;
        stake: number;
        type: "back" | "lay";
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

      // Check user balance first
      const userData = await db
        .select({ balance: users.balance })
        .from(users)
        .where(eq(users.id, store.id))
        .limit(1);

      if (!userData[0] || parseFloat(userData[0].balance || "0") < stake) {
        set.status = 400;
        return { success: false, error: "Insufficient balance" };
      }

      // Use transaction for atomicity
      const [bet] = await db.transaction(async (tx) => {
        // Deduct stake from balance
        await tx
          .update(users)
          .set({
            balance: (
              parseFloat(userData[0].balance || "0") - stake
            ).toString(),
          })
          .where(eq(users.id, store.id));

        // Create bet record as matched
        const [newBet] = await tx
          .insert(bets)
          .values({
            userId: store.id,
            matchId,
            marketId,
            selectionId,
            marketName: marketName || null,
            runnerName: runnerName || null,
            odds: odds.toString(),
            stake: stake.toString(),
            type,
            status: "matched",
            matchedAt: new Date(),
          })
          .returning();

        return [newBet];
      });


      set.status = 201;
      return { success: true, betId: bet.id };
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


      let whereClause = eq(bets.userId, store.id);
      if (status !== "all") {
        whereClause =
          and(eq(bets.userId, store.id), eq(bets.status, status)) ||
          eq(bets.userId, store.id);
      }

      const limit = parseInt((query?.limit as string) || "50");
      const offset = parseInt((query?.offset as string) || "0");

      const userBets = await db
        .select()
        .from(bets)
        .where(whereClause)
        .orderBy(desc(bets.createdAt))
        .limit(limit)
        .offset(offset);


      set.status = 200;
      return { success: true, data: userBets };
    } catch (error) {
      console.error("Failed to fetch bets:");
      set.status = 500;
      return { success: false, error: "Failed to fetch bets" };
    }
  })

  // Cancel pending bet
  .post("/cancel/:betId", async ({ params, store, set }) => {
    try {
      const bet = await db
        .select()
        .from(bets)
        .where(
          and(
            eq(bets.id, parseInt(params.betId)),
            eq(bets.userId, store.id),
            eq(bets.status, "pending")
          )
        )
        .limit(1);

      if (!bet[0]) {
        set.status = 404;
        return {
          success: false,
          error: "Bet not found or cannot be cancelled",
        };
      }

      await db
        .update(bets)
        .set({ status: "cancelled", cancelledAt: new Date() })
        .where(eq(bets.id, parseInt(params.betId)));

      set.status = 200;
      return { success: true };
    } catch (error) {
      console.error("Failed to cancel bet:");
      set.status = 500;
      return { success: false, error: "Failed to cancel bet" };
    }
  })

  // Admin: Declare match results
  .post("/admin/declare-result", async ({ body, set }) => {
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

  // Get user balance
  .get("/balance", async ({ store, set }) => {
    try {
      const userData = await db
        .select({ balance: users.balance })
        .from(users)
        .where(eq(users.id, store.id))
        .limit(1);

      set.status = 200;
      return { success: true, balance: userData[0]?.balance || 0 };
    } catch (error) {
      console.error("Failed to fetch balance:");
      set.status = 500;
      return { success: false, error: "Failed to fetch balance" };
    }
  });
