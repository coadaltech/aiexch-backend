// Smoke test for the QTech Common Wallet stub.
//   bun run dev          # in one terminal
//   bun run test/qtech-stub.test.ts <baseUrl> <passKey>
// Defaults: http://localhost:3001 + QTECH_PASSKEY from env.
import "dotenv/config";
declare const process: { argv: string[]; env: Record<string, string | undefined>; exit: (code: number) => never };

const BASE = process.argv[2] || `http://localhost:${process.env.PORT || 3001}`;
const PASS_KEY = process.argv[3] || process.env.QTECH_PASSKEY || "";

if (!PASS_KEY) {
  console.error("QTECH_PASSKEY missing. Set it in .env or pass as 2nd arg.");
  process.exit(1);
}

async function call(method: string, path: string, body?: object, key?: string | null) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (key !== null) headers["Pass-Key"] = key ?? PASS_KEY;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: unknown = null;
  const text = await res.text();
  if (text) {
    try { json = JSON.parse(text); } catch { json = text; }
  }
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

const debitBody = {
  txnType: "DEBIT",
  txnId: `txn_${Date.now()}`,
  playerId: "test_player",
  roundId: "round_1",
  amount: 50.0,
  currency: "INR",
  gameId: "TK-froggrog",
  device: "MOBILE",
  clientType: "HTML5",
  created: new Date().toISOString(),
  completed: "false",
};

const creditBody = {
  txnType: "CREDIT",
  txnId: `txn_${Date.now() + 1}`,
  betId: debitBody.txnId,
  playerId: "test_player",
  roundId: "round_1",
  amount: 100.0,
  currency: "INR",
  gameId: "TK-froggrog",
  device: "MOBILE",
  clientType: "HTML5",
  created: new Date().toISOString(),
  completed: "true",
};

const rollbackBody = {
  betId: debitBody.txnId,
  txnId: `txn_${Date.now() + 2}`,
  playerId: "test_player",
  roundId: "round_1",
  amount: 50.0,
  currency: "INR",
  gameId: "TK-froggrog",
  created: new Date().toISOString(),
  completed: "true",
};

const promoBody = {
  bonusId: "bonus-1",
  playerId: "test_player",
  gameIds: ["TK-froggrog"],
  totalBetValue: 100.0,
  roundOptions: [1, 2, 4],
  currency: "INR",
  promoCode: "TEST",
  status: "PROMOTED",
  validityDays: 7,
  promotedDateTime: new Date().toISOString(),
};

const rewardBody = {
  rewardType: "TOURNAMENT_REWARD",
  rewardTitle: "Test Tournament",
  txnId: `reward_${Date.now()}`,
  playerId: "test_player",
  amount: 500.0,
  currency: "INR",
  created: new Date().toISOString(),
};

async function run() {
  console.log(`Base: ${BASE}`);
  console.log(`PassKey: ${PASS_KEY.slice(0, 4)}…${PASS_KEY.slice(-4)} (len=${PASS_KEY.length})`);

  console.log("\n[1] Verify Session — GET /accounts/{playerId}/session");
  {
    const r = await call("GET", "/qtech/v1/accounts/test_player/session?gameId=TK-froggrog");
    check("200 with balance+currency", r.status === 200 && (r.body as any)?.currency === "INR", r);
  }

  console.log("\n[2] Get Balance — GET /accounts/{playerId}/balance");
  {
    const r = await call("GET", "/qtech/v1/accounts/test_player/balance?gameId=TK-froggrog");
    check("200 with balance+currency", r.status === 200 && (r.body as any)?.currency === "INR", r);
  }

  console.log("\n[3] Withdrawal (DEBIT) — POST /transactions");
  {
    const r = await call("POST", "/qtech/v1/transactions", debitBody);
    check("201 with balance+referenceId", r.status === 201 && !!(r.body as any)?.referenceId, r);
  }

  console.log("\n[4] Deposit (CREDIT) — POST /transactions");
  {
    const r = await call("POST", "/qtech/v1/transactions", creditBody);
    check("201 with balance+referenceId", r.status === 201 && !!(r.body as any)?.referenceId, r);
  }

  console.log("\n[5] Rollback — POST /transactions/rollback");
  {
    const r = await call("POST", "/qtech/v1/transactions/rollback", rollbackBody);
    check("200 with balance+referenceId", r.status === 200 && !!(r.body as any)?.referenceId, r);
  }

  console.log("\n[6] Promotion Status — POST /promotion/status");
  {
    const r = await call("POST", "/qtech/v1/promotion/status", promoBody);
    check("204 No Content", r.status === 204, r);
  }

  console.log("\n[7] Rewards — POST /rewards");
  {
    const r = await call("POST", "/qtech/v1/rewards", rewardBody);
    check("201 with balance+referenceId", r.status === 201 && !!(r.body as any)?.referenceId, r);
  }

  console.log("\n[8] Missing Pass-Key — expect 401 LOGIN_FAILED");
  {
    const r = await call("GET", "/qtech/v1/accounts/test_player/balance", undefined, null);
    check("missing key", r.status === 401 && (r.body as any)?.code === "LOGIN_FAILED", r);
  }

  console.log("\n[9] Wrong Pass-Key — expect 401 LOGIN_FAILED");
  {
    const r = await call("GET", "/qtech/v1/accounts/test_player/balance", undefined, "wrong-key");
    check("wrong key", r.status === 401 && (r.body as any)?.code === "LOGIN_FAILED", r);
  }

  console.log(`\nResult: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
