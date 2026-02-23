import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { users } from "../../db/schema";
import { whitelabel_middleware } from "@middleware/whitelabel";
import { CasinoCallbackService } from "@services/casino/casino-callback";
import type { CallbackHeaders } from "@services/casino/casino-callback";
import { CALLBACK_ACTION, DbType } from "../../types";
import { convertINRToEUR, convertEURToINR } from "@utils/currency";

export const casinoCallbackRoutes = new Elysia({ prefix: "/casino/callback" })
  .resolve(async ({ request }): Promise<{ db: DbType; whitelabel: any }> => {
    const { db, whitelabel } = await whitelabel_middleware(request);
    return { db: db as DbType, whitelabel };
  })
  .post(
    "/",
    async ({ body, headers, db, set, whitelabel }) => {
      const startTime = Date.now();
      set.status = 200;

      console.log(".........................................................................................")
      console.log(".........................................................................................")
      console.log("------------ CALLBACK -------------");
      console.log("body :", body);
      console.log("-----------------------------------");
      try {
        const {
          action,
          player_id,
          currency,
          amount,
          transaction_id,
          rollback_transactions,
          type,
          bet_transaction_id,
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
        console.log("signatureValid -> ", signatureValid)

        if (!signatureValid) {
          return { success: false, error: "Invalid signature" };
        }

        // Accept both INR and EUR currencies
        const supportedCurrencies = ["INR", "EUR"];
        if (!supportedCurrencies.includes(currency)) {
          set.status = 400;
          return {
            success: false,
            error: `Invalid currency. Supported currencies: ${supportedCurrencies.join(
              ", "
            )}`,
          };
        }

        const playerId = Number(player_id);
        if (isNaN(playerId)) {
          set.status = 400;
          return { success: false, error: "Invalid player_id" };
        }
        // console.log("--------------------------------");
        // console.log(action);
        // console.log("--------------------------------");

        const parseAmount = (value: unknown): number => {
          if (value === undefined || value === null) return NaN;
          const num =
            typeof value === "number"
              ? value
              : Number.parseFloat(String(value));
          return Number.isFinite(num) ? num : NaN;
        };

        const formatBalanceForCurrency = (rawBalance: string | null) => {
          if (rawBalance === null) return null;
          const numericBalance =
            currency === "EUR"
              ? Number(convertINRToEUR(rawBalance))
              : Number(rawBalance);
          return Number.isFinite(numericBalance)
            ? Number(numericBalance.toFixed(2))
            : null;
        };

        const convertAmountToINR = (amountValue: number): string => {
          return currency === "EUR"
            ? convertEURToINR(amountValue)
            : amountValue.toFixed(2);
        };

        switch (action) {
          case "balance": {
            const balance = await CasinoCallbackService.getBalance(
              db,
              playerId
            );
            if (balance === null) {
              set.status = 404;
              console.log("------------ our response -------------------")
              console.log({ success: false, error: "Player not found" });
              return { success: false, error: "Player not found" };
            }

            // Convert balance from INR to EUR if currency is EUR
            let convertedBalance = balance;
            if (currency === "EUR") {
              console.log("balance in DB -> ", balance)
              convertedBalance = convertINRToEUR(balance);
              console.log("convertedBalance -> ", convertedBalance)
            }

            console.log("------------ our response -------------------")
            console.log({ success: true, balance: Number(convertedBalance) });

            set.status = 200;
            return {
              // success: true,
              balance: Number(convertedBalance)
            };
          }

          case "bet": {

            if (!transaction_id || amount === undefined) {
              set.status = 400;
              console.log("------------ our response -------------------")
              console.log({
                success: false,
                error: "Missing transaction_id or amount",
              });
              return {
                success: false,
                error: "Missing transaction_id or amount",
              };
            }

            const amountValue = parseAmount(amount);
            if (Number.isNaN(amountValue) || amountValue < 0) {
              set.status = 400;
              console.log("------------ our response -------------------")
              console.log({ success: false, error: "Invalid amount" });
              return { success: false, error: "Invalid amount" };
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
              const convertedBalance = formatBalanceForCurrency(balance);
              console.log("------------ our response -------------------")
              console.log({
                success: true,
                balance: convertedBalance,
                transaction_id,
              });
              console.log("------------ our response -------------------")
              console.log({ success: true, balance: convertedBalance, transaction_id });
              return {
                success: true,
                balance: convertedBalance,
                transaction_id,
              };
            }

            const balance = await CasinoCallbackService.getBalance(db, playerId);
            if (balance === null) {
              set.status = 404;

              console.log("------------ our response -------------------")
              console.log({ success: false, error: "Player not found" });

              return { success: false, error: "Player not found" };
            }

            const [playerUser] = await db
              .select({ betStatus: users.betStatus, parentBetStatus: users.parentBetStatus })
              .from(users)
              .where(eq(users.id, playerId))
              .limit(1);
            const canBet = (playerUser?.betStatus ?? true) && (playerUser?.parentBetStatus ?? true);
            if (!canBet) {
              set.status = 403;
              return { success: false, error: "Betting is disabled for your account" };
            }

            // Convert EUR amount to INR for database operations
            const amountInINR = convertAmountToINR(amountValue);
            const currentBalance = Number(balance);
            const betAmount = Number(amountInINR);

            if (currentBalance < betAmount) {
              set.status = 400;
              console.log("------------ our response -------------------")
              console.log({ success: false, error: "Insufficient balance" });
              return { success: false, error: "Insufficient balance" };
            }

            await CasinoCallbackService.deductBalance(
              db,
              playerId,
              amountInINR
            );
            await CasinoCallbackService.saveTransaction(
              db,
              playerId,
              transaction_id,
              "bet",
              amountInINR,
              "completed",
              currency,
              type ? { method: type } : undefined
            );

            const newBalance = await CasinoCallbackService.getBalance(
              db,
              playerId
            );

            const convertedBalance = formatBalanceForCurrency(newBalance);

            console.log("------------ our response -------------------")
            console.log({ success: true, balance: convertedBalance, transaction_id });
            return { success: true, balance: convertedBalance, transaction_id };
          }

          case "win": {
            if (!transaction_id || amount === undefined) {
              set.status = 400;
              console.log("------------ our response -------------------")
              console.log({
                success: false,
                error: "Missing transaction_id or amount",
              });
              return {
                success: false,
                error: "Missing transaction_id or amount",
              };
            }

            const amountValue = parseAmount(amount);
            if (Number.isNaN(amountValue) || amountValue < 0) {
              set.status = 400;
              console.log("------------ our response -------------------")
              console.log({ success: false, error: "Invalid amount" });
              return { success: false, error: "Invalid amount" };
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
              const convertedBalance = formatBalanceForCurrency(balance);
              console.log("------------ our response -------------------")
              console.log({
                success: true,
                balance: convertedBalance,
                transaction_id,
              });
              return {
                success: true,
                balance: convertedBalance,
                transaction_id,
              };
            }

            const balanceBefore = await CasinoCallbackService.getBalance(
              db,
              playerId
            );
            if (balanceBefore === null) {
              set.status = 404;
              console.log("------------ our response -------------------")
              console.log({ success: false, error: "Player not found" });
              return { success: false, error: "Player not found" };
            }

            const amountInINR = convertAmountToINR(amountValue);

            await CasinoCallbackService.addBalance(db, playerId, amountInINR);
            await CasinoCallbackService.saveTransaction(
              db,
              playerId,
              transaction_id,
              "win",
              amountInINR,
              "completed",
              currency,
              type ? { method: type } : undefined
            );

            const newBalance = await CasinoCallbackService.getBalance(
              db,
              playerId
            );

            const convertedBalance = formatBalanceForCurrency(newBalance);

            console.log("------------ our response -------------------")
            console.log({ success: true, balance: convertedBalance, transaction_id });
            return { success: true, balance: convertedBalance, transaction_id };
          }

          case "refund": {
            if (!transaction_id || amount === undefined || !bet_transaction_id) {
              set.status = 400;
              console.log("------------ our response -------------------")
              console.log({
                success: false,
                error: "Missing transaction_id, amount, or bet_transaction_id",
              });
              return {
                success: false,
                error: "Missing transaction_id, amount, or bet_transaction_id",
              };
            }

            const amountValue = parseAmount(amount);
            if (Number.isNaN(amountValue) || amountValue < 0) {
              set.status = 400;
              console.log("------------ our response -------------------")
              console.log({ success: false, error: "Invalid amount" });
              return { success: false, error: "Invalid amount" };
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
              const convertedBalance = formatBalanceForCurrency(balance);
              console.log("------------ our response -------------------")
              console.log({
                success: true,
                balance: convertedBalance,
                transaction_id,
              });
              return {
                success: true,
                balance: convertedBalance,
                transaction_id,
              };
            }

            const existingRefundForBet =
              await CasinoCallbackService.getTransactionByTxnHash(
                db,
                bet_transaction_id
              );
            if (existingRefundForBet) {
              const balance = await CasinoCallbackService.getBalance(
                db,
                playerId
              );
              const convertedBalance = formatBalanceForCurrency(balance);
              console.log("------------ our response -------------------")
              console.log({
                success: true,
                balance: convertedBalance,
                transaction_id: existingRefundForBet.reference,
              });
              return {
                success: true,
                balance: convertedBalance,
                transaction_id: existingRefundForBet.reference,
              };
            }

            const betTxn = await CasinoCallbackService.getTransaction(
              db,
              bet_transaction_id
            );
            if (betTxn && betTxn.userId !== playerId) {
              set.status = 400;
              console.log("------------ our response -------------------")
              console.log({
                success: false,
                error: "Bet transaction does not belong to player",
              });
              return {
                success: false,
                error: "Bet transaction does not belong to player",
              };
            }

            const balanceBefore = await CasinoCallbackService.getBalance(db, playerId);
            if (balanceBefore === null) {
              set.status = 404;
              console.log("------------ our response -------------------")
              console.log({ success: false, error: "Player not found" });
              return { success: false, error: "Player not found" };
            }

            const amountInINR = convertAmountToINR(amountValue);

            await CasinoCallbackService.addBalance(db, playerId, amountInINR);
            await CasinoCallbackService.saveTransaction(
              db,
              playerId,
              transaction_id,
              "refund",
              amountInINR,
              "completed",
              currency,
              {
                txnHash: bet_transaction_id,
                ...(type ? { method: type } : {}),
              }
            );

            if (betTxn) {
              await CasinoCallbackService.updateTransactionStatus(
                db,
                bet_transaction_id,
                "refunded"
              );
            }

            const newBalance = await CasinoCallbackService.getBalance(
              db,
              playerId
            );

            const convertedBalance = formatBalanceForCurrency(newBalance);

            console.log("------------ our response -------------------")
            console.log({ success: true, balance: convertedBalance, transaction_id });
            return { success: true, balance: convertedBalance, transaction_id };
          }

          // case "rollback": {
          //   if (!rollback_transactions || rollback_transactions.length === 0) {
          //     set.status = 400;
          //     return { success: false, error: "Missing rollback_transactions" };
          //   }

          //   const balanceBefore = await CasinoCallbackService.getBalance(
          //     db,
          //     playerId
          //   );
          //   if (balanceBefore === null) {
          //     set.status = 404;
          //     return { success: false, error: "Player not found" };
          //   }

          //   let rolledBackCount = 0;
          //   let skippedCount = 0;
          //   let totalRefunded = 0;
          //   let totalDeducted = 0;

          //   for (const txnId of rollback_transactions) {
          //     const txn = await CasinoCallbackService.getTransaction(db, txnId);
          //     if (txn) {
          //       if (txn.type === "bet") {
          //         const refundAmount = Number(txn.amount);
          //         await CasinoCallbackService.addBalance(
          //           db,
          //           playerId,
          //           txn.amount
          //         );
          //         totalRefunded += refundAmount;
          //       } else if (txn.type === "win") {
          //         const deductAmount = Number(txn.amount);
          //         await CasinoCallbackService.deductBalance(
          //           db,
          //           playerId,
          //           txn.amount
          //         );
          //         totalDeducted += deductAmount;
          //       }

          //       await db
          //         .update(transactions)
          //         .set({ status: "rolled_back" })
          //         .where(eq(transactions.reference, txnId));

          //       rolledBackCount++;
          //     } else {
          //       skippedCount++;
          //     }
          //   }

          //   const balanceAfter = await CasinoCallbackService.getBalance(
          //     db,
          //     playerId
          //   );

          //   return { success: true, balance: balanceAfter };
          // }

          default:
            set.status = 400;
            console.log("------------ our response -------------------")
            console.log({ success: false, error: "Invalid action" });
            return { success: false, error: "Invalid action" };
        }
        console.log(".........................................................................................")
        console.log(".........................................................................................")
      } catch (error) {
        const duration = Date.now() - startTime;

        set.status = 500;
        console.error("------------ CALLBACK ERROR -------------");
        console.error(error);
        console.error("----------------------------------------");
        return {
          success: false,
          error: "Internal server error",
        };
      }
    },
    {
      body: t.Any(),
    }
  );
