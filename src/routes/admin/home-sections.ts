import { Elysia, t } from "elysia";
import { homeSections, homeSectionGames } from "../../db/schema.js";
import { eq, asc } from "drizzle-orm";
import { uploadFile, deleteFile } from "../../services/s3.js";
import { whitelabel_middleware } from "../../middleware/whitelabel.js";
import { DbType } from "../../types/index.js";

export const homeSectionsRoutes = new Elysia({ prefix: "/home-sections" })
  .resolve(async ({ request }): Promise<{ db: DbType; whitelabel: any }> => {
    const { db, whitelabel } = await whitelabel_middleware(request);
    return { db: db as DbType, whitelabel };
  })
  .get("/", async ({ set, db, request }) => {
    try {

      const sections = await db
        .select()
        .from(homeSections)
        .orderBy(asc(homeSections.order));

      set.status = 200;
      return { success: true, data: sections };
    } catch (error) {
      console.error("[ADMIN-SECTIONS] Error:");
      set.status = 500;
      return { success: false, message: "Failed to fetch home sections" };
    }
  })

  .get(
    "/:id/games",
    async ({ params, set, db, request }) => {
      try {
        const { id } = params;

        const games = await db
          .select()
          .from(homeSectionGames)
          .where(eq(homeSectionGames.sectionId, parseInt(id)))
          .orderBy(asc(homeSectionGames.order));

        set.status = 200;
        return { success: true, data: games };
      } catch (error) {
        console.error("[ADMIN-SECTION-GAMES] Error:");
        set.status = 500;
        return { success: false, message: "Failed to fetch section games" };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  .post(
    "/",
    async ({ body, set, db, request }) => {
      try {
        const { title, subtitle, type, order, status } = body;


        const [section] = await db
          .insert(homeSections)
          .values({
            title,
            subtitle,
            type,
            order: order || 0,
            status: status || "active",
          })
          .returning();


        set.status = 201;
        return { success: true, data: section };
      } catch (error) {
        console.error("[ADMIN-CREATE-SECTION] Error:");
        set.status = 500;
        return { success: false, message: "Failed to create home section" };
      }
    },
    {
      body: t.Object({
        title: t.String(),
        subtitle: t.Optional(t.String()),
        type: t.String(),
        order: t.Optional(t.Number()),
        status: t.Optional(t.String()),
      }),
    }
  )

  .post(
    "/:id/games",
    async ({ params, body, set, db }) => {
      try {
        const { id } = params;

        let imageUrl = "";
        if (body.image) {
          imageUrl =
            typeof body.image === "string"
              ? body.image
              : await uploadFile(body.image);
        }

        const popular = body.popular === "true";
        const hot = body.hot === "true";
        const order =
          typeof body.order === "string"
            ? parseInt(body.order)
            : body.order || 0;

        const [game] = await db
          .insert(homeSectionGames)
          .values({
            sectionId: parseInt(id),
            name: body.name,
            image: imageUrl,
            link: body.link,
            popular,
            hot,
            order,
            status: body.status || "active",
          })
          .returning();

        set.status = 201;
        return { success: true, data: game };
      } catch (error) {
        set.status = 500;
        return { success: false, message: "Failed to add game to section" };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      type: "formdata",
      body: t.Object({
        name: t.String(),
        image: t.Union([t.String(), t.File()]),
        link: t.String(),
        popular: t.String(),
        hot: t.String(),
        order: t.String(),
        status: t.Optional(t.String()),
      }),
    }
  )

  .put(
    "/:id",
    async ({ params, body, set, db }) => {
      try {
        const { id } = params;
        const { title, subtitle, type, order, status } = body;

        const [section] = await db
          .update(homeSections)
          .set({
            title,
            subtitle,
            type,
            order,
            status,
            updatedAt: new Date(),
          })
          .where(eq(homeSections.id, parseInt(id)))
          .returning();

        set.status = 200;
        return { success: true, data: section };
      } catch (error) {
        set.status = 500;
        return { success: false, message: "Failed to update home section" };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        title: t.Optional(t.String()),
        subtitle: t.Optional(t.String()),
        type: t.Optional(t.String()),
        order: t.Optional(t.Number()),
        status: t.Optional(t.String()),
      }),
    }
  )

  .put(
    "/games/:gameId",
    async ({ params, body, set, db }) => {
      try {
        const { gameId } = params;




        const [current] = await db
          .select()
          .from(homeSectionGames)
          .where(eq(homeSectionGames.id, parseInt(gameId)));

        if (!current) {
          set.status = 404;
          return { success: false, message: "Game not found" };
        }

        const updateData: any = { updatedAt: new Date() };

        if (body.name) updateData.name = body.name;
        if (body.link) updateData.link = body.link;
        if (body.status) updateData.status = body.status;

        if (body.popular !== undefined) {
          updateData.popular = body.popular === "true";
        }
        if (body.hot !== undefined) {
          updateData.hot = body.hot === "true";
        }
        if (body.order !== undefined) {
          updateData.order =
            typeof body.order === "string" ? parseInt(body.order) : body.order;
        }

        if (body.image && typeof body.image !== "string") {
          const newImageUrl = await uploadFile(body.image);
          if (current.image) {
            try {
              await deleteFile(current.image);
            } catch (err) {
              console.warn("Failed to delete old image:");
            }
          }
          updateData.image = newImageUrl;
        }



        const [game] = await db
          .update(homeSectionGames)
          .set(updateData)
          .where(eq(homeSectionGames.id, parseInt(gameId)))
          .returning();

        set.status = 200;
        return { success: true, data: game };
      } catch (error) {
        console.error("PUT /games/:gameId error:");
        set.status = 500;
        return { success: false, message: "Failed to update game" };
      }
    },
    {
      params: t.Object({
        gameId: t.String(),
      }),
      type: "formdata",
      body: t.Object({
        name: t.Optional(t.String()),
        image: t.Optional(t.Union([t.String(), t.File()])),
        link: t.Optional(t.String()),
        popular: t.Optional(t.String()),
        hot: t.Optional(t.String()),
        order: t.Optional(t.String()),
        status: t.Optional(t.String()),
      }),
    }
  )

  .delete(
    "/:id",
    async ({ params, set, db }) => {
      try {
        const { id } = params;
        await db.delete(homeSections).where(eq(homeSections.id, parseInt(id)));
        set.status = 200;
        return { success: true, message: "Home section deleted successfully" };
      } catch (error) {
        set.status = 500;
        return { success: false, message: "Failed to delete home section" };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  .delete(
    "/games/:gameId",
    async ({ params, set, db }) => {
      try {
        const { gameId } = params;

        const [current] = await db
          .select()
          .from(homeSectionGames)
          .where(eq(homeSectionGames.id, parseInt(gameId)));

        if (current?.image) {
          try {
            await deleteFile(current.image);
          } catch (err) {
            console.warn("Failed to delete image:");
          }
        }

        await db
          .delete(homeSectionGames)
          .where(eq(homeSectionGames.id, parseInt(gameId)));
        set.status = 200;
        return { success: true, message: "Game deleted successfully" };
      } catch (error) {
        set.status = 500;
        return { success: false, message: "Failed to delete game" };
      }
    },
    {
      params: t.Object({
        gameId: t.String(),
      }),
    }
  );
