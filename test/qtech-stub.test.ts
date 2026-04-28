// Smoke test for the QTech stub endpoints. Run against a live dev server:
//   bun run dev          # in one terminal
//   bun run test/qtech-stub.test.ts <baseUrl> <passKey>
// Defaults: http://localhost:3001 + QTECH_PASSKEY from env.
import crypto from "crypto";
import "dotenv/config";

const BASE = process.argv[2] || `http://localhost:${process.env.PORT || 3001}`;
const PASS_KEY = process.argv[3] || process.env.QTECH_PASSKEY || "";

if (!PASS_KEY) {
  console.error("QTECH_PASSKEY missing. Set it in .env or pass as 2nd arg.");
  process.exit(1);
}

const ENDPOINTS = [
  "/qtech/v1/balance",
  "/qtech/v1/debit",
  "/qtech/v1/credit",
  "/qtech/v1/rollback",
  "/qtech/v1/promotion/status",
  "/qtech/v1/rewards",
];

function sign(payload: object, key: string): string {
  return crypto.createHmac("sha256", key).update(JSON.stringify(payload)).digest("hex");
}

async function post(path: string, body: object, headers: Record<string, string> = {}) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  let json: any = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
}

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}`, detail ?? "");
  }
}

async function run() {
  console.log(`Base: ${BASE}`);
  console.log(`PassKey: ${PASS_KEY.slice(0, 4)}…${PASS_KEY.slice(-4)} (len=${PASS_KEY.length})`);

  console.log("\n[1] Valid signature in body — expect 200 OK");
  for (const path of ENDPOINTS) {
    const payload: Record<string, unknown> = { playerId: "test_player", currency: "INR", nonce: crypto.randomUUID() };
    const signed = { ...payload, signature: sign(payload, PASS_KEY) };
    const r = await post(path, signed);
    check(`${path} 200`, r.status === 200 && r.body?.status === "OK", r);
  }

  console.log("\n[2] Valid signature in X-Signature header — expect 200 OK");
  {
    const payload = { playerId: "test_player", currency: "INR" };
    const r = await post("/qtech/v1/balance", payload, { "X-Signature": sign(payload, PASS_KEY) });
    check("X-Signature header path", r.status === 200 && r.body?.status === "OK", r);
  }

  console.log("\n[3] Missing signature — expect 401 MISSING_SIGNATURE");
  {
    const r = await post("/qtech/v1/balance", { playerId: "test_player" });
    check("missing signature", r.status === 401 && r.body?.code === "MISSING_SIGNATURE", r);
  }

  console.log("\n[4] Wrong signature — expect 401 INVALID_SIGNATURE");
  {
    const payload = { playerId: "test_player" };
    const r = await post("/qtech/v1/balance", { ...payload, signature: "deadbeef".repeat(8) });
    check("wrong signature", r.status === 401 && r.body?.code === "INVALID_SIGNATURE", r);
  }

  console.log("\n[5] Tampered body (correct sig for different payload) — expect 401");
  {
    const original = { playerId: "test_player", amount: 100 };
    const tampered = { ...original, amount: 9999, signature: sign(original, PASS_KEY) };
    const r = await post("/qtech/v1/debit", tampered);
    check("tampered body", r.status === 401 && r.body?.code === "INVALID_SIGNATURE", r);
  }

  console.log("\n[6] Garbage signature (non-hex) — expect 401");
  {
    const r = await post("/qtech/v1/balance", { playerId: "test_player", signature: "not-a-hex-string" });
    check("non-hex signature", r.status === 401 && r.body?.code === "INVALID_SIGNATURE", r);
  }

  console.log(`\nResult: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
