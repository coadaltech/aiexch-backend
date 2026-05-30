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

type Send = (msg: string) => void;

export type BroadcastChannel =
  | "sports-list"
  | "top-competitions"
  | "recommended-events"
  // User-balance change. Carries `userId` in the payload so subscribers can
  // ignore changes that don't belong to them (channel is global, fan-out is
  // tiny — every client just filters in onMessage).
  | "ledger";

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

export const broadcastChange = (
  channel: BroadcastChannel,
  extra?: Record<string, unknown>,
) => {
  const subs = channels.get(channel);
  if (!subs || subs.size === 0) return;

  const message = JSON.stringify({
    type: `${channel}-changed`,
    timestamp: Date.now(),
    ...extra,
  });
  console.log(
    `[broadcast] ${channel}-changed -> ${subs.size} subscriber(s)`,
  );
  for (const [clientId, send] of subs) {
    try {
      send(message);
    } catch {
      subs.delete(clientId);
    }
  }
};

// ─── Back-compat wrappers used by the existing sports-list flow ────────────
export const addSportsListSubscriber = (clientId: string, send: Send) =>
  addSubscriber("sports-list", clientId, send);

export const removeSportsListSubscriber = (clientId: string) =>
  removeSubscriber("sports-list", clientId);

export const broadcastSportsListChanged = () => broadcastChange("sports-list");
