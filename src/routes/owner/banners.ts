import { Elysia, t } from "elysia";
import { banners } from "../../db/schema";
import { eq } from "drizzle-orm";
import { uploadFile, deleteFile } from "../../services/s3";
import { DbType } from "../../types";
import { whitelabel_middleware } from "../../middleware/whitelabel";

export const bannersRoutes = new Elysia({ prefix: "/banners" })
  .resolve(async ({ request }): Promise<{ db: DbType; whitelabel: any }> => {
    const { db, whitelabel } = await whitelabel_middleware(request);
    return { db: db as DbType, whitelabel };
  })
  .get("/", async ({ set, db }) => {
    const allBanners = await db.select().from(banners);
    set.status = 200;
    return { success: true, data: allBanners };
  })
  .post(
    "/",
    async ({ body, set, db }) => {
      try {
        if (!body.title?.trim()) {
          set.status = 400;
          return { success: false, error: "Title is required" };
        }

        if (!body.image) {
          set.status = 400;
          return { success: false, error: "Image is required" };
        }

        const imageUrl = await uploadFile(body.image, "banners");

        const [banner] = await db
          .insert(banners)
          .values({
            title: body.title,
            imageUrl,
            linkUrl: body.linkUrl || null,
            position: body.position || "home",
            order: body.order ? parseInt(body.order) : 1,
            status: body.status || "active",
          })
          .returning();

        set.status = 201;
        return { success: true, data: banner };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to create banner",
        };
      }
    },
    {
      body: t.Object({
        title: t.String({ minLength: 1, maxLength: 255 }),
        image: t.File(),
        linkUrl: t.Optional(t.String()),
        position: t.Optional(t.String({ maxLength: 50 })),
        order: t.Optional(t.String()),
        status: t.Optional(t.String()),
      }),
    }
  )

  .put(
    "/:id",
    async ({ body, params, set, db }) => {
      try {
        const [existing] = await db
          .select()
          .from(banners)
          .where(eq(banners.id, parseInt(params.id)));

        if (!existing) {
          set.status = 404;
          return { success: false, error: "Banner not found" };
        }

        const updateData: any = {
          updatedAt: new Date(),
        };

        if (body.title) updateData.title = body.title;
        if (body.linkUrl !== undefined) updateData.linkUrl = body.linkUrl;
        if (body.position) updateData.position = body.position;
        if (body.order) updateData.order = parseInt(body.order);
        if (body.status) updateData.status = body.status;

        if (body.image && typeof body.image !== "string") {
          const newImageUrl = await uploadFile(body.image, "banners");
          if (existing.imageUrl) {
            try {
              await deleteFile(existing.imageUrl);
            } catch (error) {
              console.warn("Failed to delete old banner:");
            }
          }
          updateData.imageUrl = newImageUrl;
        } else if (body.image && typeof body.image === "string") {
          updateData.imageUrl = body.image;
        }

        const [updated] = await db
          .update(banners)
          .set(updateData)
          .where(eq(banners.id, parseInt(params.id)))
          .returning();
        set.status = 200;
        return { success: true, data: updated };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to update banner",
        };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        title: t.Optional(t.String()),
        image: t.Optional(t.Union([t.File(), t.String()])),
        linkUrl: t.Optional(t.String()),
        position: t.Optional(t.String()),
        order: t.Optional(t.String()),
        status: t.Optional(t.String()),
      }),
    }
  )

  .delete("/:id", async ({ params, set, db }) => {
    const [existing] = await db
      .select()
      .from(banners)
      .where(eq(banners.id, parseInt(params.id)));

    if (existing?.imageUrl) {
      try {
        await deleteFile(existing.imageUrl);
      } catch (error) {
        console.warn("Failed to delete banner image:");
      }
    }

    await db.delete(banners).where(eq(banners.id, parseInt(params.id)));
    set.status = 200;
    return { success: true };
  });
