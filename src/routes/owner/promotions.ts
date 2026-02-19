import { Elysia, t } from "elysia";
import { promotions } from "../../db/schema";
import { eq } from "drizzle-orm";
import { deleteFile, uploadFile } from "../../services/s3";
import { DbType } from "../../types";
import { whitelabel_middleware } from "../../middleware/whitelabel";

export const promotionsRoutes = new Elysia({ prefix: "/promotions" })
  .resolve(async ({ request }): Promise<{ db: DbType; whitelabel: any }> => {
    const { db, whitelabel } = await whitelabel_middleware(request);
    return { db: db as DbType, whitelabel };
  })
  .get("/", async ({ set, db }) => {
    const allPromotions = await db.select().from(promotions);
    set.status = 200;
    return { success: true, data: allPromotions };
  })

  .post(
    "/",
    async ({ body, set, db }) => {
      try {
        if (!body.title?.trim() || !body.type?.trim()) {
          set.status = 400;
          return { success: false, message: "Title and type are required" };
        }
        const values: {
          title: string;
          description: string;
          type: string;
          status: string;
          imageUrl?: string;
        } = {
          title: body.title,
          description: body.description,
          type: body.type,
          status: body.status || "active",
        };

        // Upload image if provided
        if (body.imageUrl) {
          values.imageUrl = await uploadFile(body.imageUrl);
        }

        const [promotion] = await db
          .insert(promotions)
          .values(values)
          .returning();

        set.status = 201;
        return { success: true, data: promotion };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to create promotion",
        };
      }
    },
    {
      body: t.Object({
        title: t.String({ minLength: 1, maxLength: 255 }),
        description: t.String({ maxLength: 1000 }),
        type: t.String({ minLength: 1, maxLength: 50 }),
        imageUrl: t.File(),
        status: t.String(),
      }),
    }
  )

  .put(
    "/:id",
    async ({ params, body, set, db }) => {
      try {
        const [current] = await db
          .select()
          .from(promotions)
          .where(eq(promotions.id, parseInt(params.id)));



        if (!current) {
          set.status = 404;
          return { success: false, error: "Promotion not found" };
        }

        const updateData: Record<string, any> = { updatedAt: new Date() };

        // Delete image if explicitly set to null
        if (body.imageUrl === null && current.imageUrl) {
          try {
            await deleteFile(current.imageUrl);
          } catch (err) {
            console.warn("Failed to delete image:");
          }
          updateData.imageUrl = null;
        }

        // Upload new image if provided (File object)
        if (body.imageUrl && typeof body.imageUrl !== "string") {

          const newImageUrl = await uploadFile(body.imageUrl);
          if (current.imageUrl) {
            try {

              await deleteFile(current.imageUrl);
            } catch (err) {
              console.warn("Failed to delete old image:");
            }
          }
          updateData.imageUrl = newImageUrl;
        } else if (body.imageUrl && typeof body.imageUrl === "string") {
          // Keep existing image URL
          updateData.imageUrl = body.imageUrl;
        }

        // Add other fields if provided
        if (body.title !== undefined) updateData.title = body.title;
        if (body.description !== undefined)
          updateData.description = body.description;
        if (body.type !== undefined) updateData.type = body.type;
        if (body.status !== undefined) updateData.status = body.status;

        const [updated] = await db
          .update(promotions)
          .set(updateData)
          .where(eq(promotions.id, parseInt(params.id)))
          .returning();

        set.status = 200;
        return { success: true, data: updated };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to update promotion",
        };
      }
    },
    {
      body: t.Object({
        title: t.Optional(t.String()),
        description: t.Optional(t.String()),
        type: t.Optional(t.String()),
        imageUrl: t.Optional(t.Union([t.File(), t.String()])),
        status: t.Optional(t.String()),
      }),
    }
  )

  // Delete promotion and associated image
  .delete("/:id", async ({ params, set, db }) => {
    const [current] = await db
      .select()
      .from(promotions)
      .where(eq(promotions.id, parseInt(params.id)));

    if (!current) {
      set.status = 404;
      return { success: false, error: "Promotion not found" };
    }

    if (current.imageUrl) {
      try {
        await deleteFile(current.imageUrl);
      } catch (err) {
        console.warn("Failed to delete image:");
      }
    }

    await db.delete(promotions).where(eq(promotions.id, parseInt(params.id)));
    set.status = 200;
    return { success: true };
  });
