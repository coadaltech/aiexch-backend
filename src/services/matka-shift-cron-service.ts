import cron from "node-cron";
import { db } from "../db";
import { matkaShifts, SYSTEM_USER_ID } from "../db/schema";
import { eq, sql } from "drizzle-orm";
import { RecordStatus } from "../types/enums";

/**
 * Cron job: every day at 10:00 AM (Asia/Kolkata),
 * update all active shift dates to today's date.
 */
export function startMatkaShiftCron() {
  // "0 10 * * *" = every day at 10:00
  cron.schedule(
    "0 10 * * *",
    async () => {
      try {
        const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

        const result = await db
          .update(matkaShifts)
          .set({
            shiftDate: today,
            updateBy: SYSTEM_USER_ID,
          })
          .where(eq(matkaShifts.recordStatus, RecordStatus.Active));

        console.log(`[MatkaShiftCron] Updated active shift dates to ${today}`);
      } catch (error) {
        console.error("[MatkaShiftCron] Failed to update shift dates:", error);
      }
    },
    { timezone: "Asia/Kolkata" }
  );

  console.log("[MatkaShiftCron] Scheduled daily at 10:00 AM IST");
}
