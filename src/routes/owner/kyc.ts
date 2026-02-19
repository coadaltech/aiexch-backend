import { Elysia, t } from "elysia";
import { db } from "../../db";
import { kycDocuments } from "../../db/schema";
import { eq } from "drizzle-orm";

export const kycRoutes = new Elysia({ prefix: "/kyc" })
  .get("/", async ({ headers, set }) => {
    const allKyc = await db.select().from(kycDocuments);
    set.status = 200;
    return { success: true, data: allKyc };
  })

  .put(
    "/:id",
    async ({ params, body, headers, set }) => {
      const [updated] = await db
        .update(kycDocuments)
        .set({ status: body.status, reviewNotes: body.reviewNotes })
        .where(eq(kycDocuments.id, parseInt(params.id)))
        .returning();
      set.status = 200;
      return { success: true, data: updated };
    },
    {
      body: t.Object({
        status: t.String(),
        reviewNotes: t.Optional(t.String()),
      }),
    }
  );
