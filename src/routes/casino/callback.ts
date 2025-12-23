import { Elysia, t } from "elysia";
import { whitelabel_middleware } from "@middleware/whitelabel";
import { transactions } from "@db/schema";
import { eq } from "drizzle-orm";
import { CasinoCallbackService } from "@services/casino/casino-callback";
import type { CallbackHeaders } from "@services/casino/casino-callback";
import { DbType } from "../../types";

export const casinoCallbackRoutes = new Elysia({ prefix: "/casino/callback" })
  .resolve(async ({ request }): Promise<{ db: DbType; whitelabel: any }> => {
    const { db, whitelabel } = await whitelabel_middleware(request);
    return { db: db as DbType, whitelabel };
  })
  .post(
    "/",
    async ({ body, headers, db, set }) => {
      const startTime = Date.now();
      set.status = 200;

      try {
        const {
          action,
          player_id,
          currency,
          amount,
          transaction_id,
          rollback_transactions,
        } = body;

        const requiredHeaderKeys: Array<keyof CallbackHeaders> = [
          "x-merchant-id",
          "x-timestamp",
          "x-nonce",
          "x-sign",
        ];

        const missingHeader = requiredHeaderKeys.find((key) => !headers[key]);

        if (missingHeader) {
          return {
            success: false,
            error: `Missing signature header: ${missingHeader}`,
          };
        }

        const signatureHeaders: CallbackHeaders = {
          "x-merchant-id": headers["x-merchant-id"] as string,
          "x-timestamp": headers["x-timestamp"] as string,
          "x-nonce": headers["x-nonce"] as string,
          "x-sign": headers["x-sign"] as string,
        };

        const signatureValid = CasinoCallbackService.verifySignature(
          signatureHeaders,
          body
        );
        if (!signatureValid) {
          return { success: false, error: "Invalid signature" };
        }

        if (currency !== "INR") {
          set.status = 400;
          return { success: false, error: "Invalid currency" };
        }

        const playerId = Number(player_id);
        if (isNaN(playerId)) {
          set.status = 400;
          return { success: false, error: "Invalid player_id" };
        }

        switch (action) {
          case "balance": {
            const balance = await CasinoCallbackService.getBalance(
              db,
              playerId
            );
            if (balance === null) {
              set.status = 404;
              return { success: false, error: "Player not found" };
            }
            set.status = 200;
            return { success: true, balance };
          }

          case "bet": {
            if (!transaction_id || !amount) {
              set.status = 400;
              return {
                success: false,
                error: "Missing transaction_id or amount",
              };
            }

            const existingTxn = await CasinoCallbackService.getTransaction(
              db,
              transaction_id
            );
            if (existingTxn) {
              const balance = await CasinoCallbackService.getBalance(
                db,
                playerId
              );
              return { success: true, balance, transaction_id };
            }

            const balance = await CasinoCallbackService.getBalance(
              db,
              playerId
            );
            if (balance === null) {
              set.status = 404;
              return { success: false, error: "Player not found" };
            }

            const currentBalance = Number(balance);
            const betAmount = Number(amount);

            if (currentBalance < betAmount) {
              set.status = 400;
              return { success: false, error: "Insufficient balance" };
            }

            await CasinoCallbackService.deductBalance(db, playerId, amount);
            await CasinoCallbackService.saveTransaction(
              db,
              playerId,
              transaction_id,
              "bet",
              amount,
              "completed"
            );

            const newBalance = await CasinoCallbackService.getBalance(
              db,
              playerId
            );

            return { success: true, balance: newBalance, transaction_id };
          }

          case "win": {
            if (!transaction_id || !amount) {
              set.status = 400;
              return {
                success: false,
                error: "Missing transaction_id or amount",
              };
            }

            const existingTxn = await CasinoCallbackService.getTransaction(
              db,
              transaction_id
            );
            if (existingTxn) {
              const balance = await CasinoCallbackService.getBalance(
                db,
                playerId
              );
              return { success: true, balance, transaction_id };
            }

            const balanceBefore = await CasinoCallbackService.getBalance(
              db,
              playerId
            );
            if (balanceBefore === null) {
              set.status = 404;
              return { success: false, error: "Player not found" };
            }

            const winAmount = Number(amount);
            const currentBalance = Number(balanceBefore);

            await CasinoCallbackService.addBalance(db, playerId, amount);
            await CasinoCallbackService.saveTransaction(
              db,
              playerId,
              transaction_id,
              "win",
              amount,
              "completed"
            );

            const newBalance = await CasinoCallbackService.getBalance(
              db,
              playerId
            );

            return { success: true, balance: newBalance, transaction_id };
          }

          case "refund": {
            if (!transaction_id || !amount) {
              set.status = 400;
              return {
                success: false,
                error: "Missing transaction_id or amount",
              };
            }

            const existingTxn = await CasinoCallbackService.getTransaction(
              db,
              transaction_id
            );
            if (existingTxn) {
              const balance = await CasinoCallbackService.getBalance(
                db,
                playerId
              );
              return { success: true, balance, transaction_id };
            }

            const balanceBefore = await CasinoCallbackService.getBalance(
              db,
              playerId
            );
            if (balanceBefore === null) {
              set.status = 404;
              return { success: false, error: "Player not found" };
            }

            const refundAmount = Number(amount);
            const currentBalance = Number(balanceBefore);

            await CasinoCallbackService.addBalance(db, playerId, amount);
            await CasinoCallbackService.saveTransaction(
              db,
              playerId,
              transaction_id,
              "refund",
              amount,
              "completed"
            );

            const newBalance = await CasinoCallbackService.getBalance(
              db,
              playerId
            );

            return { success: true, balance: newBalance, transaction_id };
          }

          case "rollback": {
            if (!rollback_transactions || rollback_transactions.length === 0) {
              set.status = 400;
              return { success: false, error: "Missing rollback_transactions" };
            }

            const balanceBefore = await CasinoCallbackService.getBalance(
              db,
              playerId
            );
            if (balanceBefore === null) {
              set.status = 404;
              return { success: false, error: "Player not found" };
            }

            let rolledBackCount = 0;
            let skippedCount = 0;
            let totalRefunded = 0;
            let totalDeducted = 0;

            for (const txnId of rollback_transactions) {
              const txn = await CasinoCallbackService.getTransaction(db, txnId);
              if (txn) {
                if (txn.type === "bet") {
                  const refundAmount = Number(txn.amount);
                  await CasinoCallbackService.addBalance(
                    db,
                    playerId,
                    txn.amount
                  );
                  totalRefunded += refundAmount;
                } else if (txn.type === "win") {
                  const deductAmount = Number(txn.amount);
                  await CasinoCallbackService.deductBalance(
                    db,
                    playerId,
                    txn.amount
                  );
                  totalDeducted += deductAmount;
                }

                await db
                  .update(transactions)
                  .set({ status: "rolled_back" })
                  .where(eq(transactions.reference, txnId));

                rolledBackCount++;
              } else {
                skippedCount++;
              }
            }

            const balanceAfter = await CasinoCallbackService.getBalance(
              db,
              playerId
            );

            return { success: true, balance: balanceAfter };
          }

          default:
            set.status = 400;
            return { success: false, error: "Invalid action" };
        }
      } catch (error) {
        const duration = Date.now() - startTime;

        set.status = 500;
        return {
          success: false,
          error: "Internal server error",
        };
      }
    },
    {
      body: t.Object({
        action: t.Union([
          t.Literal("balance"),
          t.Literal("bet"),
          t.Literal("win"),
          t.Literal("refund"),
          t.Literal("rollback"),
        ]),
        player_id: t.String(),
        currency: t.String(),
        session_id: t.Optional(t.String()),
        amount: t.Optional(t.String()),
        transaction_id: t.Optional(t.String()),
        game_uuid: t.Optional(t.String()),
        round_id: t.Optional(t.String()),
        rollback_transactions: t.Optional(t.Array(t.String())),
      }),
    }
  );
