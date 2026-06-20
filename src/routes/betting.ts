import { Elysia } from "elysia";
import { db } from "../db";
import { transactions, transactionDetails, transactionLogs, users, profiles, ledgerLimit, transactionCommissions, marketSettings, customMarketOdds, marketResults } from "../db/schema";
// Note: profiles is still imported for betStatus/parentBetStatus checks
import { parseUserAgent } from "../utils/parse-ua";
import { eq, and, sql } from "drizzle-orm";
import { addResultToQueue } from "../queues/betting";
import { app_middleware } from "../middleware/auth";
import { redis } from "../db/redis";
import { parseBetType, UserRole, MarketType, parseMarketType } from "../types/enums";
import { SportsService } from "../services/sports";

// Bound the upstream odds re-fetch so a slow provider can't stall bet placement.
const FRESH_ODDS_TIMEOUT_MS = 1500;

// Mirror the client's toDecimalOdds / toDecimalfancyOdds so we compare against
// the exact same number the user saw on screen.
function rawPriceToDecimalOdds(
  raw: number,
  provider: string | undefined,
  marketType: string | undefined,
  isFancy: boolean,
): number {
  const isBetfair = provider?.toUpperCase() === "BETFAIR";
  if (isFancy) {
    if (isBetfair && raw < 10) return raw;
    return raw / 100;
  }
  if (isBetfair) return raw;
  if (marketType?.toUpperCase() === "WINNING_ODDS") return raw;
  return raw / 100;
}

const PRICE_CHANGED_MESSAGE =
  "Bet rejected: prices changed, please place the bet again or refresh the page";

// Custom markets created from the owner panel use a "9.<eventId><timestamp>"
// marketId, while Betfair markets start with "1.". We detect by prefix so the
// verifier can use our own DB as the odds source instead of the external books
// API (which has no record of custom markets and would reject every bet).
const CUSTOM_MARKET_PREFIX = "9.";
const isCustomMarketId = (marketId: string) => marketId.startsWith(CUSTOM_MARKET_PREFIX);

// Build the same shape SportsService.getOdds returns for an external market,
// from our local custom_market_odds + market_settings rows. Returning the same
// envelope means the rest of verifyOddsUnchanged (status check, slot lookup,
// line/price compare) works without any custom-market-specific branching.
async function getCustomMarketSnapshot(marketId: string): Promise<Record<string, unknown> | null> {
  const [setting] = await db
    .select({
      isCustom: marketSettings.isCustom,
      isActive: marketSettings.isActive,
      suspended: marketSettings.suspended,
      betLock: marketSettings.betLock,
    })
    .from(marketSettings)
    .where(eq(marketSettings.marketId, marketId))
    .limit(1);

  // Prefix matched but no row (or not actually a custom market) — bail so the
  // caller treats it as an unverifiable bet and rejects, rather than silently
  // allowing through.
  if (!setting || !setting.isCustom) return null;

  const oddsRows = await db
    .select({
      selectionId: customMarketOdds.selectionId,
      backPrices: customMarketOdds.backPrices,
      layPrices: customMarketOdds.layPrices,
      line: customMarketOdds.line,
    })
    .from(customMarketOdds)
    .where(eq(customMarketOdds.marketId, marketId));

  const status = setting.suspended
    ? "SUSPENDED"
    : (setting.betLock || !setting.isActive)
      ? "CLOSED"
      : "OPEN";

  return {
    [marketId]: {
      status,
      sportingEvent: false,
      runners: oddsRows.map((r) => {
        // For custom LINE markets, propagate the per-runner line onto each
        // slot so the existing fancy line check (slot.line vs clientRun) works
        // unchanged. Non-LINE markets leave it off.
        const lineNum = r.line != null ? Number(r.line) : null;
        const decorate = (slot: { price: number; size: number }) =>
          lineNum != null && Number.isFinite(lineNum)
            ? { ...slot, line: lineNum }
            : slot;
        return {
          selectionId: r.selectionId,
          status: "ACTIVE",
          back: (r.backPrices ?? []).map(decorate),
          lay: (r.layPrices ?? []).map(decorate),
        };
      }),
    },
  };
}

// Verify the user's submitted odds still match upstream at the exact slot they
// clicked. Hits /sports/books/{marketId}. Returns:
//   { ok: true, effectiveOdds? } → proceed; if effectiveOdds is set, place the
//                                  bet at that value instead of clientOdds
//   { ok: false, reason }        → reject the bet (price moved / suspended / no data)
//
// Provider timeout is the only non-rejection escape hatch — a slow upstream
// must not silently block legitimate placements. Every other "we couldn't
// confirm the price" outcome is treated as a price change and rejected, so a
// stale-snapshot client can't lock in an old price.
async function verifyOddsUnchanged(args: {
  marketId: string;
  selectionId: number;
  isLay: boolean;
  priceIndex: number;
  clientOdds: number;
  clientRun: number | null | undefined;
  provider: string | undefined;
  marketType: string | undefined;
  isFancy: boolean;
  timeoutMs: number;
}): Promise<{ ok: true; effectiveOdds?: number } | { ok: false; reason: string }> {
  const isCustom = isCustomMarketId(String(args.marketId));

  const timeoutPromise = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), args.timeoutMs),
  );

  const fetchPromise = (async () => {
    try {
      // Custom markets aren't in the upstream books feed — read from our own
      // DB instead. Falls back through the same shape so the rest of the
      // verification logic doesn't need to change.
      if (isCustom) {
        return await getCustomMarketSnapshot(String(args.marketId));
      }
      return await SportsService.getOdds({ marketId: String(args.marketId) });
    } catch (e) {
      console.warn(`[verifyOdds] odds fetch threw for ${args.marketId}:`, e);
      return null;
    }
  })();

  const oddsObj = await Promise.race([fetchPromise, timeoutPromise]);

  if (!oddsObj) {
    if (isCustom) {
      // Local DB lookup is fast and definitive — null means the custom market
      // isn't in our DB. Don't fall back to the external API (it'll never
      // have it), and don't allow the bet through (we genuinely can't verify).
      console.warn(`[verifyOdds] custom market not found in DB: ${args.marketId}`);
      return { ok: false, reason: PRICE_CHANGED_MESSAGE };
    }
    // Provider timed out or errored — can't verify, allow through to avoid
    // blanket-blocking placements during transient upstream issues.
    console.warn(`[verifyOdds] timeout/null for marketId=${args.marketId}, allowing through`);
    return { ok: true };
  }

  const market = (oddsObj as any)?.[String(args.marketId)];
  if (!market) {
    console.warn(
      `[verifyOdds] no market in books response for marketId=${args.marketId} ` +
        `(isFancy=${args.isFancy}). Response keys=${Object.keys(oddsObj as any).join(",")}`,
    );
    return { ok: false, reason: PRICE_CHANGED_MESSAGE };
  }

  const mStatus = (market.status || "").toUpperCase();
  if (mStatus === "SUSPENDED") return { ok: false, reason: "Bet rejected: market is suspended" };
  if (mStatus === "CLOSED" || mStatus === "INACTIVE")
    return { ok: false, reason: "Bet rejected: market is closed" };
  if (market.sportingEvent) return { ok: false, reason: "Bet rejected: ball is running" };

  const runner = market.runners?.find(
    (r: any) => String(r.selectionId) === String(args.selectionId),
  );
  if (!runner) {
    console.warn(
      `[verifyOdds] runner not found marketId=${args.marketId} selectionId=${args.selectionId}. ` +
        `Available runners: ${(market.runners || []).map((r: any) => r.selectionId).join(",")}`,
    );
    return { ok: false, reason: PRICE_CHANGED_MESSAGE };
  }

  const rStatus = (runner.status || "").toUpperCase();
  if (rStatus === "SUSPENDED") return { ok: false, reason: "Bet rejected: runner is suspended" };
  if (rStatus === "REMOVED") return { ok: false, reason: "Bet rejected: runner is removed" };

  const side = args.isLay ? runner.lay : runner.back;
  const slot = Array.isArray(side) ? side[args.priceIndex] : null;
  // The books feed can return either [price,size] tuples or {price,size}
  // objects. For fancy on Betfair, slots typically also carry a `line` field
  // separate from the rate `price` — see the line-check below.
  const rawPrice = Array.isArray(slot) ? slot[0] : slot?.price;
  const rawNum = Number(rawPrice);

  if (!Number.isFinite(rawNum) || rawNum <= 0) {
    console.warn(
      `[verifyOdds] empty slot for marketId=${args.marketId} sel=${args.selectionId} ` +
        `side=${args.isLay ? "lay" : "back"} idx=${args.priceIndex}. side=${JSON.stringify(side)}`,
    );
    return { ok: false, reason: PRICE_CHANGED_MESSAGE };
  }

  // Fancy line check.
  //
  // For fancy markets the LINE is the meaningful value the user is betting
  // on (e.g. "session > 65"). The slot's `price` field is sometimes the line
  // itself (legacy/session feed where price === line) and sometimes the
  // payout rate (Betfair fancy where price is e.g. 1.95 and line is 65 — a
  // separate `line` field). If we only compare the rate, a moving line at
  // unchanged rate sneaks past verification and a stale-line bet gets stored.
  //
  // Strategy: if the slot exposes a distinct `line` field, compare that
  // against clientRun. Otherwise fall back to the price-as-line interpretation
  // (covered by the rate compare below, since price === line in that case).
  if (args.isFancy && args.clientRun != null && !Array.isArray(slot)) {
    const rawLine = (slot as any)?.line;
    const lineNum = Number(rawLine);
    if (Number.isFinite(lineNum) && lineNum > 0 && Math.round(lineNum) !== Math.round(args.clientRun)) {
      console.info(
        `[verifyOdds] fancy line moved marketId=${args.marketId} sel=${args.selectionId} ` +
          `clientRun=${args.clientRun} freshLine=${lineNum} → reject`,
      );
      return { ok: false, reason: PRICE_CHANGED_MESSAGE };
    }
  }

  const freshDecimal = rawPriceToDecimalOdds(rawNum, args.provider, args.marketType, args.isFancy);

  // Fancy: tight 0.001 tolerance — fancy lines are integers, the rate either
  // matches or it doesn't. The line check above is the meaningful guard.
  if (args.isFancy) {
    if (Math.abs(freshDecimal - args.clientOdds) > 0.001) {
      console.info(
        `[verifyOdds] fancy price moved marketId=${args.marketId} sel=${args.selectionId} ` +
          `clientOdds=${args.clientOdds} freshDecimal=${freshDecimal} (raw=${rawNum}) → reject`,
      );
      return { ok: false, reason: PRICE_CHANGED_MESSAGE };
    }
    return { ok: true };
  }

  // Non-fancy (match-odds, bookmaker, winning-odds): tolerate small favorable
  // moves and snap-adjust on big favorable moves. All comparisons are in
  // integer "points" where 1 point = 0.01 of the (decimal/profit-ratio) odds.
  //
  //   Back  (user benefits when odds rise)
  //     fresh < clicked                   → reject (price went against user)
  //     0 ≤ fresh − clicked ≤ +3 pts      → accept at fresh (user gets the
  //                                         better upstream odds)
  //     +3 < fresh − clicked < +10 pts    → reject
  //     fresh − clicked ≥ +10 pts         → accept at clicked + 5 pts (cap the
  //                                         improvement to discourage chasing
  //                                         large swings)
  //   Lay (mirror): user benefits when odds drop, same thresholds in the
  //   opposite direction; large drops snap to clicked − 5 pts.
  const diffPoints = Math.round((freshDecimal - args.clientOdds) * 100);
  const favorablePoints = args.isLay ? -diffPoints : diffPoints;

  if (favorablePoints < 0) {
    console.info(
      `[verifyOdds] price moved against user marketId=${args.marketId} sel=${args.selectionId} ` +
        `side=${args.isLay ? "lay" : "back"} clientOdds=${args.clientOdds} freshDecimal=${freshDecimal} ` +
        `diffPts=${diffPoints} → reject`,
    );
    return { ok: false, reason: PRICE_CHANGED_MESSAGE };
  }

  if (favorablePoints <= 3) {
    // Within tolerance — fill at the fresh upstream odds (user-favorable).
    return { ok: true, effectiveOdds: freshDecimal };
  }

  if (favorablePoints < 10) {
    console.info(
      `[verifyOdds] price moved ${diffPoints}pts (over 3pt tolerance, under 10pt snap) ` +
        `marketId=${args.marketId} sel=${args.selectionId} side=${args.isLay ? "lay" : "back"} ` +
        `clientOdds=${args.clientOdds} freshDecimal=${freshDecimal} → reject`,
    );
    return { ok: false, reason: PRICE_CHANGED_MESSAGE };
  }

  // Large favorable swing (≥10 pts): cap the improvement at 5 pts so the user
  // gets a small benefit without harvesting the full upstream movement.
  const adjustment = args.isLay ? -0.05 : 0.05;
  const effectiveOdds = Math.round((args.clientOdds + adjustment) * 100) / 100;
  console.info(
    `[verifyOdds] snap-adjust ${diffPoints}pts marketId=${args.marketId} sel=${args.selectionId} ` +
      `side=${args.isLay ? "lay" : "back"} clientOdds=${args.clientOdds} freshDecimal=${freshDecimal} ` +
      `→ effectiveOdds=${effectiveOdds}`,
  );
  return { ok: true, effectiveOdds };
}

// IMPORTANT: per-request user context lives on `resolve` (returns a fresh
// object per request), NOT on `.state()`. `.state()` is a single shared
// object created at app startup; mutating it from `beforeHandle` leaks
// userId between concurrent requests because the handler awaits between
// the guard write and the DB insert. Concrete failure mode: User A's bet
// gets stored under User B's userId when their requests overlap.
//
// `resolve` supports returning `status(code, body)` to halt with an auth
// failure response, replacing the old guard.beforeHandle halt.
export const bettingRoutes = new Elysia({ prefix: "/betting" })
  .resolve(async ({ cookie, headers, status }) => {
    const state_result = await app_middleware({ cookie, headers });
    if (!state_result.data) {
      return status(state_result.code as 401 | 403 | 404 | 500, state_result);
    }
    return {
      userId: state_result.data.id,
      userRole: state_result.data.role,
    };

  })

  // Place a bet
  .post("/place", async ({ body, userId, set, request }) => {
    try {
      const {
        matchId,
        marketId,
        selectionId,
        selectionName,
        marketName,
        marketType,
        bettingType,
        eventTypeId,
        competitionId,
        odds,
        stake,
        run,
        type,
        runners,
        provider,
        priceIndex,
        isCashout,
      } = body as {
        matchId: string | number;
        marketId: string | number;
        selectionId: string | number;
        selectionName?: string;
        marketName?: string;
        marketType?: string;
        bettingType?: string;
        eventTypeId?: string | number;
        competitionId?: string | number | null;
        odds: number;
        stake: number;
        run?: number | null;
        type: "back" | "lay";
        runners: { id: string | number; name: string; price: number }[];
        provider?: string;
        priceIndex?: number;
        isCashout?: boolean;
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

      const canonicalMarketId = String(marketId);

      const marketTypeInt = parseMarketType(bettingType || marketType, marketType);
      const isFancyBet = marketTypeInt === MarketType.Fancy;
      if (!runners || runners.length < (isFancyBet ? 1 : 2)) {
        set.status = 400;
        return {
          success: false,
          error: isFancyBet ? "Runner is required" : "At least two runners are required",
        };
      }

      // ── STEP 0: Run independent checks in parallel ──
      // These 3 DB queries + 1 Redis check are independent — run them concurrently
      const ipAddress =
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        request.headers.get("x-real-ip") ||
        null;
      const ua = parseUserAgent(request.headers.get("user-agent"));

      // Fire all independent queries in parallel
      const [userData, userRecord, [ledger], marketStatusResult, settledResult] = await Promise.all([
        // 1. User profile (betStatus check)
        db.select({
          betStatus: profiles.betStatus,
          parentBetStatus: profiles.parentBetStatus,
        }).from(profiles).where(eq(profiles.userId, userId)).limit(1),

        // 2. User whitelabelId
        db.select({ whitelabelId: users.whitelabelId })
          .from(users).where(eq(users.id, userId)).limit(1),

        // 3. Ledger limits
        db.select({
          userLimit: ledgerLimit.userLimit,
          finalLimit: ledgerLimit.finalLimit,
          transactionLimit: ledgerLimit.transactionLimit,
        })
          .from(ledgerLimit).where(eq(ledgerLimit.userId, userId)).limit(1),

        // 4. Redis market status check (non-blocking)
        (async () => {
          let resolvedMinBet = 0;
          let resolvedMaxBet = 0;
          try {
            if (redis.isReady) {
              const liveJson = await redis.get(`live:markets:${matchId}`);
              if (liveJson) {
                const liveMarkets: any[] = JSON.parse(liveJson);
                const targetMarket = liveMarkets.find((m: any) => m.marketId === marketId);
                if (targetMarket) {
                  if (targetMarket.status === "CLOSED" || targetMarket.status === "INACTIVE") {
                    return { rejected: true, error: "Bet rejected: market is closed" };
                  }
                  if (targetMarket.status === "SUSPENDED") {
                    return { rejected: true, error: "Bet rejected: market is suspended" };
                  }
                  if (targetMarket.sportingEvent) {
                    return { rejected: true, error: "Bet rejected: ball is running" };
                  }
                  if (targetMarket.marketCondition?.betLock) {
                    return { rejected: true, error: "Bet rejected: market is locked" };
                  }
                  if (targetMarket.marketCondition?.minBet) {
                    resolvedMinBet = parseFloat(targetMarket.marketCondition.minBet) || 0;
                  }
                  if (targetMarket.marketCondition?.maxBet) {
                    resolvedMaxBet = parseFloat(targetMarket.marketCondition.maxBet) || 0;
                  }
                }
              }
            }
          } catch {
            // Non-critical: if Redis check fails, allow the bet through
          }
          return { rejected: false, resolvedMinBet, resolvedMaxBet };
        })(),

        // 5. Settlement guard — has this market already been resulted?
        //    Authoritative and local: a declared/void/rollback market must
        //    never accept a bet, even if the live odds feed or Redis still
        //    report it as active, and even on the verifyOdds timeout-allow path.
        db
          .select({ status: marketResults.status })
          .from(marketResults)
          .where(eq(marketResults.marketId, canonicalMarketId))
          .limit(1),
      ]);

      if (!userData[0]) {
        set.status = 404;
        return { success: false, error: "User not found" };
      }

      const canBet = (userData[0].betStatus ?? true) && (userData[0].parentBetStatus ?? true);
      if (!canBet) {
        set.status = 403;
        return { success: false, error: "Betting is disabled for your account" };
      }

      // Check market status result from Redis
      if (marketStatusResult.rejected) {
        set.status = 400;
        return { success: false, error: (marketStatusResult as any).error };
      }

      // Hard settlement guard: once a market is declared/voided/rolled back it
      // can never accept another bet, regardless of what the live feed says.
      // PENDING is a not-yet-resulted placeholder, so it is still bettable.
      const settledStatus = settledResult[0]?.status?.toUpperCase();
      if (settledStatus && settledStatus !== "PENDING") {
        set.status = 400;
        return { success: false, error: "Bet rejected: market result already declared" };
      }

      let { resolvedMinBet = 0, resolvedMaxBet = 0 } = marketStatusResult as { rejected: false; resolvedMinBet: number; resolvedMaxBet: number };

      // Fallback: fetch min/max from market_settings DB when Redis didn't provide them
      if (resolvedMinBet === 0 && resolvedMaxBet === 0) {
        try {
          const [mktSetting] = await db
            .select({ minBet: marketSettings.minBet, maxBet: marketSettings.maxBet })
            .from(marketSettings)
            .where(eq(marketSettings.marketId, canonicalMarketId))
            .limit(1);
          if (mktSetting) {
            resolvedMinBet = parseFloat(mktSetting.minBet ?? "0") || 0;
            resolvedMaxBet = parseFloat(mktSetting.maxBet ?? "0") || 0;
          }
        } catch {
          // Non-critical: DB lookup failed, skip min/max enforcement
        }
      }

      // Enforce min/max bet limits.
      // Impossible range first: a positive minimum that exceeds the maximum means
      // no stake can ever be valid (e.g. min=1, max=0). Here max=0 is a hard zero,
      // NOT the "no upper limit" sentinel — that meaning only applies when there is
      // no minimum (min=0). Without this guard the maxBet check below is skipped
      // for max=0 and the bet slips through despite the market being un-bettable.
      if (resolvedMinBet > 0 && resolvedMinBet > resolvedMaxBet) {
        set.status = 400;
        return { success: false, error: `Bet rejected: betting is not available on this market` };
      }
      if (resolvedMinBet > 0 && stake < resolvedMinBet) {
        set.status = 400;
        return { success: false, error: `Bet rejected: minimum bet is ${resolvedMinBet}` };
      }
      if (resolvedMaxBet > 0 && stake > resolvedMaxBet) {
        set.status = 400;
        return { success: false, error: `Bet rejected: maximum bet is ${resolvedMaxBet}` };
      }

      // Per-user single-bet cap (transactionLimit). 0 means "no cap".
      // We take the more restrictive of (market maxBet, user transactionLimit),
      // so if the user is capped at 10k and the market allows 10L, only 10k
      // goes through per individual bet.
      const txLimitNum = parseFloat(ledger?.transactionLimit ?? "0");
      if (txLimitNum > 0 && stake > txLimitNum) {
        set.status = 400;
        return { success: false, error: `Bet rejected: per-bet limit is ${txLimitNum}` };
      }

      const whitelabelId = userRecord[0]?.whitelabelId ?? null;

      if (!ledger) {
        set.status = 400;
        return { success: false, error: "Bet rejected: ledger not found for user" };
      }

      const userLimitNum = parseFloat(ledger.userLimit ?? "0");

      // Fail-fast only when the user has no betting allowance at all.
      // We deliberately do NOT reject on final_limit <= 0 here: a hedging bet
      // (e.g. lay on a runner the user is already long on) reduces total
      // exposure, so post-insertion final_limit can become positive again
      // even when pre-insertion final_limit was 0 or negative. The real
      // exposure check is done post-insert by re-running set_limit_used_of_user
      // inside the transaction and rolling back if final_limit < 0.
      if (userLimitNum <= 0) {
        set.status = 400;
        return { success: false, error: "Bet rejected: no available limit" };
      }

      // ── STEP 1.5: Verify odds against upstream /sports/books/ ──
      // The user's screen may be running on a stale snapshot (slow network, WS
      // disconnect, laptop sleep). Re-pull the price for the exact slot they
      // clicked (runner × back/lay × priceIndex) and reject the bet if it
      // moved, so a user can't lock in a price that's no longer offered.
      const numericSelectionId = Number(selectionId);
      const isLayBet = type === "lay";
      const slotIndex = Number.isFinite(Number(priceIndex)) ? Number(priceIndex) : 0;

      const verification = await verifyOddsUnchanged({
        marketId: canonicalMarketId,
        selectionId: numericSelectionId,
        isLay: isLayBet,
        priceIndex: slotIndex,
        clientOdds: odds,
        clientRun: run,
        provider,
        marketType,
        isFancy: isFancyBet,
        timeoutMs: FRESH_ODDS_TIMEOUT_MS,
      });

      if (!verification.ok) {
        set.status = 400;
        return { success: false, error: verification.reason };
      }

      // verifyOddsUnchanged may snap the bet to a different price (small
      // favorable move → fresh upstream odds; large favorable move → clicked
      // ± 5 points). Use effectiveOdds from here on so the stored bet, the
      // potential-return math, and the user's history all agree.
      const effectiveOdds = verification.effectiveOdds ?? odds;

      // ── STEP 2: Insert bet + details in a single transaction ──
      const today = new Date();

      const [txn] = await db.transaction(async (tx) => {
        // Insert into transactions
        const [newTxn] = await tx
          .insert(transactions)
          .values({
            userId: userId,
            whitelabelId: whitelabelId ?? undefined,
            eventTypeId: Number(eventTypeId) || 4,
            competitionId: competitionId ? Number(competitionId) : null,
            matchId: Number(matchId),
            marketId: canonicalMarketId,
            marketName: marketName || null,
            marketType: marketTypeInt,
            selectionId: numericSelectionId,
            selectionName: selectionName || null,
            betType: parseBetType(type),
            stake: stake.toString(),
            odds: effectiveOdds.toString(),
            status: "matched",
            isCashout: isCashout === true,
            ipAddress,
            matchedAt: today,
            addedBy: userId,
            updateBy: userId,
          })
          .returning();

        // Insert one row per runner into transaction_details
        // Odds market: 3 rows (Team A, Team B, Draw)
        // Bookmaker market: 2 rows (Team A, Team B)
        // Line market: 1 row (session runner with run value)
        const isBetfair = provider?.toUpperCase() === "BETFAIR";
        const isWinningOdds = marketType?.toUpperCase() === "WINNING_ODDS";
        const isFancy = marketTypeInt === MarketType.Fancy;
        const isBack = type === "back";
        const detailRows = runners.map((runner) => {
          const runnerId = Number(runner.id);
          const isSelected = runnerId === numericSelectionId;
          // For the selected runner, use the authoritative `effectiveOdds` from the
          // transaction (post snap-adjust) so transaction_details.price matches
          // transactions.odds exactly. For other runners, use their own price
          // from the runners array.
          const runnerOdds = isSelected ? effectiveOdds : (runner.price ?? 0);
          // Betfair fancy (LINE) markets: odds are already the raw run value (e.g. 1), never subtract 1.
          // Betfair non-fancy and WINNING_ODDS: odds are decimal (e.g. 1.98), subtract 1 for profit ratio.
          const storedPrice = (isBetfair && isFancy) ? runnerOdds : (isBetfair || isWinningOdds) ? runnerOdds - 1 : runnerOdds;

          // potentialReturn = P&L for this runner if IT wins
          // Back bet:  selected runner wins → +stake * storedPrice; other runners win → -stake
          // Lay bet:   selected runner wins → -(stake * storedPrice) liability; others win → +stake
          let runnerPotentialReturn: number;
          if (isBack) {
            runnerPotentialReturn = isSelected ? stake * storedPrice : -stake;
          } else {
            runnerPotentialReturn = isSelected ? -(stake * storedPrice) : stake;
          }

          return {
            transactionId: newTxn.id,
            runnerId,
            runnerName: runner.name || null,
            isUserSelection: isSelected,
            betType: parseBetType(type),
            price: storedPrice.toString(),
            basePrice: runnerOdds.toString(),
            run: isSelected && run != null ? Math.round(run) : 0,
            stake: stake.toString(),
            potentialReturn: runnerPotentialReturn.toFixed(2),
            addedBy: userId,
            updateBy: userId,
          };
        });

        await tx.insert(transactionDetails).values(detailRows);

        // Insert transaction log
        await tx.insert(transactionLogs).values({
          transactionId: newTxn.id,
          ipAddress,
          ...ua,
          addedBy: userId,
          updateBy: userId,
        });

        // ── Commission snapshot ──
        // Walk up the hierarchy: User → Agent → Master → Super → Admin → Owner
        // Each parent's downline% is THEIR share. The remainder goes to THEIR parent.
        // Example: Owner creates Admin with downline 85%
        //          Admin creates User with downline 100%
        //          → Admin gets 85%, Owner gets 15% (100 - 85)
        const hierarchyRows = await tx.execute(sql`
          WITH RECURSIVE hierarchy AS (
            SELECT
              u.id AS ancestor_id,
              u.role AS ancestor_role,
              p.downline::DECIMAL(5,2) AS downline,
              1 AS depth
            FROM users u
            JOIN profiles p ON p.user_id = u.id
            WHERE u.id = (SELECT added_by FROM users WHERE id = ${userId})

            UNION ALL

            SELECT
              u2.id,
              u2.role,
              p2.downline::DECIMAL(5,2),
              h.depth + 1
            FROM hierarchy h
            JOIN users u2 ON u2.id = (SELECT added_by FROM users WHERE id = h.ancestor_id)
            JOIN profiles p2 ON p2.user_id = u2.id
            WHERE h.depth < 10
              AND u2.id IS NOT NULL
          )
          SELECT ancestor_id, ancestor_role, downline
          FROM hierarchy
          ORDER BY depth ASC
        `);

        const ancestors = Array.isArray(hierarchyRows) ? hierarchyRows : (hierarchyRows as any)?.rows || [];

        // Calculate each level's commission share from the downline chain.
        // Each person's downline% is the CUMULATIVE share flowing to that level and below.
        // So each level keeps: their_downline% - their_child's_downline%
        // Owner keeps: 100% - the highest non-owner downline%
        //
        // Example: Owner → Admin(downline=85) → User
        //   Admin gets: 85 - 0 = 85%
        //   Owner gets: 100 - 85 = 15%
        //
        // Example: Owner → Admin(85) → Agent(70) → User
        //   Agent gets: 70 - 0 = 70%
        //   Admin gets: 85 - 70 = 15%
        //   Owner gets: 100 - 85 = 15%
        const snapshotData: typeof transactionCommissions.$inferInsert = {
          transactionId: newTxn.id,
          addedBy: userId,
          updateBy: userId,
        };

        let previousDownline = 0; // start from 0 (bottom of chain, below the first ancestor)
        for (let i = 0; i < ancestors.length; i++) {
          const row = ancestors[i];
          const role = Number(row.ancestor_role);
          const downline = parseFloat(row.downline ?? "0");

          // Each non-Owner level keeps: their downline% - child's downline%
          const share = downline - previousDownline;

          if (role === UserRole.Agent) {
            snapshotData.agentId = row.ancestor_id;
            snapshotData.agentPercent = Math.max(share, 0).toFixed(2);
          } else if (role === UserRole.Master) {
            snapshotData.masterId = row.ancestor_id;
            snapshotData.masterPercent = Math.max(share, 0).toFixed(2);
          } else if (role === UserRole.Super) {
            snapshotData.superId = row.ancestor_id;
            snapshotData.superPercent = Math.max(share, 0).toFixed(2);
          } else if (role === UserRole.Admin) {
            snapshotData.adminId = row.ancestor_id;
            snapshotData.adminPercent = Math.max(share, 0).toFixed(2);
          } else if (role === UserRole.Owner) {
            // Owner gets whatever remains above the last non-owner downline
            snapshotData.ownerId = row.ancestor_id;
            snapshotData.ownerPercent = Math.max(100 - previousDownline, 0).toFixed(2);
          }

          previousDownline = downline;
        }

        await tx.insert(transactionCommissions).values(snapshotData);

        // Recalculate exposure inside the transaction so we can reject
        // (and roll back) any bet that would push final_limit negative.
        // Hedging bets reduce limit_consumed and pass; bets that genuinely
        // exceed the user's allowance are caught here.
        await tx.execute(sql`CALL set_limit_used_of_user(${userId}::uuid)`);

        const [updatedLedger] = await tx
          .select({ finalLimit: ledgerLimit.finalLimit })
          .from(ledgerLimit)
          .where(eq(ledgerLimit.userId, userId))
          .limit(1);

        const newFinalLimit = parseFloat(updatedLedger?.finalLimit ?? "0");
        if (newFinalLimit < 0) {
          throw new Error("Bet rejected: potential loss exceeds your available limit");
        }

        return [newTxn];
      });

      set.status = 201;
      return { success: true, transactionId: txn.id };
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to place bet";
      if (msg.startsWith("Bet rejected:")) {
        set.status = 400;
        return { success: false, error: msg };
      }
      set.status = 500;
      return { success: false, error: msg };
    }
  })

  // Get user's bets — delegated to the SQL function fn_get_user_sports_bets,
  // which folds the transactions / transaction_details / sports / competitions
  // / events joins into a single query. Keeps the old response shape.
  .get("/my-bets", async ({ userId, query, set }) => {
    try {
      const status = (query?.status as string) || "all";
      const limit = parseInt((query?.limit as string) || "50");
      const offset = parseInt((query?.offset as string) || "0");

      const rows = await db.execute(sql`
        SELECT fn_get_user_sports_bets(
          ${userId}::uuid,
          ${status}::text,
          ${limit}::int,
          ${offset}::int
        ) AS data
      `);

      const rowArray = Array.isArray(rows) ? rows : (rows as any)?.rows ?? [];
      const result: any[] = (rowArray[0]?.data as any[] | null) ?? [];

      set.status = 200;
      return { success: true, data: result };
    } catch (error) {
      console.error("Failed to fetch bets:", error);
      set.status = 500;
      return { success: false, error: "Failed to fetch bets" };
    }
  })

  // Cancel a transaction (matched bet)
  .post("/cancel/:transactionId", async ({ params, userId, set }) => {
    try {
      const txn = await db
        .select()
        .from(transactions)
        .where(
          and(
            eq(transactions.id, params.transactionId),
            eq(transactions.userId, userId),
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

      await db
        .update(transactions)
        .set({ status: "cancelled", cancelledAt: new Date() })
        .where(eq(transactions.id, params.transactionId));

      // Recalculate exposure after cancellation
      await db.execute(sql`CALL set_limit_used_of_user(${userId}::uuid)`);

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
        matchId: string | number;
        results: Record<string, "winner" | "loser">;
      };

      // Add to result processing queue
      await addResultToQueue({ matchId: Number(matchId), results });

      set.status = 200;
      return { success: true, message: "Results queued for processing" };
    } catch (error) {
      console.error("Failed to declare results:");
      set.status = 500;
      return { success: false, error: "Failed to declare results" };
    }
  })

  .get("/ledger-info", async ({ userId, set }) => {
    try {
      const ledgerData = await db
        .select()
        .from(ledgerLimit)
        .where(eq(ledgerLimit.userId, userId))
        .limit(1);

      set.status = 200;
      return { success: true, data: ledgerData[0] || null };
    } catch (error) {
      set.status = 500;
      return { success: false, error: "Failed to fetch ledger info" };
    }
  })

  // Get per-market exposure for the user (from DB function)
  // Pass marketId query param to filter by specific market, or omit for all markets
  .get("/market-exposure", async ({ userId, query, set }) => {
    try {
      const marketId = query?.marketId ? Number(query.marketId) : 0;
      const rows = await db.execute(
        sql`SELECT * FROM get_limituse_of_user_market(${userId}::uuid, ${marketId}::numeric)`
      );
      const data = Array.isArray(rows) ? rows : (rows as any)?.rows || [];
      set.status = 200;
      return { success: true, data };
    } catch (error) {
      set.status = 500;
      return { success: false, error: "Failed to fetch market exposure" };
    }
  })

  // Get per-market exposure for fancy/session markets (market_type = 4)
  // Returns worst-case P&L per market (not per runner)
  .get("/market-exposure-fancy", async ({ userId, query, set }) => {
    try {
      const marketId = query?.marketId ? Number(query.marketId) : 0;
      const rows = await db.execute(
        sql`SELECT * FROM get_limituse_of_user_market_fancy(${userId}::uuid, ${marketId}::numeric)`
      );
      const data = Array.isArray(rows) ? rows : (rows as any)?.rows || [];
      set.status = 200;
      return { success: true, data };
    } catch (error) {
      set.status = 500;
      return { success: false, error: "Failed to fetch fancy market exposure" };
    }
  })

  // Get the user's per-row exposure usage (event/market/shift + amount).
  // Backed by get_limituse_of_user_detail() which returns one row per market
  // (or matka shift) with the worst-case loss already negated.
  .get("/exposure-usage", async ({ userId, set }) => {
    try {
      const rows = await db.execute(
        sql`
          SELECT
            lu.market_id         AS "marketId",
            lu.shift_id          AS "shiftId",
            lu."intflag"         AS "intFlag",
            lu.limit_use         AS "limitUse",
            lu."sportname"       AS "sportName",
            lu.market_name       AS "marketName",
            lu."competitionname" AS "competitionName",
            lu."eventname"       AS "eventName",
            lu."shiftname"       AS "shiftName"
          FROM get_limituse_of_user_detail(${userId}::uuid) lu
          WHERE COALESCE(lu.limit_use, 0) <> 0
          ORDER BY lu.limit_use DESC
        `
      );
      const data = Array.isArray(rows) ? rows : (rows as any)?.rows || [];

      // Casino exposure is summed into the user's total limit by
      // set_limit_used_of_user, but get_limituse_of_user_detail above only
      // covers sports + matka. Append one row per casino game using the SAME
      // per-round netted worst-case the limit uses (fn_casino_round_exposure),
      // so the breakdown reconciles with the total. intFlag = 2 marks casino;
      // the row is keyed by game_name + provider for the drill-down.
      const casinoRows = await db.execute(sql`
        SELECT
          NULL                                       AS "marketId",
          NULL                                       AS "shiftId",
          2                                          AS "intFlag",
          SUM(re.exposure)                           AS "limitUse",
          'Casino'                                   AS "sportName",
          NULL                                       AS "marketName",
          NULL                                       AS "competitionName",
          NULL                                       AS "eventName",
          NULL                                       AS "shiftName",
          COALESCE(re.game_name, re.provider)        AS "gameName",
          re.provider                                AS "provider",
          COUNT(*)                                   AS "betCount"
        FROM fn_casino_round_exposure(${userId}::uuid) re
        GROUP BY COALESCE(re.game_name, re.provider), re.provider
        HAVING SUM(re.exposure) <> 0
        ORDER BY SUM(re.exposure) DESC
      `);
      const casinoData = Array.isArray(casinoRows)
        ? casinoRows
        : (casinoRows as any)?.rows || [];

      set.status = 200;
      return { success: true, data: [...data, ...casinoData] };
    } catch (error) {
      console.error("Failed to fetch exposure usage:", error);
      set.status = 500;
      return { success: false, error: "Failed to fetch exposure usage" };
    }
  })

  // Drill-down for the Exposure Usage modal — sports market row.
  // Returns the user's active (status='matched') bets on that market with
  // runner detail and the placement log. Backed by fn_get_user_market_active_bets.
  .get("/exposure-usage/market", async ({ userId, query, set }) => {
    try {
      const marketId = query?.marketId ? String(query.marketId) : "";
      if (!marketId) {
        set.status = 400;
        return { success: false, error: "marketId is required" };
      }
      const rows = await db.execute(sql`
        SELECT fn_get_user_market_active_bets(
          ${userId}::uuid,
          ${marketId}::numeric
        ) AS data
      `);
      const rowArray = Array.isArray(rows) ? rows : (rows as any)?.rows ?? [];
      const data = rowArray[0]?.data ?? null;
      set.status = 200;
      return { success: true, data };
    } catch (error) {
      console.error("Failed to fetch exposure market detail:", error);
      set.status = 500;
      return { success: false, error: "Failed to fetch exposure market detail" };
    }
  })

  // Drill-down for the Exposure Usage modal — matka/jambo shift row.
  // Returns the user's consolidated jantri (per-number totals) for that shift.
  // Backed by fn_get_user_shift_consolidated_jantri.
  .get("/exposure-usage/shift", async ({ userId, query, set }) => {
    try {
      const shiftId = query?.shiftId ? String(query.shiftId) : "";
      if (!shiftId) {
        set.status = 400;
        return { success: false, error: "shiftId is required" };
      }
      const rows = await db.execute(sql`
        SELECT fn_get_user_shift_consolidated_jantri(
          ${userId}::uuid,
          ${shiftId}::uuid
        ) AS data
      `);
      const rowArray = Array.isArray(rows) ? rows : (rows as any)?.rows ?? [];
      const data = rowArray[0]?.data ?? null;
      set.status = 200;
      return { success: true, data };
    } catch (error) {
      console.error("Failed to fetch exposure shift detail:", error);
      set.status = 500;
      return { success: false, error: "Failed to fetch exposure shift detail" };
    }
  })

  // Drill-down for the Exposure Usage modal — casino game row.
  // Returns the user's matched (unsettled) casino bets for one game, keyed by
  // game_name + provider (the grouping used in /exposure-usage above).
  .get("/exposure-usage/casino", async ({ userId, query, set }) => {
    try {
      const gameName = query?.gameName ? String(query.gameName) : "";
      const provider = query?.provider ? String(query.provider) : "";
      if (!gameName || !provider) {
        set.status = 400;
        return { success: false, error: "gameName and provider are required" };
      }
      const rows = await db.execute(sql`
        SELECT
          cb.id                                 AS "betId",
          cb.provider                           AS "provider",
          cb.provider_bet_id                    AS "providerBetId",
          cb.provider_round_id                  AS "providerRoundId",
          cb.game_name                          AS "gameName",
          cb.selection_name                     AS "selectionName",
          cb.bet_type                           AS "betType",
          cb.stake                              AS "stake",
          cb.odds                               AS "odds",
          COALESCE(cb.exposure, cb.stake)       AS "exposure",
          cb.status                             AS "status",
          cb.placed_at                          AS "placedAt",
          ctl.ip_address                        AS "ipAddress"
        FROM casino_transactions cb
        LEFT JOIN casino_transaction_logs ctl ON ctl.casino_bet_id = cb.id
        WHERE cb.user_id = ${userId}::uuid
          AND cb.status = 'matched'
          AND cb.record_status = 0
          AND cb.provider = ${provider}
          AND COALESCE(cb.game_name, cb.provider) = ${gameName}
        ORDER BY cb.placed_at DESC
      `);
      const bets = Array.isArray(rows) ? rows : (rows as any)?.rows || [];
      const totalStake = bets.reduce(
        (s: number, b: any) => s + Number(b.stake ?? 0),
        0,
      );
      const totalExposure = bets.reduce(
        (s: number, b: any) => s + Number(b.exposure ?? 0),
        0,
      );
      set.status = 200;
      return {
        success: true,
        data: {
          game: { gameName, provider },
          bets,
          summary: {
            totalBets: bets.length,
            totalStake: String(totalStake),
            totalExposure: String(totalExposure),
          },
        },
      };
    } catch (error) {
      console.error("Failed to fetch exposure casino detail:", error);
      set.status = 500;
      return { success: false, error: "Failed to fetch exposure casino detail" };
    }
  })

  // Get detailed run-by-run exposure chart for a single fancy market
  .get("/fancy-exposure-chart", async ({ userId, query, set }) => {
    try {
      const marketId = query?.marketId ? Number(query.marketId) : 0;
      if (!marketId) {
        set.status = 400;
        return { success: false, error: "marketId is required" };
      }
      const rows = await db.execute(
        sql`SELECT * FROM get_user_market_detail_of_fancy(${userId}::uuid, ${marketId}::numeric)`
      );
      const data = Array.isArray(rows) ? rows : (rows as any)?.rows || [];
      set.status = 200;
      return { success: true, data };
    } catch (error) {
      set.status = 500;
      return { success: false, error: "Failed to fetch fancy exposure chart" };
    }
  })

  .get("/balance", async ({ userId, set }) => {
    try {
      const ledgerData = await db
        .select({ userBalance: ledgerLimit.userBalance, finalLimit: ledgerLimit.finalLimit })
        .from(ledgerLimit)
        .where(eq(ledgerLimit.userId, userId))
        .limit(1);

      set.status = 200;
      return {
        success: true,
        balance: ledgerData[0]?.userBalance || "0",
        finalLimit: ledgerData[0]?.finalLimit || "0",
      };
    } catch (error) {
      console.error("Failed to fetch balance:");
      set.status = 500;
      return { success: false, error: "Failed to fetch balance" };
    }
  });
