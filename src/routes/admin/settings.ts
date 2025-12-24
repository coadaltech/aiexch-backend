import { Elysia, t } from "elysia";
import { db } from "../../db";
import { settings } from "../../db/schema";
import { eq } from "drizzle-orm";
import { uploadFile, deleteFile } from "../../services/s3";

export const settingsRoutes = new Elysia({ prefix: "/settings" })
  .get("/", async ({ set }) => {
    const [siteSettings] = await db.select().from(settings).limit(1);
    if (siteSettings && siteSettings.theme) {
      set.status = 200;
      return {
        success: true,
        data: {
          ...siteSettings,
          theme:
            typeof siteSettings.theme === "string"
              ? JSON.parse(siteSettings.theme)
              : siteSettings.theme,
        },
      };
    }
    set.status = 200;
    return { success: true, data: {} };
  })

  .put(
    "/",
    async ({ body, set }) => {
      try {
        const [existing] = await db.select().from(settings).limit(1);
        const updateData: any = { ...body };

        // Convert string booleans from FormData to actual booleans
        if (typeof updateData.maintenanceMode === "string") {
          updateData.maintenanceMode = updateData.maintenanceMode === "true";
        }

        // Handle file uploads
        if (body.logo && typeof body.logo !== "string") {
          updateData.logo = await uploadFile(body.logo, "settings/logos");
          if (existing?.logo) {
            try {
              await deleteFile(existing.logo);
            } catch (err) {
              console.warn("Failed to delete old logo:");
            }
          }
        }
        if (body.favicon && typeof body.favicon !== "string") {
          updateData.favicon = await uploadFile(
            body.favicon,
            "settings/favicons"
          );
          if (existing?.favicon) {
            try {
              await deleteFile(existing.favicon);
            } catch (err) {
              console.warn("Failed to delete old favicon:");
            }
          }
        }
        if (body.authImage && typeof body.authImage !== "string") {
          updateData.authImage = await uploadFile(
            body.authImage,
            "settings/auth"
          );
          if (existing?.authImage) {
            try {
              await deleteFile(existing.authImage);
            } catch (err) {
              console.warn("Failed to delete old authImage:");
            }
          }
        }

        if (existing) {
          const [updated] = await db
            .update(settings)
            .set({ ...updateData, updatedAt: new Date() })
            .where(eq(settings.id, existing.id))
            .returning();
          set.status = 200;
          return { success: true, data: updated };
        } else {
          const [created] = await db
            .insert(settings)
            .values(updateData)
            .returning();
          set.status = 201;
          return { success: true, data: created };
        }
      } catch (error) {
        console.error("Settings update error:");
        set.status = 500;
        return { success: false, error: "Failed to update settings" };
      }
    },
    {
      body: t.Object({
        siteName: t.Optional(t.String()),
        logo: t.Optional(t.Union([t.File({ type: "image/*" }), t.String()])),
        favicon: t.Optional(t.Union([t.File({ type: "image/*" }), t.String()])),
        authImage: t.Optional(
          t.Union([t.File({ type: "image/*" }), t.String()])
        ),
        theme: t.Optional(t.String()),
        maintenanceMode: t.Optional(t.Union([t.Boolean(), t.String()])),
        maintenanceMessage: t.Optional(t.String()),
      }),
    }
  );
