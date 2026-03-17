import { Elysia, t } from "elysia";
import { db } from "../../db";
import { whitelabels, users } from "../../db/schema";
import { eq } from "drizzle-orm";
import { uploadFile, deleteFile } from "../../services/s3";
import { resolveOwnerScope } from "../../utils/ownerScope";
import { addAllowedOrigin, removeAllowedOrigin } from "../../utils/cors-origins";
import { UserRole } from "../../types/enums";

export const whitelabelsRoutes = new Elysia({ prefix: "/whitelabels" })
  .get("/", async ({ set, store }) => {
    const scope = await resolveOwnerScope(db, undefined, store as { id?: string; role?: string });
    let query = db
      .select({
        whitelabel: whitelabels,
        user: {
          id: users.id,
          username: users.username,
          email: users.email,
        },
      })
      .from(whitelabels)
      .leftJoin(users, eq(whitelabels.userId, users.id));
    if (scope.currentUserRole !== UserRole.Owner && scope.scopeWhitelabelId != null) {
      const rows = await query.where(eq(whitelabels.id, scope.scopeWhitelabelId));
      const parsedWhitelabels = rows.map((row) => ({
        ...row.whitelabel,
        user: row.user,
        theme: typeof row.whitelabel.theme === "string" ? JSON.parse(row.whitelabel.theme) : row.whitelabel.theme,
        layout: typeof row.whitelabel.layout === "string" ? JSON.parse(row.whitelabel.layout) : row.whitelabel.layout,
        config: typeof row.whitelabel.config === "string" ? JSON.parse(row.whitelabel.config) : row.whitelabel.config,
        preferences:
          typeof row.whitelabel.preferences === "string"
            ? JSON.parse(row.whitelabel.preferences)
            : row.whitelabel.preferences,
        permissions:
          typeof row.whitelabel.permissions === "string"
            ? JSON.parse(row.whitelabel.permissions)
            : row.whitelabel.permissions,
        socialLinks:
          typeof row.whitelabel.socialLinks === "string"
            ? JSON.parse(row.whitelabel.socialLinks)
            : row.whitelabel.socialLinks,
      }));
      set.status = 200;
      return { success: true, data: parsedWhitelabels };
    }
    const allWhitelabels = await query;
    const parsedWhitelabels = allWhitelabels.map((row) => ({
      ...row.whitelabel,
      user: row.user,
      theme: typeof row.whitelabel.theme === "string" ? JSON.parse(row.whitelabel.theme) : row.whitelabel.theme,
      layout: typeof row.whitelabel.layout === "string" ? JSON.parse(row.whitelabel.layout) : row.whitelabel.layout,
      config: typeof row.whitelabel.config === "string" ? JSON.parse(row.whitelabel.config) : row.whitelabel.config,
      preferences:
        typeof row.whitelabel.preferences === "string"
          ? JSON.parse(row.whitelabel.preferences)
          : row.whitelabel.preferences,
      permissions:
        typeof row.whitelabel.permissions === "string"
          ? JSON.parse(row.whitelabel.permissions)
          : row.whitelabel.permissions,
      socialLinks:
        typeof row.whitelabel.socialLinks === "string"
          ? JSON.parse(row.whitelabel.socialLinks)
          : row.whitelabel.socialLinks,
    }));
    set.status = 200;
    return { success: true, data: parsedWhitelabels };
  })

  .post(
    "/",
    async ({ body, set, store }) => {
      try {
        const scope = await resolveOwnerScope(db, undefined, store as { id?: string; role?: string });
        console.log("Lo mai a gya...")
        if (scope.currentUserRole !== UserRole.Owner) {
          set.status = 403;
          return { success: false, message: "Only owner can create whitelabels." };
        }
        let logoUrl = body.logoUrl;
        let faviconUrl = body.faviconUrl;

        if (body.logo) {
          const key = `whitelabels/logos/${Date.now()}-${body.logo.name}`;
          logoUrl = await uploadFile(body.logo, key);
        }

        if (body.favicon) {
          const key = `whitelabels/favicons/${Date.now()}-${body.favicon.name}`;
          faviconUrl = await uploadFile(body.favicon, key);
        }

        const config = body.config ? JSON.parse(body.config) : {};
        if (!config.dbName) {
          config.dbName = body.name.toLowerCase().replace(/\s+/g, "_");
        }

        // Parse userId from string to number (FormData sends everything as strings)
        // const userId = typeof body.userId === "string" ? parseInt(body.userId, 10) : body.userId;
        const userId = String(body.userId)
        console.log(userId)

        const [whitelabel] = await db
          .insert(whitelabels)
          .values({
            userId: userId,
            whitelabelType: body.whitelabelType || "B2C",
            name: body.name,
            domain: body.domain,
            title: body.title,
            description: body.description,
            logo: logoUrl,
            favicon: faviconUrl,
            contactEmail: body.contactEmail,
            socialLinks: body.socialLinks,
            status: body.status,
            theme: body.theme,
            layout: body.layout,
            config: JSON.stringify(config),
            preferences: body.preferences,
            permissions: body.permissions,
          })
          .returning();

        // Link the selected user (admin) to this whitelabel
        await db
          .update(users)
          .set({ whitelabelId: whitelabel.id })
          .where(eq(users.id, userId));

        // Immediately allow this domain in CORS without a server restart
        if (whitelabel.domain) addAllowedOrigin(whitelabel.domain);

        set.status = 201;
        return { success: true, data: whitelabel };
      } catch (e) {
        console.log("Error occur");
        console.log(e)
        return { success: false, data: { message: "failed to create whitelabel" } }
      }
    },
    {
      body: t.Object({
        userId: t.Union([t.Number(), t.String()]), // Accept both number and string (FormData sends strings)
        whitelabelType: t.Optional(t.Union([t.Literal("B2B"), t.Literal("B2C")])),
        name: t.String(),
        domain: t.String(),
        title: t.Optional(t.String()),
        description: t.Optional(t.String()),
        logo: t.Optional(t.File()),
        logoUrl: t.Optional(t.String()),
        favicon: t.Optional(t.File()),
        faviconUrl: t.Optional(t.String()),
        contactEmail: t.Optional(t.String()),
        socialLinks: t.Optional(t.String()),
        status: t.Optional(t.String()),
        theme: t.Optional(t.String()),
        layout: t.Optional(t.String()),
        config: t.Optional(t.String()),
        preferences: t.Optional(t.String()),
        permissions: t.Optional(t.String()),
      }),
    }
  )

  .put(
    "/:id",
    async ({ params, body, set, store }) => {
      const scope = await resolveOwnerScope(db, undefined, store as { id?: string; role?: string });
      const [existing] = await db
        .select()
        .from(whitelabels)
        .where(eq(whitelabels.id, params.id));

      if (!existing) {
        set.status = 404;
        return { success: false, error: "Whitelabel not found" };
      }
      if (scope.currentUserRole !== UserRole.Owner && scope.scopeWhitelabelId !== existing.id) {
        set.status = 404;
        return { success: false, error: "Whitelabel not found" };
      }

      let logoUrl = existing.logo;
      let faviconUrl = existing.favicon;

      if (body.logo && typeof body.logo !== "string") {
        const key = `whitelabels/logos/${Date.now()}-${body.logo.name}`;
        logoUrl = await uploadFile(body.logo, key);
        if (existing.logo) {
          try {
            await deleteFile(existing.logo);
          } catch (err) {
            console.warn("Failed to delete old logo:");
          }
        }
      } else if (body.logoUrl) {
        logoUrl = body.logoUrl;
      }

      if (body.favicon && typeof body.favicon !== "string") {
        const key = `whitelabels/favicons/${Date.now()}-${body.favicon.name}`;
        faviconUrl = await uploadFile(body.favicon, key);
        if (existing.favicon) {
          try {
            await deleteFile(existing.favicon);
          } catch (err) {
            console.warn("Failed to delete old favicon:");
          }
        }
      } else if (body.faviconUrl) {
        faviconUrl = body.faviconUrl;
      }

      const updateData: any = {
        name: body.name,
        domain: body.domain,
        title: body.title,
        description: body.description,
        logo: logoUrl,
        favicon: faviconUrl,
        contactEmail: body.contactEmail,
        socialLinks: body.socialLinks,
        status: body.status,
        theme: body.theme,
        layout: body.layout,
        config: body.config,
        preferences: body.preferences,
        permissions: body.permissions,
        updateDate: new Date(),
      };

      // if (body.userId !== undefined) {
      //   // Parse userId from string to number (FormData sends everything as strings)
      //   updateData.userId = typeof body.userId === "string" ? parseInt(body.userId, 10) : body.userId;
      // }

      if (body.whitelabelType !== undefined) {
        updateData.whitelabelType = body.whitelabelType;
      }

      const [updated] = await db
        .update(whitelabels)
        .set(updateData)
        .where(eq(whitelabels.id, params.id))
        .returning();

      // Keep CORS allow-list in sync when the domain changes
      if (body.domain && body.domain !== existing.domain) {
        if (existing.domain) removeAllowedOrigin(existing.domain);
        addAllowedOrigin(body.domain);
      }

      set.status = 200;
      return { success: true, data: updated };
    },
    {
      body: t.Object({
        userId: t.Optional(t.Union([t.Number(), t.String()])), // Accept both number and string (FormData sends strings)
        whitelabelType: t.Optional(t.Union([t.Literal("B2B"), t.Literal("B2C")])),
        name: t.Optional(t.String()),
        domain: t.Optional(t.String()),
        title: t.Optional(t.String()),
        description: t.Optional(t.String()),
        logo: t.Optional(t.Union([t.File(), t.String()])),
        logoUrl: t.Optional(t.String()),
        favicon: t.Optional(t.Union([t.File(), t.String()])),
        faviconUrl: t.Optional(t.String()),
        contactEmail: t.Optional(t.String()),
        socialLinks: t.Optional(t.String()),
        status: t.Optional(t.String()),
        theme: t.Optional(t.String()),
        layout: t.Optional(t.String()),
        config: t.Optional(t.String()),
        preferences: t.Optional(t.String()),
        permissions: t.Optional(t.String()),
      }),
    }
  )

  .delete("/:id", async ({ params, set, store }) => {
    const scope = await resolveOwnerScope(db, undefined, store as { id?: string; role?: string });
    const [existing] = await db
      .select()
      .from(whitelabels)
      .where(eq(whitelabels.id, params.id));

    if (!existing) {
      set.status = 404;
      return { success: false, error: "Whitelabel not found" };
    }
    if (scope.currentUserRole !== UserRole.Owner && scope.scopeWhitelabelId !== existing.id) {
      set.status = 404;
      return { success: false, error: "Whitelabel not found" };
    }

    if (existing) {
      if (existing.logo) {
        try {
          await deleteFile(existing.logo);
        } catch (err) {
          console.warn("Failed to delete logo:");
        }
      }
      if (existing.favicon) {
        try {
          await deleteFile(existing.favicon);
        } catch (err) {
          console.warn("Failed to delete favicon:");
        }
      }
    }

    await db.delete(whitelabels).where(eq(whitelabels.id, params.id));

    // Remove the domain from the CORS allow-list
    if (existing.domain) removeAllowedOrigin(existing.domain);

    set.status = 200;
    return { success: true };
  })

  .post(
    "/upload-logo",
    async ({ body, set }) => {
      const { file } = body;

      if (!file) {
        set.status = 400;
        return { success: false, message: "No file provided" };
      }

      const key = `whitelabels/logos/${Date.now()}-${file.name}`;
      const url = await uploadFile(file, key);

      set.status = 201;
      return { success: true, url, key };
    },
    {
      body: t.Object({
        file: t.File(),
      }),
    }
  );
