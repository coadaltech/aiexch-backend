import { Elysia, t } from "elysia";
import { db } from "@db/index";
import { casinoGames, users } from "../db/schema";
import { eq, and, desc, asc } from "drizzle-orm";
import { app_middleware } from "../middleware/auth";
import { RecordStatus } from "../types/enums";
import {
  generateLaunchUrl,
  listGames as fetchUpstreamGames,
} from "../services/casino/ace-platform-client";

/**
 * Ace Gamings — Operator-side routes
 *
 *   GET  /casino-ace/games               public: lobby data from our DB
 *   POST /casino-ace/launch              authed: get a launch URL for a game
 *   POST /casino-ace/admin/sync-games    admin: pull catalog from Ace into DB
 *
 * This file deliberately does NOT touch the wallet (debit/credit) — those
 * remain in /casino-wallet-stub for now. Bet handling lands in a later step.
 */

const RETURN_URL_DEFAULT =
  process.env.CASINO_RETURN_URL || "https://aiexch.com/casino";

// ── Public + admin routes ────────────────────────────────────────────────

export const casinoAceRoutes = new Elysia({ prefix: "/casino-ace" })
  // ── Public: list visible games for the lobby ───────────────────────────
  .get("/games", async () => {
    const rows = await db
      .select({
        id: casinoGames.id,
        externalId: casinoGames.externalId,
        slug: casinoGames.slug,
        name: casinoGames.name,
        lang: casinoGames.lang,
        currency: casinoGames.currency,
        thumbnailUrl: casinoGames.thumbnailUrl,
        specialNote: casinoGames.specialNote,
      })
      .from(casinoGames)
      .where(
        and(
          eq(casinoGames.visible, true),
          eq(casinoGames.recordStatus, RecordStatus.Active),
        ),
      )
      .orderBy(asc(casinoGames.name));
    return { success: true, games: rows };
  })

  // ── Authed: generate a launch URL for the current user ────────────────
  .resolve(async ({ cookie, headers, status, path, request }) => {
    // Skip middleware for the public games route by short-circuiting.
    // Elysia evaluates .resolve() for every request on this prefix, so we
    // only enforce auth when the path actually needs it.
    if (path === "/casino-ace/games") return { userId: "", authed: false };

    const result = await app_middleware({ cookie, headers, request });
    if (!result.data) {
      return status(result.code as 401 | 403 | 404 | 500, result);
    }
    return { userId: result.data.id, authed: true };
  })

  .post(
    "/launch",
    async ({ body, userId, set }) => {
      const { gameId, returnUrl } = body as {
        gameId: number;
        returnUrl?: string;
      };

      if (!gameId || typeof gameId !== "number") {
        set.status = 400;
        return { success: false, message: "gameId is required (number)" };
      }

      // Resolve the game from our DB (also validates visibility)
      const [game] = await db
        .select()
        .from(casinoGames)
        .where(
          and(
            eq(casinoGames.externalId, gameId),
            eq(casinoGames.visible, true),
            eq(casinoGames.recordStatus, RecordStatus.Active),
          ),
        )
        .limit(1);
      if (!game) {
        set.status = 404;
        return { success: false, message: "Game not found or hidden" };
      }

      // Resolve the player from our DB (we send our UUID as their player_id)
      const [user] = await db
        .select({
          id: users.id,
          username: users.username,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!user) {
        set.status = 401;
        return { success: false, message: "User not found" };
      }

      try {
        const platformResp = await generateLaunchUrl({
          player_id: user.id,
          name: user.username || `player-${user.id.slice(0, 8)}`,
          currency: game.currency, // launch with the game's native currency
          country: "LK",
          lang: "en-US",
          return_url: returnUrl || RETURN_URL_DEFAULT,
          game_id: game.externalId,
        });

        // NOTE: in the next phase we'll persist player_session_token to a
        // casino_player_sessions table so wallet callbacks can validate it.
        // For now we just return it to the frontend.
        return {
          success: true,
          url: platformResp.url,
          playerSessionToken: platformResp.player_session_token,
          game: {
            id: game.externalId,
            name: game.name,
            slug: game.slug,
          },
        };
      } catch (err: any) {
        const upstream = err?.response?.data ?? err?.message ?? String(err);
        set.status = 502;
        return {
          success: false,
          message: "Failed to generate launch URL",
          upstream,
        };
      }
    },
    {
      body: t.Object({
        gameId: t.Number(),
        returnUrl: t.Optional(t.String()),
      }),
    },
  )

  // ── Admin: manual sync (mirrors the CLI script, but reachable via HTTP)
  // For now, simple ADMIN_SYNC_SECRET header gate. Replace with role-based
  // permission check (UserRole.Owner/Admin) once UI exposes this.
  .post(
    "/admin/sync-games",
    async ({ headers, set }) => {
      const secret = process.env.CASINO_ADMIN_SYNC_SECRET || "";
      const sent = headers["x-admin-sync-secret"];
      if (!secret || sent !== secret) {
        set.status = 401;
        return { success: false, message: "Unauthorized" };
      }

      const upstream = await fetchUpstreamGames();
      const now = new Date();
      let inserted = 0;
      let updated = 0;

      for (const g of upstream) {
        if (!g.id || !g.slug || !g.name || !g.currency) continue;
        const values = {
          externalId: g.id,
          slug: g.slug.slice(0, 100),
          name: g.name.slice(0, 100),
          lang: (g.lang || "en-US").slice(0, 10),
          currency: g.currency.slice(0, 3).toUpperCase(),
          thumbnailUrl: g.thumbnail_url ?? null,
          specialNote: g.special_note?.slice(0, 50) ?? null,
          lastSeenAt: now,
        };
        const r = await db
          .insert(casinoGames)
          .values(values)
          .onConflictDoUpdate({
            target: casinoGames.externalId,
            set: {
              slug: values.slug,
              name: values.name,
              lang: values.lang,
              currency: values.currency,
              thumbnailUrl: values.thumbnailUrl,
              specialNote: values.specialNote,
              lastSeenAt: now,
            },
          })
          .returning({ addedDate: casinoGames.addedDate });
        if (r[0]?.addedDate && r[0].addedDate >= now) inserted++;
        else updated++;
      }

      return {
        success: true,
        upstreamCount: upstream.length,
        inserted,
        updated,
      };
    },
    { body: t.Optional(t.Any()) },
  );
