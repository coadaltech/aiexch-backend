import { Elysia, t } from "elysia";
import { db } from "../../db";
import { matkaShifts, matkaTransactions, matkaTransactionDetails, SYSTEM_USER_ID } from "../../db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { RecordStatus } from "../../types/enums";

export const matkaOwnerRoutes = new Elysia({ prefix: "/matka" })

  // ── List all shifts (with optional date filter) ───────────────────────────
  .get("/shifts", async ({ set, query }) => {
    try {
      const conditions = [eq(matkaShifts.recordStatus, RecordStatus.Active)];

      if (query?.date) {
        conditions.push(eq(matkaShifts.shiftDate, query.date));
      }

      const shifts = await db
        .select()
        .from(matkaShifts)
        .where(and(...conditions))
        .orderBy(desc(matkaShifts.shiftDate), matkaShifts.shiftOrder);

      return { success: true, data: shifts };
    } catch (error) {
      set.status = 500;
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch shifts",
      };
    }
  })

  // ── Create a new shift ────────────────────────────────────────────────────
  .post(
    "/shifts",
    async ({ body, set, store }) => {
      try {
        const [shift] = await db
          .insert(matkaShifts)
          .values({
            name: body.name,
            shiftDate: body.shiftDate,
            endTime: body.endTime,
            shiftOrder: body.shiftOrder ?? 0,
            daraRate: String(body.daraRate ?? 0),
            daraCommission: String(body.daraCommission ?? 0),
            akharRate: String(body.akharRate ?? 0),
            akharCommission: String(body.akharCommission ?? 0),
            mainJantriTime: body.mainJantriTime || null,
            isActive: body.isActive ?? true,
            addedBy: (store as any).id || SYSTEM_USER_ID,
            updateBy: (store as any).id || SYSTEM_USER_ID,
          })
          .returning();

        set.status = 201;
        return { success: true, data: shift };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to create shift",
        };
      }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 100 }),
        shiftDate: t.String(),
        endTime: t.String(),
        shiftOrder: t.Optional(t.Number()),
        daraRate: t.Optional(t.Number()),
        daraCommission: t.Optional(t.Number()),
        akharRate: t.Optional(t.Number()),
        akharCommission: t.Optional(t.Number()),
        mainJantriTime: t.Optional(t.String()),
        isActive: t.Optional(t.Boolean()),
      }),
    }
  )

  // ── Update a shift ────────────────────────────────────────────────────────
  .put(
    "/shifts/:id",
    async ({ body, params, set, store }) => {
      try {
        const [existing] = await db
          .select()
          .from(matkaShifts)
          .where(eq(matkaShifts.id, params.id));

        if (!existing) {
          set.status = 404;
          return { success: false, error: "Shift not found" };
        }

        const updateData: Record<string, any> = {
          updateBy: (store as any).id || SYSTEM_USER_ID,
        };

        if (body.name !== undefined) updateData.name = body.name;
        if (body.shiftDate !== undefined) updateData.shiftDate = body.shiftDate;
        if (body.endTime !== undefined) updateData.endTime = body.endTime;
        if (body.shiftOrder !== undefined) updateData.shiftOrder = body.shiftOrder;
        if (body.daraRate !== undefined) updateData.daraRate = String(body.daraRate);
        if (body.daraCommission !== undefined) updateData.daraCommission = String(body.daraCommission);
        if (body.akharRate !== undefined) updateData.akharRate = String(body.akharRate);
        if (body.akharCommission !== undefined) updateData.akharCommission = String(body.akharCommission);
        if (body.mainJantriTime !== undefined) updateData.mainJantriTime = body.mainJantriTime;
        if (body.isActive !== undefined) updateData.isActive = body.isActive;

        const [updated] = await db
          .update(matkaShifts)
          .set(updateData)
          .where(eq(matkaShifts.id, params.id))
          .returning();

        return { success: true, data: updated };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to update shift",
        };
      }
    },
    {
      body: t.Object({
        name: t.Optional(t.String()),
        shiftDate: t.Optional(t.String()),
        endTime: t.Optional(t.String()),
        shiftOrder: t.Optional(t.Number()),
        daraRate: t.Optional(t.Number()),
        daraCommission: t.Optional(t.Number()),
        akharRate: t.Optional(t.Number()),
        akharCommission: t.Optional(t.Number()),
        mainJantriTime: t.Optional(t.String()),
        isActive: t.Optional(t.Boolean()),
      }),
    }
  )

  // ── Delete a shift (soft delete) ──────────────────────────────────────────
  .delete("/shifts/:id", async ({ params, set, store }) => {
    try {
      const [updated] = await db
        .update(matkaShifts)
        .set({
          recordStatus: RecordStatus.Deleted,
          updateBy: (store as any).id || SYSTEM_USER_ID,
        })
        .where(eq(matkaShifts.id, params.id))
        .returning();

      if (!updated) {
        set.status = 404;
        return { success: false, error: "Shift not found" };
      }

      return { success: true, data: updated };
    } catch (error) {
      set.status = 500;
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to delete shift",
      };
    }
  })

  // ── Set shift result ──────────────────────────────────────────────────────
  .post(
    "/shifts/:id/result",
    async ({ body, params, set, store }) => {
      try {
        const [updated] = await db
          .update(matkaShifts)
          .set({
            result: body.result,
            updateBy: (store as any).id || SYSTEM_USER_ID,
          })
          .where(eq(matkaShifts.id, params.id))
          .returning();

        if (!updated) {
          set.status = 404;
          return { success: false, error: "Shift not found" };
        }

        return { success: true, data: updated };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to set result",
        };
      }
    },
    {
      body: t.Object({
        result: t.Number({ minimum: 0, maximum: 100 }),
      }),
    }
  )

  // ── Get jantri summary for a shift (admin view with totals) ───────────────
  .get("/shifts/:id/jantri", async ({ params, set }) => {
    try {
      const totals = await db
        .select({
          number: matkaTransactionDetails.number,
          numberType: matkaTransactionDetails.numberType,
          totalAmount: sql<string>`SUM(CAST(${matkaTransactionDetails.amount} AS NUMERIC))`,
          betCount: sql<number>`COUNT(*)`,
        })
        .from(matkaTransactionDetails)
        .innerJoin(
          matkaTransactions,
          eq(matkaTransactionDetails.transactionId, matkaTransactions.id)
        )
        .where(
          and(
            eq(matkaTransactions.shiftId, params.id),
            eq(matkaTransactions.recordStatus, RecordStatus.Active),
            eq(matkaTransactionDetails.recordStatus, RecordStatus.Active)
          )
        )
        .groupBy(matkaTransactionDetails.number, matkaTransactionDetails.numberType);

      return { success: true, data: totals };
    } catch (error) {
      set.status = 500;
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch jantri",
      };
    }
  });
