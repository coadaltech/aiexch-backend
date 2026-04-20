import cron from "node-cron";
import { db } from "../db";
import { matkaShifts, SYSTEM_USER_ID } from "../db/schema";
import { and, eq } from "drizzle-orm";
import { RecordStatus } from "../types/enums";

/**
 * Cron job: every day at 10:00 AM (Asia/Kolkata),
 * roll shifts whose result was already declared forward to today's date.
 *
 * Declared shifts are parked at shift_date='1970-01-01' by the declare
 * endpoint; the cron only touches those, so an undeclared (still-active)
 * shift never has its date silently changed out from under running bets.
 */
export function startMatkaShiftCron() {
  // "0 10 * * *" = every day at 10:00
  cron.schedule(
    "0 10 * * *",
    async () => {
      try {
        const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

        await db
          .update(matkaShifts)
          .set({
            shiftDate: today,
            updateBy: SYSTEM_USER_ID,
          })
          .where(
            and(
              eq(matkaShifts.recordStatus, RecordStatus.Active),
              eq(matkaShifts.shiftDate, "1970-01-01")
            )
          );

        console.log(
          `[MatkaShiftCron] Rolled declared shifts (1970-01-01) forward to ${today}`
        );
      } catch (error) {
        console.error("[MatkaShiftCron] Failed to update shift dates:", error);
      }
    },
    { timezone: "Asia/Kolkata" }
  );

  console.log("[MatkaShiftCron] Scheduled daily at 10:00 AM IST");
}
