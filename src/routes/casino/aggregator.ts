import { Elysia, t } from "elysia";
import { CasinoService } from "../../services/casino/aggregator";
import { whitelabel_middleware } from "@middleware/whitelabel";
import { DbType } from "../../types";
import { casino_games, users } from "@db/schema";
import { eq } from "drizzle-orm";
import { app_middleware } from "@middleware/auth";
import { generateNumericId } from "@utils/generateId";

export const casinoAggregatorRoutes = new Elysia({ prefix: "/casino" })
  .resolve(async ({ request }): Promise<{ db: DbType }> => {
    const { db } = await whitelabel_middleware(request);
    return { db: db as DbType };
  })
  .get(
    "/games-aggregator",
    async ({ query, set }) => {
      try {
        const data = await CasinoService.getGames(
          query.expand,
          query.page ? Number(query.page) : undefined,
          query.per_page ? Number(query.per_page) : undefined
        );
        set.status = 200;
        return data;
      } catch {
        set.status = 500;
        return { success: false, error: "Failed to fetch games" };
      }
    },
    {
      query: t.Object({
        expand: t.Optional(t.String()),
        page: t.Optional(t.String()),
        per_page: t.Optional(t.String()),
      }),
    }
  )

  .get(
    "/lobby",
    async ({ query, set }) => {
      try {
        const data = await CasinoService.getLobby(query);
        set.status = 200;
        return data;
      } catch {
        set.status = 500;
        return { success: false, error: "Failed to fetch lobby" };
      }
    },
    {
      query: t.Object({
        game_uuid: t.String(),
        currency: t.String(),
        technology: t.Optional(t.String()),
      }),
    }
  )

  .state({ id: 0, role: "" })
  .guard({
    beforeHandle({ cookie, set, store }) {
      const state_result = app_middleware({ cookie });

      set.status = state_result.code;
      if (!state_result.data) return state_result;

      store.id = state_result.data.id;
      store.role = state_result.data.role;
    },
  })
  .post(
    "/init",
    async ({ body, set, db, store }) => {
      try {
        const { game_uuid } = body;
        if (!game_uuid) {
          set.status = 400;
          return { success: false, error: "Game UUID is required" };
        }

        const [game] = await db
          .select()
          .from(casino_games)
          .where(eq(casino_games.uuid, game_uuid))
          .limit(1);
        if (!game) {
          set.status = 404;
          return { success: false, error: "Game not found" };
        }

        const [player] = await db
          .select()
          .from(users)
          .where(eq(users.id, store.id))
          .limit(1);
        if (!player) {
          set.status = 404;
          return { success: false, error: "Player not found" };
        }

        const uniqueSessionId = generateNumericId();

        const requestBody = {
          game_uuid,
          currency: "EUR",
          player_id: String(store.id),
          player_name: player.email,
          session_id: uniqueSessionId,
          // return_url: body.return_url,
          // language: body.language,
          email: player.email,
        };

        if (game.has_lobby) {
          const lobbyData = await CasinoService.getLobby({
            game_uuid,
            currency: "EUR",
          });



          if (lobbyData.lobby) {
            if (lobbyData.lobby) {
              requestBody.lobby_data = lobbyData.lobby[0].lobbyData;
            }
          } else {
            set.status = 500;
            return { success: false, error: "Failed to fetch lobby data" };
          }
        }

        const data = await CasinoService.initGame(requestBody);
        set.status = 200;
        return data;
      } catch {
        set.status = 500;
        return { success: false, error: "Failed to init game" };
      }
    },
    {
      body: t.Object({
        game_uuid: t.String(),
      }),
    }
  )

  .post(
    "/init-demo",
    async ({ body, set }) => {
      try {
        const data = await CasinoService.initDemo(body);
        set.status = 200;
        return data;
      } catch {
        set.status = 500;
        return { success: false, error: "Failed to init demo" };
      }
    },
    {
      body: t.Object({
        game_uuid: t.String(),
        currency: t.String(),
        language: t.Optional(t.String()),
      }),
    }
  )

  .get(
    "/freespins/bets",
    async ({ query, set }) => {
      try {
        const data = await CasinoService.getFreespinBets(query);
        set.status = 200;
        return data;
      } catch {
        set.status = 500;
        return { success: false, error: "Failed to fetch freespin bets" };
      }
    },
    {
      query: t.Object({
        game_uuid: t.String(),
        currency: t.String(),
      }),
    }
  )

  .post(
    "/freespins/set",
    async ({ body, set }) => {
      try {
        const data = await CasinoService.setFreespin(body);
        set.status = 200;
        return data;
      } catch {
        set.status = 500;
        return { success: false, error: "Failed to set freespin" };
      }
    },
    {
      body: t.Object(
        {},
        {
          additionalProperties: true,
        }
      ),
    }
  )

  .get(
    "/freespins/:freespin_id",
    async ({ params, set }) => {
      try {
        const data = await CasinoService.getFreespin(params.freespin_id);
        set.status = 200;
        return data;
      } catch {
        set.status = 500;
        return { success: false, error: "Failed to fetch freespin" };
      }
    },
    {
      params: t.Object({
        freespin_id: t.String(),
      }),
    }
  )

  .post(
    "/freespins/cancel/:freespin_id",
    async ({ params, set }) => {
      try {
        const data = await CasinoService.cancelFreespin(params.freespin_id);
        set.status = 200;
        return data;
      } catch {
        set.status = 500;
        return { success: false, error: "Failed to cancel freespin" };
      }
    },
    {
      params: t.Object({
        freespin_id: t.String(),
      }),
    }
  )

  .get("/limits", async ({ set }) => {
    try {
      const data = await CasinoService.getLimits();
      set.status = 200;
      return data;
    } catch {
      set.status = 500;
      return { success: false, error: "Failed to fetch limits" };
    }
  })

  .get("/limits/freespin", async ({ set }) => {
    try {
      const data = await CasinoService.getFreespinLimits();
      set.status = 200;
      return data;
    } catch {
      set.status = 500;
      return { success: false, error: "Failed to fetch freespin limits" };
    }
  })

  .get("/jackpots", async ({ set }) => {
    try {
      const data = await CasinoService.getJackpots();
      set.status = 200;
      return data;
    } catch {
      set.status = 500;
      return { success: false, error: "Failed to fetch jackpots" };
    }
  })

  .post(
    "/balance/notify",
    async ({ body, set }) => {
      try {
        const data = await CasinoService.balanceNotify(body);
        set.status = 200;
        return data;
      } catch {
        set.status = 500;
        return { success: false, error: "Failed to notify balance" };
      }
    },
    {
      body: t.Object({
        balance: t.Number(),
        session_id: t.Optional(t.String()),
      }),
    }
  )

  .post("/self-validate", async ({ set }) => {
    try {
      const data = await CasinoService.selfValidate();
      set.status = 200;
      return data;
    } catch {
      set.status = 500;
      return { success: false, error: "Failed to validate" };
    }
  })

  .get(
    "/game-tags",
    async ({ query, set }) => {
      try {
        const data = await CasinoService.getGameTags(query.expand);
        set.status = 200;
        return data;
      } catch {
        set.status = 500;
        return { success: false, error: "Failed to fetch game tags" };
      }
    },
    {
      query: t.Object({
        expand: t.Optional(t.String()),
      }),
    }
  );
