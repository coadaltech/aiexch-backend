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
  .resolve(async ({ request }): Promise<{ db: DbType; whitelabel: any; dbError?: string }> => {
    const { db, whitelabel, dbError } = await whitelabel_middleware(request);
    return { db: db as DbType, whitelabel, dbError };
  })
  .get("/whitelabel-info", async ({ set, whitelabel }) => {
    if (!whitelabel) {
      set.status = 200;
      return { success: true, data: { whitelabelType: null, id: null, name: null } };
    }
    const rawType = whitelabel.whitelabelType ?? "B2C";
    const whitelabelType = String(rawType).toUpperCase() === "B2B" ? "B2B" : "B2C";
    set.status = 200;
    return {
      success: true,
      data: {
        whitelabelType,
        id: whitelabel.id,
        name: whitelabel.name,
      },
    };
  })
  .get(
    "/promotions",
    async ({ set, db, request, dbError }) => {
      if (dbError === "DATABASE_NOT_FOUND") {
        set.status = 503;
        return { 
          success: false, 
          error: "DATABASE_NOT_FOUND",
          message: "Database not found. Please contact the owner to create the database." 
        };
      }
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

    // Parse the enabled-themes list to an array so the frontend theme switcher
    // receives a ready-to-use list regardless of which branch returns below.
    if (data && typeof (data as any).enabledThemes === "string") {
      try {
        (data as any).enabledThemes = JSON.parse((data as any).enabledThemes);
      } catch {
        (data as any).enabledThemes = ["default"];
      }
    }

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

        // Per-white-label LAYOUT theme lives on the whitelabel `layout` JSON
        // ({ sidebarType, bannerType, activeTheme, enabledThemes }). Surface it
        // as the top-level activeTheme/enabledThemes so a visitor on this domain
        // gets this white label's default + switch list, overriding the global
        // settings values. Falls back to the global values when not configured.
        let wlLayout: any = whitelabel.layout;
        if (typeof wlLayout === "string") {
          try {
            wlLayout = JSON.parse(wlLayout);
          } catch {
            wlLayout = null;
          }
        }
        const activeTheme = wlLayout?.activeTheme ?? (data as any)?.activeTheme;
        const enabledThemes = Array.isArray(wlLayout?.enabledThemes)
          ? wlLayout.enabledThemes
          : (data as any)?.enabledThemes;
        // Per-theme colour overrides (Diamond / Betfair …) edited per white label.
        const themeColors = wlLayout?.themeColors ?? null;

        set.status = 200;
        return {
          success: true,
          data: {
            ...data,
            whitelabelTheme,
            activeTheme,
            enabledThemes,
            themeColors,
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
    return { success: true, data: data ?? {} };
  })

  .get("/promocodes", async ({ set, db }) => {
    const data = await db
      .select()
      .from(promocodes)
      .where(eq(promocodes.status, "active"));
    set.status = 200;
    return { success: true, data };
  })

  .get("/qrcodes", async ({ set, db, whitelabel }) => {
    // QR codes are only available for B2C whitelabels
    const wlType = whitelabel?.whitelabelType
      ? String(whitelabel.whitelabelType).toUpperCase()
      : null;
    if (wlType !== "B2C") {
      set.status = 200;
      return { success: true, data: [] };
    }
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
          eq(homeSectionGames.sectionId, params.id),
          eq(homeSectionGames.status, "active")
        )
      )
      .orderBy(homeSectionGames.order);

    set.status = 200;
    return { success: true, data };
  })

  .get("/withdrawal-methods", async ({ set, db, whitelabel }) => {
    // Withdrawal methods are only available for B2C whitelabels
    const wlType = whitelabel?.whitelabelType
      ? String(whitelabel.whitelabelType).toUpperCase()
      : null;
    if (wlType !== "B2C") {
      set.status = 200;
      return { success: true, data: [] };
    }
    const data = await db
      .select()
      .from(withdrawalMethods)
      .where(eq(withdrawalMethods.status, "active"));

    set.status = 200;
    return { success: true, data };
  });
