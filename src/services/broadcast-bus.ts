// services/broadcast-bus.ts
//
// Cross-instance broadcast relay built on Redis pub/sub.
//
// THE PROBLEM IT SOLVES
// Each backend instance keeps its live WebSocket subscribers in its own RAM
// (sports-broadcast.ts `channels`, live-data-service.ts `activeEvents`). Behind
// a load balancer a user's devices can be connected to *different* instances,
// and an event (a new login, a result declaration, an admin patch) is produced
// on whichever instance happened to handle that request. A purely-local fan-out
// therefore never reaches the sockets living on the other instances.
//
// THE FIX
// "Broadcasting" stops meaning "write to my local sockets" and becomes "tell
// every instance to write to *their* local sockets". A producer calls
// publishBroadcast(topic, payload); this bus (a) delivers to the local handler
// immediately and (b) republishes over Redis so every *other* instance runs its
// own local handler too. Each instance only ever writes to the sockets it owns.
//
// DESIGN NOTES
// - Local delivery is synchronous and does NOT depend on the Redis round-trip,
//   so single-device / same-instance behaviour is unchanged even if Redis is
//   down. Redis only carries the message to the *other* instances.
// - Messages are tagged with this process's INSTANCE_ID; we skip our own
//   messages on receive so the producer instance never double-delivers.
// - A dedicated subscriber connection is required: a Redis client in subscribe
//   mode cannot run normal commands, so we duplicate the main client.

import { hostname } from "os";
import { redis, redisIsHealthy } from "@db/redis";

// Single Redis channel carrying every topic; the envelope routes it locally.
const CHANNEL = "aiexch:broadcast";

// Unique per running process so we can ignore our own echoed messages.
const INSTANCE_ID = `${hostname()}:${process.pid}:${process.hrtime.bigint()}`;

type Handler = (payload: any) => void;
const handlers = new Map<string, Handler>();

let subscriber: ReturnType<typeof redis.duplicate> | null = null;
let busReady = false;

/** Register the local fan-out for a topic. Call once at module load. */
export function onBroadcast(topic: string, handler: Handler): void {
  if (handlers.has(topic)) {
    console.warn(`[bus] handler for "${topic}" already registered — overwriting`);
  }
  handlers.set(topic, handler);
}

/** Run a topic's local handler against THIS instance's own subscribers. */
function deliverLocal(topic: string, payload: any): void {
  const handler = handlers.get(topic);
  if (!handler) return;
  try {
    handler(payload);
  } catch (e) {
    console.error(`[bus] local handler for "${topic}" threw:`, (e as Error)?.message);
  }
}

/**
 * Broadcast an event to every instance (including this one).
 * - Always delivers locally right away (works even with Redis down).
 * - Fans out to the other instances over Redis when the bus is up.
 */
export function publishBroadcast(topic: string, payload: any): void {
  // 1) Our own connected clients — synchronous, no dependency on Redis.
  deliverLocal(topic, payload);

  // 2) Every other instance — best-effort; a Redis blip must never throw into
  //    the caller (these are fire-and-forget signal paths).
  if (!busReady || !redisIsHealthy()) return;
  try {
    const envelope = JSON.stringify({ s: INSTANCE_ID, t: topic, p: payload });
    redis.publish(CHANNEL, envelope).catch(() => { /* best-effort */ });
  } catch {
    /* serialization guard — best-effort */
  }
}

/**
 * Connect the subscriber and start relaying remote messages to local handlers.
 * Call once, after connectRedis(), during startup. Idempotent.
 */
export async function initBroadcastBus(): Promise<void> {
  if (subscriber) return;
  try {
    subscriber = redis.duplicate();
    subscriber.on("error", (err: Error) => {
      // Don't spam: the main client's health logging already covers outages.
      if (busReady) console.error("[bus] subscriber error:", err.message);
    });
    await subscriber.connect();
    await subscriber.subscribe(CHANNEL, (raw: string) => {
      try {
        const { s, t, p } = JSON.parse(raw);
        if (s === INSTANCE_ID) return; // our own echo — already delivered locally
        deliverLocal(t, p);
      } catch (e) {
        console.error("[bus] failed to handle inbound message:", (e as Error)?.message);
      }
    });
    busReady = true;
    console.log(`[bus] cross-instance broadcast bus ready (instance ${INSTANCE_ID})`);
  } catch (e) {
    busReady = false;
    console.error("[bus] init failed — falling back to local-only delivery:", (e as Error)?.message);
  }
}
