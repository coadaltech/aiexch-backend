import Bull from "bull";
import { db } from "../db";
import { transactions } from "../db/schema";
import { eq, and } from "drizzle-orm";

// Lazy initialization for Bun compatibility - queues are only created when needed
let _bettingQueue: Bull.Queue | null = null;
let _resultQueue: Bull.Queue | null = null;
let bettingProcessorInitialized = false;
let resultProcessorInitialized = false;

const getBettingQueue = (): Bull.Queue | null => {
  if (!_bettingQueue) {
    try {
      _bettingQueue = new Bull("betting queue", {
        redis: { port: 6379, host: "127.0.0.1" },
      });
    } catch (error) {
      return null;
    }
  }
  return _bettingQueue;
};

const getResultQueue = (): Bull.Queue | null => {
  if (!_resultQueue) {
    try {
      _resultQueue = new Bull("result queue", {
        redis: { port: 6379, host: "127.0.0.1" },
      });
    } catch (error) {
      return null;
    }
  }
  return _resultQueue;
};

const initializeBettingProcessor = () => {
  if (bettingProcessorInitialized) return;
  const queue = getBettingQueue();
  if (!queue) return;

  try {
    queue.process("place-bet", async (job) => {
      const { betId } = job.data;

      try {
        // Balance/exposure is managed by the ledger_limit table.
        // This processor just confirms the matched status.
        await db
          .update(transactions)
          .set({ status: "matched", matchedAt: new Date() })
          .where(eq(transactions.id, betId));

        return { success: true, betId };
      } catch (error) {
        try {
          await db
            .update(transactions)
            .set({ status: "cancelled" })
            .where(eq(transactions.id, betId));
        } catch (refundError) {
          console.error("Failed to cancel bet:");
        }
        throw error;
      }
    });
    bettingProcessorInitialized = true;
  } catch (error) {
    console.warn("Failed to initialize betting processor:");
  }
};

const initializeResultProcessor = () => {
  if (resultProcessorInitialized) return;
  const queue = getResultQueue();
  if (!queue) return;

  try {
    queue.process("declare-result", async (job) => {
      const { matchId, results } = job.data;

      try {
        // Get all matched transactions for this match
        const matchBets = await db
          .select()
          .from(transactions)
          .where(and(eq(transactions.matchId, matchId), eq(transactions.status, "matched")));

        for (const bet of matchBets) {
          const isWinner = results[bet.selectionId] === "winner";
          const newStatus = isWinner ? "won" : "lost";

          // Update bet status
          await db
            .update(transactions)
            .set({
              status: newStatus,
              settledAt: new Date(),
              settledAmount: isWinner
                ? (
                    parseFloat(bet.stake || "0") * parseFloat(bet.odds || "0")
                  ).toString()
                : "0",
            })
            .where(eq(transactions.id, bet.id));

          // Ledger (userBalance + exposure) is updated automatically by the
          // trg_ledger_limit_on_settle DB trigger when the status changes above.
        }

        return { success: true, processedBets: matchBets.length };
      } catch (error) {
        throw error;
      }
    });
    resultProcessorInitialized = true;
  } catch (error) {
    console.warn("Failed to initialize result processor:");
  }
};

interface BetQueueData {
  betId: string;
  userId: string;
  stake: number;
}

interface ResultQueueData {
  matchId: number;
  results: Record<string, "winner" | "loser">;
}

// Export functions that lazily initialize queues
export const addBetToQueue = (betData: BetQueueData) => {
  initializeBettingProcessor();
  const queue = getBettingQueue();
  if (!queue) {
    // Could add fallback synchronous processing here if needed
    throw new Error("Queue system not available");
  }
  return queue.add("place-bet", betData, {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
  });
};

export const addResultToQueue = (resultData: ResultQueueData) => {
  initializeResultProcessor();
  const queue = getResultQueue();
  if (!queue) {
    console.warn("Queue system not available");
    // throw new Error("Queue system not available");
  }
  return queue?.add("declare-result", resultData, {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
  });
};

// Export queues as getters for backwards compatibility (but they won't be created until used)
export const bettingQueue = {
  get process() {
    initializeBettingProcessor();
    const queue = getBettingQueue();
    return queue?.process.bind(queue) || (() => {});
  },
  get add() {
    const queue = getBettingQueue();
    return queue?.add.bind(queue) || (() => {});
  },
} as any as Bull.Queue;

export const resultQueue = {
  get process() {
    initializeResultProcessor();
    const queue = getResultQueue();
    return queue?.process.bind(queue) || (() => {});
  },
  get add() {
    const queue = getResultQueue();
    return queue?.add.bind(queue) || (() => {});
  },
} as any as Bull.Queue;
