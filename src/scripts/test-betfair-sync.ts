/**
 * Manual first-sync / smoke test for the Betfair integration.
 *
 * Run:  bun run src/scripts/test-betfair-sync.ts
 *
 * It proves, in order:
 *   1) Betfair login works (credentials + endpoints)
 *   2) listEventTypes / listCompetitions / listEvents / listMarketCatalogue return data
 *   3) syncSports()        → fills `sports`        + writes notepad/eventtypes.json
 *   4) syncCompetitions()  → fills `competitions`  + writes notepad/competitions.json
 *   5) events: activates ONE competition and syncs its events
 *                          → fills `events`        + writes notepad/events.json
 *
 * NOTE: this writes to whatever DATABASE_URL points at (currently your local DB).
 * NOTE: syncSports() sets every event-type to is_active=false (admin re-enables),
 *       so after this you'll activate the sports/competitions you want in the owner panel.
 */
import "dotenv/config";
import { BetfairService } from "../services/betfair";
import { syncSports, syncCompetitions } from "../db/seed";
import { syncEventsForCompetition, syncRacingEvents, RACING_EVENT_TYPE_IDS, racingCompetitionId } from "../services/event-sync-service";
import { readNotepad } from "../services/notepad";
import { db } from "../db";
import { sports, competitions, events } from "../db/schema";
import { sql } from "drizzle-orm";

const line = (s: string) => console.log(`\n${"─".repeat(60)}\n${s}`);

async function count(table: any): Promise<number> {
  const r: any = await db.execute(sql`SELECT count(*)::int AS c FROM ${table}`);
  const rows = Array.isArray(r) ? r : r?.rows ?? [];
  return rows[0]?.c ?? 0;
}


async function main() {
  // ── 1) Connectivity ───────────────────────────────────────────────────────
  line("1) Betfair login + raw endpoint checks");
  await BetfairService.ensureSession();
  console.log("✅ login OK");

<<<<<<< Updated upstream
  // const eventTypes = await BetfairService.listEventTypes();
  // console.log(`✅ listEventTypes → ${eventTypes.length} event types`);
  // console.log(
  //   "   sample:",
  //   eventTypes
  //     .slice(0, 5)
  //     .map((e: any) => `${e.eventType?.id}:${e.eventType?.name}`)
  //     .join(", "),
  // );

  // // Pick Cricket (id 4) if present, else the first event type, to probe deeper.
  // const probe =
  //   eventTypes.find((e: any) => String(e.eventType?.id) === "4")?.eventType ??
  //   eventTypes[0]?.eventType;
  // if (probe) {
  //   const comps = await BetfairService.listCompetitions(probe.id);
  //   console.log(
  //     `✅ listCompetitions(${probe.id}/${probe.name}) → ${comps.length} competitions`,
  //   );
  //   const firstComp = comps[0]?.competition;
  //   if (firstComp) {
  //     const evs = await BetfairService.listEvents(probe.id, firstComp.id);
  //     console.log(
  //       `✅ listEvents(${firstComp.id}/${firstComp.name}) → ${evs.length} events`,
  //     );
  //     const firstEvent = evs[0]?.event;
  //     if (firstEvent) {
  //       const cat = await BetfairService.listMarketCatalogue(firstEvent.id);
  //       console.log(
  //         `✅ listMarketCatalogue(${firstEvent.id}/${firstEvent.name}) → ${cat.length} markets`,
  //       );
  //     }
  //   }
  // }

  // // ── 2) Event-types sync ─────────────────────────────────────────────────────
  // line("2) syncSports()  (event-types → DB + notepad/eventtypes.json)");
  // console.log("result:", await syncSports());
  // console.log(`   sports rows in DB: ${await count(sports)}`);
  // const et = await readNotepad("eventtypes");
  // console.log(
  //   `   notepad/eventtypes.json: ${et ? `${(et.data as any[]).length} records @ ${et.updatedAt}` : "MISSING"}`,
  // );

  // // ── 3) Competitions sync ────────────────────────────────────────────────────
  // line("3) syncCompetitions()  (competitions → DB + notepad/competitions.json)");
  // console.log("result:", await syncCompetitions());
  // console.log(`   competitions rows in DB: ${await count(competitions)}`);
  // const cp = await readNotepad("competitions");
  // console.log(
  //   `   notepad/competitions.json: ${cp ? `${(cp.data as any[]).length} records @ ${cp.updatedAt}` : "MISSING"}`,
  // );

  // // ── 4) Events sync (requires an ACTIVE competition) ─────────────────────────
  // line("4) Events: activate one competition + sync its events");
  // const [oneComp] = await db
  //   .select({ id: competitions.competition_id, sport: competitions.sport_id, name: competitions.name })
  //   .from(competitions)
  //   .limit(1);

  // if (!oneComp) {
  //   console.log("⚠️  No competitions in DB — skipping events test.");
  // } else {
  //   console.log(`   activating competition ${oneComp.id} (${oneComp.name})...`);
  //   await db
  //     .update(competitions)
  //     .set({ is_active: true })
  //     .where(sql`${competitions.competition_id} = ${oneComp.id}`);
  //   const res = await syncEventsForCompetition(oneComp.id, oneComp.sport);
  //   console.log("   syncEventsForCompetition result:", res);
  //   console.log(`   events rows in DB: ${await count(events)}`);
  //   const ev = await readNotepad("events");
  //   console.log(
  //     `   notepad/events.json: ${ev ? `${(ev.data as any[]).length} records @ ${ev.updatedAt}` : "MISSING"}`,
  //   );
  // }
=======
  const eventTypes = await BetfairService.listEventTypes();
  console.log(`✅ listEventTypes → ${eventTypes.length} event types`);
  console.log(
    "   sample:",
    eventTypes
      .slice(0, 5)
      .map((e: any) => `${e.eventType?.id}:${e.eventType?.name}`)
      .join(", "),
  );

  // Pick Cricket (id 4) if present, else the first event type, to probe deeper.
  const probe =
    eventTypes.find((e: any) => String(e.eventType?.id) === "4")?.eventType ??
    eventTypes[0]?.eventType;
  if (probe) {
    const comps = await BetfairService.listCompetitions(probe.id);
    console.log(
      `✅ listCompetitions(${probe.id}/${probe.name}) → ${comps.length} competitions`,
    );
    const firstComp = comps[0]?.competition;
    if (firstComp) {
      const evs = await BetfairService.listEvents(probe.id, firstComp.id);
      console.log(
        `✅ listEvents(${firstComp.id}/${firstComp.name}) → ${evs.length} events`,
      );
      const firstEvent = evs[0]?.event;
      if (firstEvent) {
        const cat = await BetfairService.listMarketCatalogue(firstEvent.id);
        console.log(
          `✅ listMarketCatalogue(${firstEvent.id}/${firstEvent.name}) → ${cat.length} markets`,
        );
      }
    }
  }

  // ── 2) Event-types sync ─────────────────────────────────────────────────────
  line("2) syncSports()  (event-types → DB + notepad/eventtypes.json)");
  console.log("result:", await syncSports());
  console.log(`   sports rows in DB: ${await count(sports)}`);
  const et = await readNotepad("eventtypes");
  console.log(
    `   notepad/eventtypes.json: ${et ? `${(et.data as any[]).length} records @ ${et.updatedAt}` : "MISSING"}`,
  );

  // ── 3) Competitions sync ────────────────────────────────────────────────────
  line("3) syncCompetitions()  (competitions → DB + notepad/competitions.json)");
  console.log("result:", await syncCompetitions());
  console.log(`   competitions rows in DB: ${await count(competitions)}`);
  const cp = await readNotepad("competitions");
  console.log(
    `   notepad/competitions.json: ${cp ? `${(cp.data as any[]).length} records @ ${cp.updatedAt}` : "MISSING"}`,
  );

  // ── 4) Events sync (requires an ACTIVE competition) ─────────────────────────
  line("4) Events: activate one competition + sync its events");
  const [oneComp] = await db
    .select({ id: competitions.competition_id, sport: competitions.sport_id, name: competitions.name })
    .from(competitions)
    .limit(1);

  if (!oneComp) {
    console.log("⚠️  No competitions in DB — skipping events test.");
  } else {
    console.log(`   activating competition ${oneComp.id} (${oneComp.name})...`);
    await db
      .update(competitions)
      .set({ is_active: true })
      .where(sql`${competitions.competition_id} = ${oneComp.id}`);
    const res = await syncEventsForCompetition(oneComp.id, oneComp.sport);
    console.log("   syncEventsForCompetition result:", res);
    console.log(`   events rows in DB: ${await count(events)}`);
    const ev = await readNotepad("events");
    console.log(
      `   notepad/events.json: ${ev ? `${(ev.data as any[]).length} records @ ${ev.updatedAt}` : "MISSING"}`,
    );
  }
>>>>>>> Stashed changes

  // ── 5) Racing (Horse 7 / Greyhound 4339) — synthetic competition + meetings ─
  line("5) syncRacingEvents()  (synthetic competition + meetings + notepad)");
  await syncRacingEvents();
  for (const sportId of RACING_EVENT_TYPE_IDS) {
    const compId = racingCompetitionId(sportId);
    const [comp] = await db
      .select({ name: competitions.name, active: competitions.is_active })
      .from(competitions)
      .where(sql`${competitions.competition_id} = ${compId}`);
    const np = await readNotepad(`racing-${sportId}`);
    console.log(
      `   sport ${sportId}: competition=${comp ? `"${comp.name}" (active=${comp.active})` : "MISSING"}, ` +
        `racing-${sportId}.json=${np ? `${(np.data as any[]).length} meetings` : "MISSING"}`,
    );
  }

  line("DONE ✅  Check the notepad/ folder and your DB tables.");
  process.exit(0);
}

main().catch((err) => {
  console.error("\n❌ TEST FAILED:", err?.response?.data ?? err?.message ?? err);
  process.exit(1);
});
