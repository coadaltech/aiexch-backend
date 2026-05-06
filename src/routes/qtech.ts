import { Elysia, t } from "elysia";
import crypto from "crypto";

// QTech Games "Common Wallet" stub endpoints.
//
// Auth model (per QT Common Wallet API §2.1): simple shared-secret `Pass-Key`
// HTTP header — no signing, no HMAC. Constant-time compare so a wrong key
// can't be timing-attacked into being learned.
//
// Endpoint shape (per QT Common Wallet API §3): GET for session/balance,
// POST /transactions for both withdrawal (txnType=DEBIT) and deposit
// (txnType=CREDIT), POST /transactions/rollback for rollback. Promotion
// Status and Rewards live at the paths submitted on the QT handover form.
//
// Responses are hardcoded dummies; real DB-backed wallet logic replaces them
// once integration testing with QT passes.
const PASS_KEY = process.env.QTECH_PASSKEY || "";

function checkPassKey(headers: Record<string, string | string[] | undefined>): boolean {
  if (!PASS_KEY) return false;
  const raw = headers["pass-key"];
  const sent = Array.isArray(raw) ? raw[0] : raw;
  if (!sent || typeof sent !== "string") return false;
  try {
    const a = Buffer.from(sent);
    const b = Buffer.from(PASS_KEY);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

const loginFailed = { code: "LOGIN_FAILED", message: "The given pass-key is incorrect." };

export const qtechRoutes = new Elysia({ prefix: "/qtech/v1" })
  .onBeforeHandle(({ headers, set }) => {
    if (!checkPassKey(headers)) {
      set.status = 401;
      return loginFailed;
    }
  })
  // §3.1 Verify Session — GET /accounts/{playerId}/session?gameId=…
  .get("/accounts/:playerId/session", ({ params }) => ({
    balance: 1000.0,
    currency: "INR",
    playerId: params.playerId,
  }))
  // §3.2 Get Balance — GET /accounts/{playerId}/balance?gameId=…
  .get("/accounts/:playerId/balance", () => ({
    balance: 1000.0,
    currency: "INR",
  }))
  // §3.3 Withdrawal (txnType=DEBIT) and §3.4 Deposit (txnType=CREDIT)
  // share POST /transactions; the body discriminates.
  .post(
    "/transactions",
    ({ body, set }) => {
      const txnType = (body as { txnType?: string })?.txnType;
      set.status = 201;
      if (txnType === "DEBIT") {
        return { balance: 950.0, referenceId: `ref_${Date.now()}` };
      }
      // CREDIT (deposit / win)
      return { balance: 1050.0, referenceId: `ref_${Date.now()}` };
    },
    { body: t.Any() },
  )
  // §3.5 Rollback — POST /transactions/rollback
  .post(
    "/transactions/rollback",
    () => ({ balance: 1000.0, referenceId: `ref_${Date.now()}` }),
    { body: t.Any() },
  )
  // §3.6 Promotion Status — informative callback, returns 204 No Content
  .post(
    "/promotion/status",
    () => new Response(null, { status: 204 }),
    { body: t.Any() },
  )
  // §3.7 Rewards — POST /rewards (operator-defined path on the handover form)
  .post(
    "/rewards",
    ({ set }) => {
      set.status = 201;
      return { balance: 1100.0, referenceId: `reward_${Date.now()}` };
    },
    { body: t.Any() },
  );
