import crypto from "crypto";
import { api } from "./api";
import { CacheService } from "@services/cache";

const MERCHANT_ID = process.env.CASINO_MARCHANT_ID!;
const MERCHANT_KEY = process.env.CASINO_MARCHANT_KEY!;

function generateHeaders(params: Record<string, any>) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString("hex");

  const headers = {
    "X-Merchant-Id": MERCHANT_ID,
    "X-Timestamp": timestamp,
    "X-Nonce": nonce,
  };

  const merged: Record<string, any> = { ...params, ...headers };
  const sorted: Record<string, any> = {};

  Object.keys(merged)
    .sort()
    .forEach((key) => (sorted[key] = merged[key]));

  const hashString = new URLSearchParams(sorted).toString();
  const sign = crypto
    .createHmac("sha1", MERCHANT_KEY)
    .update(hashString)
    .digest("hex");

  return {
    ...headers,
    "X-Sign": sign,
    "Content-Type": "application/x-www-form-urlencoded",
  };
}

export const CasinoService = {
  async getGames(expand?: string, page?: number, per_page?: number) {
    try {
      const cacheKey = `casino:games:${expand || "none"}:${page || 1}:${
        per_page || 50
      }`;

      const cached = await CacheService.get(cacheKey);
      if (cached) return cached;

      const params: Record<string, any> = {};
      if (expand) params.expand = expand;
      if (page) params.page = page;
      if (per_page) params.per_page = per_page;

      const res = await api.get("/games", {
        params,
        headers: generateHeaders(params),
      });

      await CacheService.set(cacheKey, res.data, 60 * 60);
      return res.data;
    } catch (err: any) {
      console.error("getGames error:", err.response?.data || err.message);
      return { success: false, error: "GET_GAMES_FAILED" };
    }
  },

  async getLobby({
    game_uuid,
    currency,
    technology,
  }: {
    game_uuid: string;
    currency: string;
    technology?: string;
  }) {
    try {
      const params = { game_uuid, currency, ...(technology && { technology }) };
      const res = await api.get("/games/lobby", {
        params,
        headers: generateHeaders(params),
      });
      return res.data;
    } catch (err: any) {
      console.error("getLobby error:", err.response?.data || err.message);
      return { success: false, error: "GET_LOBBY_FAILED" };
    }
  },

  async initGame(params: {
    game_uuid: string;
    currency: string;
    player_id: string;
    player_name: string;
    session_id: string;
    return_url?: string;
    language?: string;
    email?: string;
    lobby_data?: string;
  }) {
    try { 
      const encoded = new URLSearchParams(params).toString();

      const res = await api.post("/games/init", encoded, {
        headers: generateHeaders(params),
      });
      return res.data;
    } catch (err: any) {
      console.error("initGame error:", err.response?.data || err.message);
      return { success: false, error: "INIT_GAME_FAILED" };
    }
  },

  async initDemo(params: {
    game_uuid: string;
    return_url?: string;
    language?: string;
  }) {
    try {
      const encoded = new URLSearchParams(params).toString();
      const res = await api.post("/games/init-demo", encoded, {
        headers: generateHeaders(params),
      });
      return res.data;
    } catch (err: any) {
      console.error("initDemo error:", err.response?.data || err.message);
      return { success: false, error: "INIT_DEMO_FAILED" };
    }
  },

  async getFreespinBets({
    game_uuid,
    currency,
  }: {
    game_uuid: string;
    currency: string;
  }) {
    try {
      const params = { game_uuid, currency };
      const res = await api.get("/freespins/bets", {
        params,
        headers: generateHeaders(params),
      });
      return res.data;
    } catch (err: any) {
      console.error(
        "getFreespinBets error:",
        err.response?.data || err.message
      );
      return { success: false, error: "GET_FREESPIN_BETS_FAILED" };
    }
  },

  async setFreespin(params: Record<string, any>) {
    try {
      const encoded = new URLSearchParams(params).toString();
      const res = await api.post("/freespins/set", encoded, {
        headers: generateHeaders(params),
      });
      return res.data;
    } catch (err: any) {
      console.error("setFreespin error:", err.response?.data || err.message);
      return { success: false, error: "SET_FREESPIN_FAILED" };
    }
  },

  async getFreespin(freespin_id: string) {
    try {
      const params = { freespin_id };
      const res = await api.get("/freespins/get", {
        params,
        headers: generateHeaders(params),
      });
      return res.data;
    } catch (err: any) {
      console.error("getFreespin error:", err.response?.data || err.message);
      return { success: false, error: "GET_FREESPIN_FAILED" };
    }
  },

  async cancelFreespin(freespin_id: string) {
    try {
      const params = { freespin_id };
      const encoded = new URLSearchParams(params).toString();
      const res = await api.post("/freespins/cancel", encoded, {
        headers: generateHeaders(params),
      });
      return res.data;
    } catch (err: any) {
      console.error("cancelFreespin error:", err.response?.data || err.message);
      return { success: false, error: "CANCEL_FREESPIN_FAILED" };
    }
  },

  async getLimits() {
    try {
      const res = await api.get("/limits", {
        headers: generateHeaders({}),
      });
      return res.data;
    } catch (err: any) {
      console.error("getLimits error:", err.response?.data || err.message);
      return { success: false, error: "GET_LIMITS_FAILED" };
    }
  },

  async getFreespinLimits() {
    try {
      const res = await api.get("/limits/freespin", {
        headers: generateHeaders({}),
      });
      return res.data;
    } catch (err: any) {
      console.error(
        "getFreespinLimits error:",
        err.response?.data || err.message
      );
      return { success: false, error: "GET_FREESPIN_LIMITS_FAILED" };
    }
  },

  async getJackpots() {
    try {
      const res = await api.get("/jackpots", {
        headers: generateHeaders({}),
      });
      return res.data;
    } catch (err: any) {
      console.error("getJackpots error:", err.response?.data || err.message);
      return { success: false, error: "GET_JACKPOTS_FAILED" };
    }
  },

  async balanceNotify(params: { balance: number; session_id?: string }) {
    try {
      const stringParams = {
        balance: params.balance.toString(),
        ...(params.session_id && { session_id: params.session_id }),
      };
      const encoded = new URLSearchParams(stringParams).toString();
      const res = await api.post("/balance/notify", encoded, {
        headers: generateHeaders(params),
      });
      return res.data;
    } catch (err: any) {
      console.error("balanceNotify error:", err.response?.data || err.message);
      return { success: false, error: "BALANCE_NOTIFY_FAILED" };
    }
  },

  async selfValidate() {
    try {
      const res = await api.post("/self-validate", "", {
        headers: generateHeaders({}),
      });
      return res.data;
    } catch (err: any) {
      console.error("selfValidate error:", err.response?.data || err.message);
      return { success: false, error: "SELF_VALIDATE_FAILED" };
    }
  },

  async getGameTags(expand?: string) {
    try {
      const cacheKey = `casino:game-tags:${expand || "none"}`;

      const cached = await CacheService.get(cacheKey);
      if (cached) return cached;

      const params: Record<string, any> = {};
      if (expand) params.expand = expand;

      const res = await api.get("/game-tags", {
        params,
        headers: generateHeaders(params),
      });

      await CacheService.set(cacheKey, res.data, 60 * 60);
      return res.data;
    } catch (err: any) {
      console.error("getGameTags error:", err.response?.data || err.message);
      return { success: false, error: "GET_GAME_TAGS_FAILED" };
    }
  },
};
