// services/sports-broadcast.ts
// Lightweight pub/sub for global sidebar signals piggy-backed on the existing
// /ws/markets WebSocket. Any client that sends
//   { action: "subscribe", channel: "<name>" }
// is added as a subscriber and receives a
//   { type: "<name>-changed", timestamp: number }
// message whenever something broadcasts on that channel.
//
// We store `send` callbacks (not the raw Elysia ws wrapper) because Elysia's
// wrapper doesn't reliably expose `readyState` — this mirrors how
// live-data-service.ts fans out market updates to subscribers.

import { onBroadcast, publishBroadcast } from "./broadcast-bus";

type Send = (msg: string) => void;

export type BroadcastChannel =
  | "sports-list"
  // A sport's competitions/events visibility changed (owner toggled a competition
  // or event active). Payload carries `eventTypeId` so clients can refetch that
  // sport's series; channel is global, clients filter/refetch in onMessage.
  | "series-changed"
  | "top-competitions"
  | "recommended-events"
  // Owner-pinned events that surface in the site's top drop-header nav.
  | "pinned-events"
  // Owner-pinned competitions that surface in the site's top drop-header nav.
  | "pinned-competitions"
  // Owner-pinned casino lobby categories that surface in the top drop-header.
  | "casino-categories"
  // User-balance change. Carries `userId` in the payload so subscribers can
  // ignore changes that don't belong to them (channel is global, fan-out is
  // tiny — every client just filters in onMessage).
  | "ledger"
  // Single-device session enforcement. When a user logs in somewhere new, we
  // broadcast a `force-logout` on this channel; every connected device filters
  // by `userId` + `sessionToken` and logs itself out immediately if the login
  // belongs to it but carries a different (newer) session token.
  | "session"
  // Per-user targeted alerts (e.g. "your bet was deleted"). The payload carries
  // `userId`; every connected client filters client-side and only reacts to its
  // own — same global-broadcast + client-filter pattern as `session`/`ledger`.
  | "user-notifications";

const channels = new Map<BroadcastChannel, Map<string, Send>>();

const getChannel = (name: BroadcastChannel): Map<string, Send> => {
  let ch = channels.get(name);
  if (!ch) {
    ch = new Map();
    channels.set(name, ch);
  }
  return ch;
};

export const addSubscriber = (
  channel: BroadcastChannel,
  clientId: string,
  send: Send,
) => {
  getChannel(channel).set(clientId, send);
};

export const removeSubscriber = (
  channel: BroadcastChannel,
  clientId: string,
) => {
  channels.get(channel)?.delete(clientId);
};

export const removeClientFromAllChannels = (clientId: string) => {
  for (const ch of channels.values()) ch.delete(clientId);
};

// ─── Cross-instance relay ──────────────────────────────────────────────────
// Every broadcast below is funnelled through the Redis-backed bus so it reaches
// the WebSocket clients connected to *other* instances too — not just the ones
// on the instance that produced the event. The producer builds the exact wire
// message once (so the timestamp is identical everywhere) and hands the bus a
// { channel, message } pair; the registered handler does the actual per-socket
// fan-out against THIS instance's local `channels` map.
const BUS_TOPIC = "sports-broadcast";

const localFanOut = (channel: BroadcastChannel, message: string) => {
  const subs = channels.get(channel);
  if (!subs || subs.size === 0) return;
  for (const [clientId, send] of subs) {
    try {
      send(message);
    } catch {
      subs.delete(clientId);
    }
  }
};

onBroadcast(BUS_TOPIC, (p: { channel: BroadcastChannel; message: string }) => {
  localFanOut(p.channel, p.message);
});

const emit = (channel: BroadcastChannel, message: string) => {
  publishBroadcast(BUS_TOPIC, { channel, message });
};

export const broadcastChange = (
  channel: BroadcastChannel,
  extra?: Record<string, unknown>,
) => {
  const message = JSON.stringify({
    type: `${channel}-changed`,
    timestamp: Date.now(),
    ...extra,
  });
  emit(channel, message);
};

// ─── Single-device session enforcement ────────────────────────────────────
// Push an immediate logout to every device currently connected for `userId`
// whose session token differs from the one just issued. The brand-new device
// hasn't opened its socket yet at login time, so it never receives its own
// kick; older devices receive it and log out on the spot (no polling/refresh).
export const broadcastForceLogout = (userId: string, sessionToken: string) => {
  const message = JSON.stringify({
    type: "force-logout",
    userId,
    sessionToken,
    timestamp: Date.now(),
  });
  console.log(`[broadcast] force-logout -> user ${userId} (all instances)`);
  emit("session", message);
};

// ─── Per-user targeted notifications ───────────────────────────────────────
// Push a freshly-created notification to every device currently connected for
// `userId`. The channel is global; clients filter by `userId` (and the header
// bell also re-fetches from the DB so offline devices catch up on next load).
export const broadcastUserNotification = (
  userId: string,
  notification: Record<string, unknown>,
) => {
  const message = JSON.stringify({
    type: "user-notifications-changed",
    userId,
    notification,
    timestamp: Date.now(),
  });
  emit("user-notifications", message);
};

// ─── Back-compat wrappers used by the existing sports-list flow ────────────
export const addSportsListSubscriber = (clientId: string, send: Send) =>
  addSubscriber("sports-list", clientId, send);

export const removeSportsListSubscriber = (clientId: string) =>
  removeSubscriber("sports-list", clientId);

export const broadcastSportsListChanged = () => broadcastChange("sports-list");
