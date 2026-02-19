import { Elysia, t } from "elysia";
import { db } from "../../db";
import { domains as domainsTable } from "../../db/schema";
import { eq } from "drizzle-orm";

export const domainsRoutes = (app: Elysia) =>
  app.group("/domains", (domainsGroup) =>
    domainsGroup
      // Get all domains
      .get("/", async ({ set }) => {
        try {
          const dbDomains = await db.select().from(domainsTable);
          set.status = 200;
          return { result: dbDomains };
        } catch (error: any) {
          set.status = 500;
          return { error: error.message };
        }
      })

      // Create domain
      .post("/", async ({ body, set }) => {
        try {
          const { name } = body as any;

          if (!name) {
            set.status = 400;
            return { error: "Domain name is required" };
          }

          const [domain] = await db
            .insert(domainsTable)
            .values({
              name,
              status: "active",
            })
            .returning();

          set.status = 201;
          return { success: true, result: domain };
        } catch (error: any) {
          set.status = 500;
          return { error: error.message };
        }
      })

      // Update domain
      .put("/:domainId", async ({ params, body, set }) => {
        try {
          const { domainId } = params;
          const { name, status } = body as any;
          
          const [domain] = await db.update(domainsTable)
            .set({ name, status, updatedAt: new Date() })
            .where(eq(domainsTable.id, parseInt(domainId)))
            .returning();
          
          set.status = 200;
          return { success: true, result: domain };
        } catch (error: any) {
          set.status = 500;
          return { error: error.message };
        }
      })

      // Delete domain
      .delete("/:domainId", async ({ params, set }) => {
        try {
          const { domainId } = params;

          await db
            .delete(domainsTable)
            .where(eq(domainsTable.id, parseInt(domainId)));

          set.status = 200;
          return { success: true };
        } catch (error: any) {
          set.status = 500;
          return { error: error.message };
        }
      })
  );
