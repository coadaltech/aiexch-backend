import { Elysia, t } from "elysia";
import crypto from "crypto";

// Stub QTech Games seamless wallet endpoints for the integration handover form.
// Real DB / wallet logic will replace the dummy responses once QTech shares their API spec.
//
// Signing (provisional — adjust when QTech doc arrives):
//   - Algo: HMAC-SHA256(rawJsonBodyWithoutSignatureField, QTECH_PASSKEY) hex-encoded
//   - Sent in JSON `signature` field OR `X-Signature` header
//   - Constant-time compare via crypto.timingSafeEqual
const PASS_KEY = process.env.QTECH_PASSKEY || "";

type VerifyResult = "ok" | "missing" | "invalid";

function verifySignature(body: any, headerSig?: string | string[]): VerifyResult {
  if (!PASS_KEY) return "invalid";

  const sentRaw =
    (body && typeof body === "object" && body.signature) ||
    (Array.isArray(headerSig) ? headerSig[0] : headerSig);

  if (!sentRaw || typeof sentRaw !== "string") return "missing";

  const bodyForSig = { ...(body || {}) };
  delete bodyForSig.signature;
  const payload = JSON.stringify(bodyForSig);

  const expected = crypto
    .createHmac("sha256", PASS_KEY)
    .update(payload)
    .digest("hex");

  try {
    const a = Buffer.from(sentRaw, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length) return "invalid";
    return crypto.timingSafeEqual(a, b) ? "ok" : "invalid";
  } catch {
    return "invalid";
  }
}

export const qtechRoutes = new Elysia({ prefix: "/qtech/v1" })
  .onBeforeHandle(({ body, headers, set }) => {
    const headerSig = headers["x-signature"];
    const result = verifySignature(body, headerSig);
    if (result === "missing") {
      set.status = 401;
      return { status: "ERROR", code: "MISSING_SIGNATURE" };
    }
    if (result === "invalid") {
      set.status = 401;
      return { status: "ERROR", code: "INVALID_SIGNATURE" };
    }
  })
  .post(
    "/balance",
    () => ({
      status: "OK",
      balance: 1000.0,
      currency: "INR",
      playerId: "test_player",
    }),
    { body: t.Any() },
  )
  .post(
    "/debit",
    () => ({
      status: "OK",
      balance: 950.0,
      transactionId: "txn_dummy_001",
      currency: "INR",
    }),
    { body: t.Any() },
  )
  .post(
    "/credit",
    () => ({
      status: "OK",
      balance: 1050.0,
      transactionId: "txn_dummy_002",
      currency: "INR",
    }),
    { body: t.Any() },
  )
  .post(
    "/rollback",
    () => ({
      status: "OK",
      balance: 1000.0,
      transactionId: "txn_dummy_003",
      currency: "INR",
    }),
    { body: t.Any() },
  )
  .post(
    "/promotion/status",
    () => ({
      status: "OK",
      eligible: false,
      bonusBalance: 0,
      currency: "INR",
    }),
    { body: t.Any() },
  )
  .post(
    "/rewards",
    () => ({
      status: "OK",
      balance: 1100.0,
      transactionId: "reward_dummy_001",
    }),
    { body: t.Any() },
  );
