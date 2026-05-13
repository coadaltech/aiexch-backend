import { Elysia, t } from "elysia";
import { qrCodes } from "../../db/schema";
import { eq } from "drizzle-orm";
import { uploadFile, deleteFile } from "../../services/s3";
import { whitelabel_middleware } from "../../middleware/whitelabel";
import { DbType } from "../../types";
import { UserRole } from "../../types/enums";
import { requirePermission } from "../../middleware/permissions";

const canViewQrCodes = requirePermission("qrcodes.view");
const canCreateQrCode = requirePermission("qrcodes.create");
const canEditQrCode = requirePermission("qrcodes.edit");
const canDeleteQrCode = requirePermission("qrcodes.delete");

export const qrCodesRoutes = new Elysia({ prefix: "/qrcodes" })
  .resolve(async ({ request }): Promise<{ db: DbType; whitelabel: any }> => {
    const { db, whitelabel } = await whitelabel_middleware(request);
    return { db: db as DbType, whitelabel };
  })
  // Product-level constraint: QR codes are managed by whitelabel admins (not
  // the platform Owner), and only on B2C whitelabels. Kept as a top-level
  // guard alongside the per-action permission checks below — Owner has every
  // permission via bypass but is intentionally locked out here by product rule.
  .guard({
    beforeHandle({ userRole, set, whitelabel }: any) {
      if (userRole === UserRole.Owner) {
        set.status = 403;
        return { success: false, message: "QR Codes are managed by whitelabel admins, not the owner" };
      }
      const wlType = whitelabel?.whitelabelType
        ? String(whitelabel.whitelabelType).toUpperCase()
        : null;
      if (wlType !== "B2C") {
        set.status = 403;
        return { success: false, message: "QR Codes are only available for B2C whitelabels" };
      }
    },
  })
  // 🟢 Get all QR Codes
  .get("/", async ({ set, db }) => {
    const allQrCodes = await db.select().from(qrCodes);
    set.status = 200;
    return { success: true, data: allQrCodes };
  }, { beforeHandle: canViewQrCodes })

  // 🟢 Create new QR Code
  .post(
    "/",
    async ({ body, set, db }) => {
      if (!body.paymentMethod?.trim()) {
        set.status = 400;
        return { success: false, message: "Payment method is required" };
      }

      let qrCodeUrl: string | null = null;

      // Upload new QR Code image (if provided)
      if (body.qrCodeUrl) {
        qrCodeUrl = await uploadFile(body.qrCodeUrl);
      }

      const [qrCode] = await db
        .insert(qrCodes)
        .values({
          ...body,
          status: body.status || "active",
          qrCodeUrl,
        })
        .returning();

      set.status = 201;
      return { success: true, data: qrCode };
    },
    {
      beforeHandle: canCreateQrCode,
      body: t.Object({
        paymentMethod: t.String({ minLength: 1, maxLength: 100 }),
        currency: t.String(),
        qrCodeUrl: t.Optional(t.File()),
        walletAddress: t.String(),
        instructions: t.String(),
        status: t.String(),
      }),
    }
  )

  // 🟡 Update QR Code (replaces file safely)
  .put(
    "/:id",
    async ({ params, body, set, db }) => {
      const id = params.id;

      // Fetch existing QR code
      const [existing] = await db
        .select()
        .from(qrCodes)
        .where(eq(qrCodes.id, id));

      if (!existing) {
        set.status = 404;
        return { success: false, message: "QR Code not found" };
      }

      let qrCodeUrl = existing.qrCodeUrl;

      // If new file is provided, upload it and delete old one
      if (body.qrCodeUrl && typeof body.qrCodeUrl !== "string") {
        // 1️⃣ Upload new image (generates new unique key)
        const newUrl = await uploadFile(body.qrCodeUrl);

        // 2️⃣ Delete old file if it exists
        if (existing.qrCodeUrl) {
          await deleteFile(existing.qrCodeUrl);
        }

        qrCodeUrl = newUrl;
      }

      const [updated] = await db
        .update(qrCodes)
        .set({
          ...body,
          qrCodeUrl,
          updateDate: new Date(),
        })
        .where(eq(qrCodes.id, id))
        .returning();

      set.status = 200;
      return { success: true, data: updated };
    },
    {
      beforeHandle: canEditQrCode,
      body: t.Object({
        paymentMethod: t.Optional(t.String()),
        currency: t.Optional(t.String()),
        qrCodeUrl: t.Optional(t.Union([t.String(), t.File()])),
        walletAddress: t.Optional(t.String()),
        instructions: t.Optional(t.String()),
        status: t.Optional(t.String()),
      }),
    }
  )

  // 🔴 Delete QR Code (and its file)
  .delete("/:id", async ({ params, set, db }) => {
    const id = params.id;

    const [existing] = await db
      .select()
      .from(qrCodes)
      .where(eq(qrCodes.id, id));

    if (!existing) {
      set.status = 404;
      return { success: false, message: "QR Code not found" };
    }

    // Delete file from S3
    if (existing.qrCodeUrl) {
      await deleteFile(existing.qrCodeUrl);
    }

    await db.delete(qrCodes).where(eq(qrCodes.id, id));
    set.status = 200;
    return { success: true };
  }, { beforeHandle: canDeleteQrCode });
