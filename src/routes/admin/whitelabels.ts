import { Elysia, t } from "elysia";
import { db } from "../../db";
import { whitelabels } from "../../db/schema";
import { eq } from "drizzle-orm";
import { uploadFile, deleteFile } from "../../services/s3";
import { exec } from "child_process";
import { promisify } from "util";
import postgres from "postgres";

const execAsync = promisify(exec);

export const whitelabelsRoutes = new Elysia({ prefix: "/whitelabels" })
  .get("/", async ({ set }) => {
    const allWhitelabels = await db.select().from(whitelabels);
    const parsedWhitelabels = allWhitelabels.map((wl) => ({
      ...wl,
      theme: typeof wl.theme === "string" ? JSON.parse(wl.theme) : wl.theme,
      layout: typeof wl.layout === "string" ? JSON.parse(wl.layout) : wl.layout,
      config: typeof wl.config === "string" ? JSON.parse(wl.config) : wl.config,
      preferences:
        typeof wl.preferences === "string"
          ? JSON.parse(wl.preferences)
          : wl.preferences,
      permissions:
        typeof wl.permissions === "string"
          ? JSON.parse(wl.permissions)
          : wl.permissions,
      socialLinks:
        typeof wl.socialLinks === "string"
          ? JSON.parse(wl.socialLinks)
          : wl.socialLinks,
    }));
    set.status = 200;
    return { success: true, data: parsedWhitelabels };
  })

  .post(
    "/",
    async ({ body, set }) => {
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

      const [whitelabel] = await db
        .insert(whitelabels)
        .values({
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
      set.status = 201;
      return { success: true, data: whitelabel };
    },
    {
      body: t.Object({
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
    async ({ params, body, set }) => {
      const [existing] = await db
        .select()
        .from(whitelabels)
        .where(eq(whitelabels.id, parseInt(params.id)));

      if (!existing) {
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

      const [updated] = await db
        .update(whitelabels)
        .set({
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
          updatedAt: new Date(),
        })
        .where(eq(whitelabels.id, parseInt(params.id)))
        .returning();
      set.status = 200;
      return { success: true, data: updated };
    },
    {
      body: t.Object({
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

  .delete("/:id", async ({ params, set }) => {
    const [existing] = await db
      .select()
      .from(whitelabels)
      .where(eq(whitelabels.id, parseInt(params.id)));

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

    await db.delete(whitelabels).where(eq(whitelabels.id, parseInt(params.id)));
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
  )

  .post("/db/generate/:id", async ({ params, set }) => {
    try {
      const [whitelabel] = await db
        .select()
        .from(whitelabels)
        .where(eq(whitelabels.id, parseInt(params.id)));

      if (!whitelabel) {
        set.status = 404;
        return { success: false, message: "Whitelabel not found" };
      }

      const config =
        typeof whitelabel.config === "string"
          ? JSON.parse(whitelabel.config)
          : whitelabel.config;

      const dbName =
        config.dbName || whitelabel.name.toLowerCase().replace(/\s+/g, "_");
      const dbUrl = `${process.env.DATABASE_BASE_URL}/${dbName}`;

      const { stdout } = await execAsync("npm run db:generate", {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: dbUrl },
      });

      set.status = 200;
      return {
        success: true,
        message: `Schema generated for ${whitelabel.name} (${dbName})`,
        output: stdout,
      };
    } catch (error: any) {
      set.status = 500;
      return {
        success: false,
        message: "Failed to generate database schema",
        error: error.message,
      };
    }
  })

  .post("/db/migrate/:id", async ({ params, set }) => {
    try {
      const [whitelabel] = await db
        .select()
        .from(whitelabels)
        .where(eq(whitelabels.id, parseInt(params.id)));

      if (!whitelabel) {
        set.status = 404;
        return { success: false, message: "Whitelabel not found" };
      }

      const config =
        typeof whitelabel.config === "string"
          ? JSON.parse(whitelabel.config)
          : whitelabel.config;

      const dbName =
        config.dbName || whitelabel.name.toLowerCase().replace(/\s+/g, "_");

      const adminDb = postgres(process.env.DATABASE_BASE_URL + "/postgres");
      await adminDb.unsafe(`CREATE DATABASE ${dbName}`);
      await adminDb.end();

      const dbUrl = `${process.env.DATABASE_BASE_URL}/${dbName}`;
      const { stdout } = await execAsync("npm run db:migrate", {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: dbUrl },
      });

      set.status = 200;
      return {
        success: true,
        message: `Migration completed for ${whitelabel.name} (${dbName})`,
        output: stdout,
      };
    } catch (error: any) {
      set.status = 500;
      return {
        success: false,
        message: error.message || "Failed to run database migration",
      };
    }
  });
