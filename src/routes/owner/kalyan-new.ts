import { Elysia, t } from "elysia";
import { db } from "../../db";
import {
  matkaShifts,
  matkaTransactions,
  matkaTransactionDetails,
  SYSTEM_USER_ID,
} from "../../db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { RecordStatus, UserRole, MatkaSportType } from "../../types/enums";

const ownerOnly = ({ store, set }: any) => {
  if (store.role !== UserRole.Owner) {
    set.status = 403;
    return { success: false, message: "Owner access only" };
  }
};

// Kalyan-New rate mapping (sport_type = 1005):
//   singlePanaRate / doublePanaRate / sangamRate → kalyan-new only columns
//   tripleRate  → triple pana
//   daraRate    → jodi
//   akharRate   → akhar
//   mainJantriTime → opening result time
//   closingTime    → closing result time (kalyan-new only, nullable)
export const kalyanNewOwnerRoutes = new Elysia({ prefix: "/kalyan-new" })

  // ── List all kalyan-new shifts ───────────────────────────────────────────
  .get("/shifts", async ({ set, query }) => {
    try {
      const conditions = [
        eq(matkaShifts.recordStatus, RecordStatus.Active),
        eq(matkaShifts.sportType, MatkaSportType.KalyanNew),
      ];

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

  // ── Create kalyan-new shift (owner only) ─────────────────────────────────
  .post(
    "/shifts",
    async ({ body, set, store }) => {
      try {
        const [maxOrder] = await db
          .select({ max: sql<number>`COALESCE(MAX(${matkaShifts.shiftOrder}), 0)` })
          .from(matkaShifts)
          .where(
            and(
              eq(matkaShifts.recordStatus, RecordStatus.Active),
              eq(matkaShifts.sportType, MatkaSportType.KalyanNew)
            )
          );

        const nextOrder = (maxOrder?.max ?? 0) + 1;

        const [shift] = await db
          .insert(matkaShifts)
          .values({
            name: body.name,
            sportType: MatkaSportType.KalyanNew,
            shiftDate: body.shiftDate,
            endTime: body.endTime,
            shiftOrder: nextOrder,
            singlePanaRate: String(body.singlePanaRate ?? 0),
            singlePanaCommission: String(body.singlePanaCommission ?? 0),
            doublePanaRate: String(body.doublePanaRate ?? 0),
            doublePanaCommission: String(body.doublePanaCommission ?? 0),
            tripleRate: String(body.tripleRate ?? 0),
            tripleCommission: String(body.tripleCommission ?? 0),
            daraRate: String(body.daraRate ?? 0),
            daraCommission: String(body.daraCommission ?? 0),
            akharRate: String(body.akharRate ?? 0),
            akharCommission: String(body.akharCommission ?? 0),
            sangamRate: String(body.sangamRate ?? 0),
            sangamCommission: String(body.sangamCommission ?? 0),
            mainJantriTime: body.mainJantriTime || null,
            closingTime: body.closingTime || null,
            isActive: body.isActive ?? true,
            nextDayAllow: body.nextDayAllow ?? false,
            capping: String(body.capping ?? 0),
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
      beforeHandle: ownerOnly,
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 100 }),
        shiftDate: t.String(),
        endTime: t.String(),
        singlePanaRate: t.Optional(t.Number()),
        singlePanaCommission: t.Optional(t.Number()),
        doublePanaRate: t.Optional(t.Number()),
        doublePanaCommission: t.Optional(t.Number()),
        tripleRate: t.Optional(t.Number()),
        tripleCommission: t.Optional(t.Number()),
        daraRate: t.Optional(t.Number()),
        daraCommission: t.Optional(t.Number()),
        akharRate: t.Optional(t.Number()),
        akharCommission: t.Optional(t.Number()),
        sangamRate: t.Optional(t.Number()),
        sangamCommission: t.Optional(t.Number()),
        mainJantriTime: t.Optional(t.String()),
        closingTime: t.Optional(t.String()),
        isActive: t.Optional(t.Boolean()),
        nextDayAllow: t.Optional(t.Boolean()),
        capping: t.Optional(t.Number()),
      }),
    }
  )

  // ── Reorder kalyan-new shifts (bulk) ─────────────────────────────────────
  .put(
    "/shifts/reorder",
    async ({ body, set, store }) => {
      try {
        const updates = body.orders.map((item) =>
          db
            .update(matkaShifts)
            .set({
              shiftOrder: item.shiftOrder,
              updateBy: (store as any).id || SYSTEM_USER_ID,
            })
            .where(
              and(
                eq(matkaShifts.id, item.id),
                eq(matkaShifts.sportType, MatkaSportType.KalyanNew)
              )
            )
        );

        await Promise.all(updates);

        return { success: true };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to reorder shifts",
        };
      }
    },
    {
      beforeHandle: ownerOnly,
      body: t.Object({
        orders: t.Array(
          t.Object({
            id: t.String(),
            shiftOrder: t.Number(),
          })
        ),
      }),
    }
  )

  // ── Update kalyan-new shift ──────────────────────────────────────────────
  .put(
    "/shifts/:id",
    async ({ body, params, set, store }) => {
      try {
        const [existing] = await db
          .select()
          .from(matkaShifts)
          .where(
            and(
              eq(matkaShifts.id, params.id),
              eq(matkaShifts.sportType, MatkaSportType.KalyanNew)
            )
          );

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
        if (body.singlePanaRate !== undefined) updateData.singlePanaRate = String(body.singlePanaRate);
        if (body.singlePanaCommission !== undefined) updateData.singlePanaCommission = String(body.singlePanaCommission);
        if (body.doublePanaRate !== undefined) updateData.doublePanaRate = String(body.doublePanaRate);
        if (body.doublePanaCommission !== undefined) updateData.doublePanaCommission = String(body.doublePanaCommission);
        if (body.tripleRate !== undefined) updateData.tripleRate = String(body.tripleRate);
        if (body.tripleCommission !== undefined) updateData.tripleCommission = String(body.tripleCommission);
        if (body.daraRate !== undefined) updateData.daraRate = String(body.daraRate);
        if (body.daraCommission !== undefined) updateData.daraCommission = String(body.daraCommission);
        if (body.akharRate !== undefined) updateData.akharRate = String(body.akharRate);
        if (body.akharCommission !== undefined) updateData.akharCommission = String(body.akharCommission);
        if (body.sangamRate !== undefined) updateData.sangamRate = String(body.sangamRate);
        if (body.sangamCommission !== undefined) updateData.sangamCommission = String(body.sangamCommission);
        if (body.mainJantriTime !== undefined) updateData.mainJantriTime = body.mainJantriTime;
        if (body.closingTime !== undefined) updateData.closingTime = body.closingTime;
        if (body.isActive !== undefined) updateData.isActive = body.isActive;
        if (body.nextDayAllow !== undefined) updateData.nextDayAllow = body.nextDayAllow;
        if (body.capping !== undefined) updateData.capping = String(body.capping);

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
      beforeHandle: ownerOnly,
      body: t.Object({
        name: t.Optional(t.String()),
        shiftDate: t.Optional(t.String()),
        endTime: t.Optional(t.String()),
        shiftOrder: t.Optional(t.Number()),
        singlePanaRate: t.Optional(t.Number()),
        singlePanaCommission: t.Optional(t.Number()),
        doublePanaRate: t.Optional(t.Number()),
        doublePanaCommission: t.Optional(t.Number()),
        tripleRate: t.Optional(t.Number()),
        tripleCommission: t.Optional(t.Number()),
        daraRate: t.Optional(t.Number()),
        daraCommission: t.Optional(t.Number()),
        akharRate: t.Optional(t.Number()),
        akharCommission: t.Optional(t.Number()),
        sangamRate: t.Optional(t.Number()),
        sangamCommission: t.Optional(t.Number()),
        mainJantriTime: t.Optional(t.String()),
        closingTime: t.Optional(t.String()),
        isActive: t.Optional(t.Boolean()),
        nextDayAllow: t.Optional(t.Boolean()),
        capping: t.Optional(t.Number()),
      }),
    }
  )

  // ── Soft delete kalyan-new shift ─────────────────────────────────────────
  .delete(
    "/shifts/:id",
    async ({ params, set, store }) => {
      try {
        const [updated] = await db
          .update(matkaShifts)
          .set({
            recordStatus: RecordStatus.Deleted,
            updateBy: (store as any).id || SYSTEM_USER_ID,
          })
          .where(
            and(
              eq(matkaShifts.id, params.id),
              eq(matkaShifts.sportType, MatkaSportType.KalyanNew)
            )
          )
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
    },
    { beforeHandle: ownerOnly }
  )

  // ── Aggregated jantri summary for a kalyan-new shift ─────────────────────
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
        .innerJoin(
          matkaShifts,
          eq(matkaTransactions.shiftId, matkaShifts.id)
        )
        .where(
          and(
            eq(matkaTransactions.shiftId, params.id),
            eq(matkaShifts.sportType, MatkaSportType.KalyanNew),
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
