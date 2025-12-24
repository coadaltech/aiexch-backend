import { Elysia, t } from "elysia";
import { casino_games } from "../../db/schema";
import { eq, and, or, like, desc, asc, sql } from "drizzle-orm";
import { whitelabel_middleware } from "../../middleware/whitelabel";
import { DbType } from "../../types";
import { CacheService } from "../../services/cache";

export const casinoGamesRoutes = new Elysia({ prefix: "/casino/games" })
  .resolve(async ({ request }): Promise<{ db: DbType; whitelabel: any }> => {
    const { db, whitelabel } = await whitelabel_middleware(request);
    return { db: db as DbType, whitelabel };
  })
  .get(
    "/",
    async ({ query, db, set }) => {
      try {
        const {
          provider,
          type,
          technology,
          search,
          page = "1",
          per_page = "50",
          sort_by = "createdAt",
          order = "desc",
        } = query;

        // Apply filters
        const conditions = [];
        if (provider) {
          conditions.push(eq(casino_games.provider, provider));
        }
        if (type) {
          conditions.push(eq(casino_games.type, type));
        }
        if (technology) {
          conditions.push(eq(casino_games.technology, technology));
        }
        if (search) {
          conditions.push(
            or(
              like(casino_games.name, `%${search}%`),
              like(casino_games.uuid, `%${search}%`)
            )
          );
        }

        // Apply sorting
        const sortColumn =
          sort_by === "name"
            ? casino_games.name
            : sort_by === "provider"
            ? casino_games.provider
            : sort_by === "createdAt"
            ? casino_games.createdAt
            : casino_games.createdAt;

        // Apply pagination
        const pageNum = parseInt(page);
        const perPageNum = parseInt(per_page);
        const offset = (pageNum - 1) * perPageNum;

        // Build query with filters, sorting, and pagination
        const whereClause =
          conditions.length > 0 ? and(...conditions) : undefined;
        const orderClause =
          order === "asc" ? asc(sortColumn) : desc(sortColumn);

        const data = await db
          .select()
          .from(casino_games)
          .where(whereClause)
          .orderBy(orderClause)
          .limit(perPageNum)
          .offset(offset);

        // Get total count
        const total = await db.select().from(casino_games).where(whereClause);

        set.status = 200;
        return {
          success: true,
          data,
          pagination: {
            page: pageNum,
            per_page: perPageNum,
            total: total.length,
            total_pages: Math.ceil(total.length / perPageNum),
          },
        };
      } catch (error) {
        console.error("Error fetching casino games:");
        set.status = 500;
        return { success: false, error: "Failed to fetch casino games" };
      }
    },
    {
      query: t.Object({
        provider: t.Optional(t.String()),
        type: t.Optional(t.String()),
        technology: t.Optional(t.String()),
        search: t.Optional(t.String()),
        page: t.Optional(t.String()),
        per_page: t.Optional(t.String()),
        sort_by: t.Optional(t.String()),
        order: t.Optional(t.String()),
      }),
    }
  )

  .get("/:id", async ({ params, db, set }) => {
    try {
      const [game] = await db
        .select()
        .from(casino_games)
        .where(eq(casino_games.id, params.id))
        .limit(1);

      if (!game) {
        set.status = 404;
        return { success: false, error: "Casino game not found" };
      }

      set.status = 200;
      return { success: true, data: game };
    } catch (error) {
      console.error("Error fetching casino game:");
      set.status = 500;
      return { success: false, error: "Failed to fetch casino game" };
    }
  })

  .get(
    "/uuid/:uuid",
    async ({ params, db, set }) => {
      try {
        const [game] = await db
          .select()
          .from(casino_games)
          .where(eq(casino_games.uuid, params.uuid))
          .limit(1);

        if (!game) {
          set.status = 404;
          return { success: false, error: "Casino game not found" };
        }

        set.status = 200;
        return { success: true, data: game };
      } catch (error) {
        console.error("Error fetching casino game:");
        set.status = 500;
        return { success: false, error: "Failed to fetch casino game" };
      }
    },
    {
      params: t.Object({
        uuid: t.String(),
      }),
    }
  )

  .post(
    "/",
    async ({ body, db, set }) => {
      try {
        // Check if UUID already exists
        const existingGame = await db
          .select()
          .from(casino_games)
          .where(eq(casino_games.uuid, body.uuid))
          .limit(1);

        if (existingGame.length > 0) {
          set.status = 409;
          return {
            success: false,
            error: "Game with this UUID already exists",
          };
        }

        const [data] = await db.insert(casino_games).values(body).returning();
        set.status = 201;
        return { success: true, data };
      } catch (error) {
        console.error("Error creating casino game:");
        set.status = 500;
        return { success: false, error: "Failed to create casino game" };
      }
    },
    {
      body: t.Object({
        uuid: t.String(),
        name: t.String(),
        image: t.String(),
        type: t.String(),
        provider: t.String(),
        provider_id: t.Number(),
        technology: t.String(),
        has_lobby: t.Optional(t.Boolean()),
        is_mobile: t.Optional(t.Boolean()),
        has_freespins: t.Optional(t.Boolean()),
        has_tables: t.Optional(t.Boolean()),
        tags: t.Optional(t.Array(t.Any())),
        freespin_valid_until_full_day: t.Optional(t.Number()),
        label: t.Optional(t.String()),
      }),
    }
  )

  .put(
    "/:id",
    async ({ params, body, db, set }) => {
      try {
        // Check if game exists
        const [existingGame] = await db
          .select()
          .from(casino_games)
          .where(eq(casino_games.id, params.id))
          .limit(1);

        if (!existingGame) {
          set.status = 404;
          return { success: false, error: "Casino game not found" };
        }

        // If UUID is being updated, check for conflicts
        if (body.uuid && body.uuid !== existingGame.uuid) {
          const [conflictGame] = await db
            .select()
            .from(casino_games)
            .where(eq(casino_games.uuid, body.uuid))
            .limit(1);

          if (conflictGame) {
            set.status = 409;
            return {
              success: false,
              error: "Game with this UUID already exists",
            };
          }
        }

        const [data] = await db
          .update(casino_games)
          .set(body)
          .where(eq(casino_games.id, params.id))
          .returning();

        set.status = 200;
        return { success: true, data };
      } catch (error) {
        console.error("Error updating casino game:");
        set.status = 500;
        return { success: false, error: "Failed to update casino game" };
      }
    },
    {
      body: t.Partial(
        t.Object({
          uuid: t.String(),
          name: t.String(),
          image: t.String(),
          type: t.String(),
          provider: t.String(),
          provider_id: t.Number(),
          technology: t.String(),
          has_lobby: t.Boolean(),
          is_mobile: t.Boolean(),
          has_freespins: t.Boolean(),
          has_tables: t.Boolean(),
          tags: t.Array(t.Any()),
          freespin_valid_until_full_day: t.Number(),
          label: t.String(),
        })
      ),
    }
  )

  .get("/providers", async ({ db, set }) => {
    try {
      const cacheKey = "casino:games:providers";

      // Check cache first
      const cached = await CacheService.get<string[]>(cacheKey);
      if (cached) {
        set.status = 200;
        return { success: true, data: cached };
      }

      // Fetch unique providers from database
      const providers = await db
        .selectDistinct({ provider: casino_games.provider })
        .from(casino_games)
        .where(sql`${casino_games.provider} IS NOT NULL`);

      const providerList = providers
        .map((p) => p.provider)
        .filter((p): p is string => p !== null)
        .sort();

      // Cache for 1 hour
      await CacheService.set(cacheKey, providerList, 60 * 60);

      set.status = 200;
      return { success: true, data: providerList };
    } catch (error) {
      console.error("Error fetching providers:");
      set.status = 500;
      return { success: false, error: "Failed to fetch providers" };
    }
  })

  .get("/types", async ({ db, set }) => {
    try {
      const cacheKey = "casino:games:types";

      // Check cache first
      const cached = await CacheService.get<string[]>(cacheKey);
      if (cached) {
        set.status = 200;
        return { success: true, data: cached };
      }

      // Fetch unique types from database
      const types = await db
        .selectDistinct({ type: casino_games.type })
        .from(casino_games)
        .where(sql`${casino_games.type} IS NOT NULL`);

      const typeList = types
        .map((t) => t.type)
        .filter((t): t is string => t !== null)
        .sort();

      // Cache for 1 hour
      await CacheService.set(cacheKey, typeList, 60 * 60);

      set.status = 200;
      return { success: true, data: typeList };
    } catch (error) {
      console.error("Error fetching types:", error);
      set.status = 500;
      return { success: false, error: "Failed to fetch types" };
    }
  })

  .delete("/:id", async ({ params, db, set }) => {
    try {
      const [game] = await db
        .select()
        .from(casino_games)
        .where(eq(casino_games.id, params.id))
        .limit(1);

      if (!game) {
        set.status = 404;
        return { success: false, error: "Casino game not found" };
      }

      await db.delete(casino_games).where(eq(casino_games.id, params.id));
      set.status = 200;
      return { success: true, message: "Casino game deleted successfully" };
    } catch (error) {
      console.error("Error deleting casino game:");
      set.status = 500;
      return { success: false, error: "Failed to delete casino game" };
    }
  })
  .get("/providers-types", async ({ db, set }) => {
    try {
      const cacheKey = "casino:games:providers-types";

      const cached = await CacheService.get<
        Array<{ provider: string; types: string[] }>
      >(cacheKey);
      if (cached) {
        set.status = 200;
        return { success: true, data: cached };
      }

      const rows = await db
        .select({
          provider: casino_games.provider,
          type: casino_games.type,
        })
        .from(casino_games)
        .where(
          and(
            sql`${casino_games.provider} IS NOT NULL`,
            sql`${casino_games.type} IS NOT NULL`
          )
        );

      const providerMap = new Map<string, Set<string>>();
      rows.forEach(({ provider, type }) => {
        if (!provider || !type) return;
        if (!providerMap.has(provider)) {
          providerMap.set(provider, new Set());
        }
        providerMap.get(provider)!.add(type);
      });

      const data = Array.from(providerMap.entries())
        .map(([provider, types]) => ({
          provider,
          types: Array.from(types).sort((a, b) => a.localeCompare(b)),
        }))
        .sort((a, b) => a.provider.localeCompare(b.provider));

      await CacheService.set(cacheKey, data, 60 * 60);

      set.status = 200;
      return { success: true, data };
    } catch (error) {
      console.error("Error fetching providers and types:");
      set.status = 500;
      return { success: false, error: "Failed to fetch providers and types" };
    }
  });
