import { Elysia, t } from "elysia";
import {
  popups,
  whitelabels,
  promocodes,
  promotions,
  qrCodes,
  sportsGames,
  homeSections,
  homeSectionGames,
  withdrawalMethods,
  banners,
} from "../db/schema";
import { eq, and } from "drizzle-orm";
import { whitelabel_middleware } from "../middleware/whitelabel";
import { DbType } from "../types";
import { db as myDb } from "../db";

export const publicRoutes = new Elysia({ prefix: "/public" })
  .resolve(async ({ request }): Promise<{ db: DbType; whitelabel: any }> => {
    const { db, whitelabel } = await whitelabel_middleware(request);
    return { db: db as DbType, whitelabel };
  })
  .get(
    "/promotions",
    async ({ set, db, request }) => {
      const data = await db
        .select()
        .from(promotions)
        .where(eq(promotions.status, "active"));
      set.status = 200;
      return { success: true, data };
    },
    { query: t.Object({ type: t.Optional(t.String()) }) }
  )

  .get(
    "/banners",
    async ({ query, set, db }) => {
      try {
        const data = await db
          .select()
          .from(banners)
          .where(
            and(
              eq(banners.status, "active"),
              query.position ? eq(banners.position, query.position) : undefined
            )
          );

        set.status = 200;
        return { success: true, data };
      } catch (err) {
        set.status = 500;
        return { success: false, error: "Failed to fetch banners" };
      }
    },
    { query: t.Object({ position: t.Optional(t.String()) }) }
  )
  .get(
    "/popups",
    async ({ query, set, db }) => {
      const data = await db
        .select()
        .from(popups)
        .where(
          and(
            eq(popups.status, "active"),
            query.page ? eq(popups.targetPage, query.page) : undefined
          )
        );
      set.status = 200;
      return { success: true, data };
    },
    { query: t.Object({ page: t.Optional(t.String()) }) }
  )

  .post(
    "/whitelabel-request",
    async ({ body, set }) => {
      const [data] = await myDb
        .insert(whitelabels)
        .values({ ...body, status: "pending" })
        .returning();
      set.status = 201;
      return { success: true, data };
    },
    {
      body: t.Object({
        name: t.String(),
        domain: t.String(),
        contactEmail: t.String(),
        theme: t.Optional(t.String()),
        preferences: t.Optional(t.String()),
      }),
    }
  )

  .get("/settings", async ({ set, headers }) => {
    const domain = headers["x-whitelabel-domain"];
    const data = await myDb.query.settings.findFirst();

    // Check if domain is whitelabeled
    if (domain) {
      const whitelabel = await myDb.query.whitelabels.findFirst({
        where: and(
          eq(whitelabels.domain, domain),
          eq(whitelabels.status, "active")
        ),
      });

      if (whitelabel?.theme) {
        const whitelabelTheme =
          typeof whitelabel.theme === "string"
            ? JSON.parse(whitelabel.theme)
            : whitelabel.theme;

        set.status = 200;
        return {
          success: true,
          data: {
            ...data,
            whitelabelTheme,
            siteName: whitelabel.name || data?.siteName,
            logo: whitelabel.logo || data?.logo,
            favicon: whitelabel.favicon || data?.favicon,
            description: whitelabel.description,
          },
        };
      }
    }

    // Return default settings theme
    if (data?.theme && typeof data.theme === "string") {
      data.theme = JSON.parse(data.theme);
    }
    set.status = 200;
    return { success: true, data };
  })

  .get("/promocodes", async ({ set, db }) => {
    const data = await db
      .select()
      .from(promocodes)
      .where(eq(promocodes.status, "active"));
    set.status = 200;
    return { success: true, data };
  })

  .get("/qrcodes", async ({ set, db }) => {
    const data = await db
      .select()
      .from(qrCodes)
      .where(eq(qrCodes.status, "active"));
    set.status = 200;
    return { success: true, data };
  })

  .get("/sports-games", async ({ set, db }) => {
    const data = await db
      .select()
      .from(sportsGames)
      .where(eq(sportsGames.status, "active"));
    set.status = 200;
    return { success: true, data };
  })

  .get("/home-sections", async ({ set, db, request }) => {
    const data = await db
      .select()
      .from(homeSections)
      .where(eq(homeSections.status, "active"));

    set.status = 200;
    return { success: true, data };
  })
  .get("/home-sections/:id/games", async ({ params, set, db, request }) => {
    const data = await db
      .select()
      .from(homeSectionGames)
      .where(
        and(
          eq(homeSectionGames.sectionId, parseInt(params.id)),
          eq(homeSectionGames.status, "active")
        )
      )
      .orderBy(homeSectionGames.order);

    set.status = 200;
    return { success: true, data };
  })

  .get("/withdrawal-methods", async ({ set, db }) => {
    const data = await db
      .select()
      .from(withdrawalMethods)
      .where(eq(withdrawalMethods.status, "active"));

    set.status = 200;
    return { success: true, data };
  });
