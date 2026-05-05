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

const ownerOnly = ({ userRole, set }: any) => {
  if (userRole !== UserRole.Owner) {
    set.status = 403;
    return { success: false, message: "Owner access only" };
  }
};

export const jamboOwnerRoutes = new Elysia({ prefix: "/jambo" })

  // ── List all jambo shifts ────────────────────────────────────────────────
  .get("/shifts", async ({ set, query }) => {
    try {
      const conditions = [
        eq(matkaShifts.recordStatus, RecordStatus.Active),
        eq(matkaShifts.sportType, MatkaSportType.Jambo),
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

  // ── Create jambo shift (owner only) ──────────────────────────────────────
  .post(
    "/shifts",
    async ({ body, set, userId }: any) => {
      try {
        const [maxOrder] = await db
          .select({ max: sql<number>`COALESCE(MAX(${matkaShifts.shiftOrder}), 0)` })
          .from(matkaShifts)
          .where(
            and(
              eq(matkaShifts.recordStatus, RecordStatus.Active),
              eq(matkaShifts.sportType, MatkaSportType.Jambo)
            )
          );

        const nextOrder = (maxOrder?.max ?? 0) + 1;

        const [shift] = await db
          .insert(matkaShifts)
          .values({
            name: body.name,
            sportType: MatkaSportType.Jambo,
            shiftDate: body.shiftDate,
            endTime: body.endTime,
            shiftOrder: nextOrder,
            // Jambo rate mapping:
            //   triple_rate  → number_type 0 (default 1000)
            //   dara_rate    → number_type 1,2 (jodi, default 100)
            //   akhar_rate   → number_type 3,4,5 (akhar, default 10)
            tripleRate: String(body.tripleRate ?? 1000),
            tripleCommission: String(body.tripleCommission ?? 0),
            daraRate: String(body.daraRate ?? 100),
            daraCommission: String(body.daraCommission ?? 0),
            akharRate: String(body.akharRate ?? 10),
            akharCommission: String(body.akharCommission ?? 0),
            mainJantriTime: body.mainJantriTime || null,
            isActive: body.isActive ?? true,
            nextDayAllow: body.nextDayAllow ?? false,
            capping: String(body.capping ?? 0),
            addedBy: userId || SYSTEM_USER_ID,
            updateBy: userId || SYSTEM_USER_ID,
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
        tripleRate: t.Optional(t.Number()),
        tripleCommission: t.Optional(t.Number()),
        daraRate: t.Optional(t.Number()),
        daraCommission: t.Optional(t.Number()),
        akharRate: t.Optional(t.Number()),
        akharCommission: t.Optional(t.Number()),
        mainJantriTime: t.Optional(t.String()),
        isActive: t.Optional(t.Boolean()),
        nextDayAllow: t.Optional(t.Boolean()),
        capping: t.Optional(t.Number()),
      }),
    }
  )

  // ── Reorder jambo shifts (bulk) ──────────────────────────────────────────
  .put(
    "/shifts/reorder",
    async ({ body, set, userId }: any) => {
      try {
        const updates = body.orders.map((item: any) =>
          db
            .update(matkaShifts)
            .set({
              shiftOrder: item.shiftOrder,
              updateBy: userId || SYSTEM_USER_ID,
            })
            .where(
              and(
                eq(matkaShifts.id, item.id),
                eq(matkaShifts.sportType, MatkaSportType.Jambo)
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

  // ── Update jambo shift ───────────────────────────────────────────────────
  .put(
    "/shifts/:id",
    async ({ body, params, set, userId }: any) => {
      try {
        const [existing] = await db
          .select()
          .from(matkaShifts)
          .where(
            and(
              eq(matkaShifts.id, params.id),
              eq(matkaShifts.sportType, MatkaSportType.Jambo)
            )
          );

        if (!existing) {
          set.status = 404;
          return { success: false, error: "Shift not found" };
        }

        const updateData: Record<string, any> = {
          updateBy: userId || SYSTEM_USER_ID,
        };

        if (body.name !== undefined) updateData.name = body.name;
        if (body.shiftDate !== undefined) updateData.shiftDate = body.shiftDate;
        if (body.endTime !== undefined) updateData.endTime = body.endTime;
        if (body.shiftOrder !== undefined) updateData.shiftOrder = body.shiftOrder;
        if (body.tripleRate !== undefined) updateData.tripleRate = String(body.tripleRate);
        if (body.tripleCommission !== undefined) updateData.tripleCommission = String(body.tripleCommission);
        if (body.daraRate !== undefined) updateData.daraRate = String(body.daraRate);
        if (body.daraCommission !== undefined) updateData.daraCommission = String(body.daraCommission);
        if (body.akharRate !== undefined) updateData.akharRate = String(body.akharRate);
        if (body.akharCommission !== undefined) updateData.akharCommission = String(body.akharCommission);
        if (body.mainJantriTime !== undefined) updateData.mainJantriTime = body.mainJantriTime;
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
        tripleRate: t.Optional(t.Number()),
        tripleCommission: t.Optional(t.Number()),
        daraRate: t.Optional(t.Number()),
        daraCommission: t.Optional(t.Number()),
        akharRate: t.Optional(t.Number()),
        akharCommission: t.Optional(t.Number()),
        mainJantriTime: t.Optional(t.String()),
        isActive: t.Optional(t.Boolean()),
        nextDayAllow: t.Optional(t.Boolean()),
        capping: t.Optional(t.Number()),
      }),
    }
  )

  // ── Soft delete jambo shift ──────────────────────────────────────────────
  .delete(
    "/shifts/:id",
    async ({ params, set, userId }: any) => {
      try {
        const [updated] = await db
          .update(matkaShifts)
          .set({
            recordStatus: RecordStatus.Deleted,
            updateBy: userId || SYSTEM_USER_ID,
          })
          .where(
            and(
              eq(matkaShifts.id, params.id),
              eq(matkaShifts.sportType, MatkaSportType.Jambo)
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

  // ── Aggregated jantri summary for a jambo shift ──────────────────────────
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
            eq(matkaShifts.sportType, MatkaSportType.Jambo),
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
