import { Elysia, t } from "elysia";
import { popups } from "../../db/schema";
import { eq } from "drizzle-orm";
import { uploadFile, deleteFile } from "../../services/s3";
import { DbType } from "../../types";
import { whitelabel_middleware } from "../../middleware/whitelabel";

export const popupsRoutes = new Elysia({ prefix: "/popups" })
  .resolve(async ({ request }): Promise<{ db: DbType; whitelabel: any }> => {
    const { db, whitelabel } = await whitelabel_middleware(request);
    return { db: db as DbType, whitelabel };
  })
  .get("/", async ({ set, db }) => {
    const allPopups = await db.select().from(popups);
    set.status = 200;
    return { success: true, data: allPopups };
  })

  .post(
    "/",
    async ({ body, set, db }) => {
      try {
        // Check if popup already exists for this page
        const existing = await db
          .select()
          .from(popups)
          .where(eq(popups.targetPage, body.targetPage));

        if (existing.length > 0) {
          set.status = 409;
          return {
            success: false,
            error: `A popup already exists for ${body.targetPage}. Please delete or edit the existing one.`,
          };
        }

        if (!body.image) {
          set.status = 400;
          return { success: false, error: "Image is required" };
        }

        const imageUrl = await uploadFile(body.image, "popups");

        const [popup] = await db
          .insert(popups)
          .values({
            title: body.title,
            imageUrl,
            targetPage: body.targetPage,
            status: body.status || "active",
          })
          .returning();

        set.status = 201;
        return { success: true, data: popup };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to create popup",
        };
      }
    },
    {
      body: t.Object({
        title: t.String(),
        image: t.File(),
        targetPage: t.String(),
        status: t.Optional(t.String()),
      }),
    }
  )

  .put(
    "/:id",
    async ({ params, body, db, set }) => {
      try {
        const [existing] = await db
          .select()
          .from(popups)
          .where(eq(popups.id, parseInt(params.id)));

        if (!existing) {
          set.status = 404;
          return { success: false, error: "Popup not found" };
        }

        // Check if popup already exists for this page (excluding current popup)
        if (body.targetPage) {
          const existingPage = await db
            .select()
            .from(popups)
            .where(eq(popups.targetPage, body.targetPage));

          if (
            existingPage.length > 0 &&
            existingPage[0].id !== parseInt(params.id)
          ) {
            set.status = 409;
            return {
              success: false,
              error: `A popup already exists for ${body.targetPage}. Please delete or edit the existing one.`,
            };
          }
        }

        const updateData: any = {
          updatedAt: new Date(),
        };

        if (body.title) updateData.title = body.title;
        if (body.targetPage) updateData.targetPage = body.targetPage;
        if (body.status) updateData.status = body.status;

        if (body.image && typeof body.image !== "string") {
          const newImageUrl = await uploadFile(body.image, "popups");
          if (existing.imageUrl) {
            try {
              await deleteFile(existing.imageUrl);
            } catch (error) {
              console.warn("Failed to delete old popup:");
            }
          }
          updateData.imageUrl = newImageUrl;
        } else if (body.image && typeof body.image === "string") {
          updateData.imageUrl = body.image;
        }

        const [updated] = await db
          .update(popups)
          .set(updateData)
          .where(eq(popups.id, parseInt(params.id)))
          .returning();
        set.status = 200;
        return { success: true, data: updated };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to update popup",
        };
      }
    },
    {
      body: t.Object({
        title: t.Optional(t.String()),
        image: t.Optional(t.Union([t.File(), t.String()])),
        targetPage: t.Optional(t.String()),
        status: t.Optional(t.String()),
      }),
    }
  )

  .delete("/:id", async ({ params, db, set }) => {
    const [existing] = await db
      .select()
      .from(popups)
      .where(eq(popups.id, parseInt(params.id)));

    if (existing?.imageUrl) {
      try {
        await deleteFile(existing.imageUrl);
      } catch (error) {
        console.warn("Failed to delete popup image:");
      }
    }

    await db.delete(popups).where(eq(popups.id, parseInt(params.id)));
    set.status = 200;
    return { success: true };
  });
