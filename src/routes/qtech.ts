import { Elysia, t } from "elysia";
import crypto from "crypto";

// QTech Games "Common Wallet" stub endpoints.
//
// Mounted twice on the same backend so QT can hit distinct URLs for
// staging vs production while we run a single EC2:
//   /qtech/v1/*          — production, gated by QTECH_PASSKEY_PRODUCTION
//   /qtech-staging/v1/*  — staging,    gated by QTECH_PASSKEY_STAGING
//
// Auth model (per QT Common Wallet API §2.1): a shared-secret `Pass-Key`
// HTTP header — no signing, no HMAC. Constant-time compare.
//
// Endpoint shape (per §3): GET for session/balance, POST /transactions for
// both withdrawal (txnType=DEBIT) and deposit (txnType=CREDIT), separate
// /transactions/rollback. Promotion Status and Rewards live at the paths
// submitted on the QT handover form.
//
// Responses are hardcoded dummies; real DB-backed wallet logic replaces them
// once integration testing with QT passes.

function checkPassKey(
  headers: Record<string, string | string[] | undefined>,
  passKey: string,
): boolean {
  if (!passKey) return false;
  const raw = headers["pass-key"];
  const sent = Array.isArray(raw) ? raw[0] : raw;
  if (!sent || typeof sent !== "string") return false;
  try {
    const a = Buffer.from(sent);
    const b = Buffer.from(passKey);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

const loginFailed = { code: "LOGIN_FAILED", message: "The given pass-key is incorrect." };

function buildQtechPlugin(name: string, prefix: string, passKey: string) {
  return new Elysia({ name: `qtech-${name}`, prefix })
    .onBeforeHandle(({ headers, set }) => {
      if (!checkPassKey(headers, passKey)) {
        set.status = 401;
        return loginFailed;
      }
    })
    // §3.1 Verify Session — GET /accounts/{playerId}/session?gameId=…
    .get("/accounts/:playerId/session", ({ params }) => ({
      balance: 1000.0,
      currency: "SLRs",
      playerId: params.playerId,
    }))
    // §3.2 Get Balance — GET /accounts/{playerId}/balance?gameId=…
    .get("/accounts/:playerId/balance", () => ({
      balance: 1000.0,
      currency: "SLRs",
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
}

export const qtechRoutes = new Elysia()
  .use(buildQtechPlugin("prod", "/qtech/v1", process.env.QTECH_PASSKEY_PRODUCTION || ""))
  .use(buildQtechPlugin("staging", "/qtech-staging/v1", process.env.QTECH_PASSKEY_STAGING || ""));
