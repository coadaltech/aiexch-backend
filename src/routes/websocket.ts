// routes/websocket.ts
import { Elysia, t } from "elysia";
import { LiveDataService } from "@services/live-data-service";
import {
  addSubscriber,
  removeSubscriber,
  removeClientFromAllChannels,
  type BroadcastChannel,
} from "@services/sports-broadcast";

const KNOWN_CHANNELS: readonly BroadcastChannel[] = [
  "sports-list",
  "top-competitions",
  "recommended-events",
  "ledger",
  "session",
];
const isKnownChannel = (v: any): v is BroadcastChannel =>
  typeof v === "string" && (KNOWN_CHANNELS as readonly string[]).includes(v);

let clientIdCounter = 0;

export const websocketRoutes = new Elysia({ prefix: "/ws" }).ws("/markets", {
  body: t.Any(),
  open(ws) {
    const clientId = `ws-${++clientIdCounter}-${Date.now()}`;
    (ws.data as any)._clientId = clientId;
  },
  message(ws, message) {
    const clientId = (ws.data as any)?._clientId as string | undefined;
    try {
      const data = typeof message === "string" ? JSON.parse(message) : message;
      if (!clientId) return;

      const send = (msg: string) => {
        try { ws.send(msg); } catch { /* dead socket */ }
      };

      if (data.action === "subscribe") {
        const { eventId, eventTypeId } = data;
        if (!eventId) return;
        console.log(`[WS] Subscribe: ${clientId} -> event ${eventId}`);
        LiveDataService.subscribe(clientId, send, eventId, eventTypeId || "4");
        ws.send(JSON.stringify({ type: "subscribed", eventId }));
      } else if (data.action === "unsubscribe") {
        const { eventId } = data;
        if (!eventId) return;
        LiveDataService.unsubscribe(clientId, eventId);
        ws.send(JSON.stringify({ type: "unsubscribed", eventId }));
      }
      // Old format: {type: "subscribe-markets", eventId}
      else if (data.type === "subscribe-markets") {
        const eventId = data.eventId;
        const eventTypeId = data.eventTypeId || "4";
        if (eventId) {
          console.log(`[WS] Subscribe: ${clientId} -> event ${eventId}`);
          LiveDataService.subscribe(clientId, send, eventId, eventTypeId);
        }
      } else if (data.type === "unsubscribe-markets") {
        const eventId = data.eventId;
        if (eventId) {
          LiveDataService.unsubscribe(clientId, eventId);
        }
      }
      // ── Multimarket: pin subscription across multiple events ──
      else if (data.action === "subscribe-multimarket") {
        const items = Array.isArray(data.items) ? data.items : [];
        const eventTypeId = data.eventTypeId || "4";
        if (items.length === 0) return;
        console.log(`[WS] Subscribe-multimarket: ${clientId} -> ${items.length} markets`);
        LiveDataService.subscribeMultimarket(clientId, send, items, eventTypeId);
        ws.send(JSON.stringify({ type: "multimarket-subscribed", count: items.length }));
      } else if (data.action === "unsubscribe-multimarket") {
        LiveDataService.unsubscribeMultimarket(clientId);
        ws.send(JSON.stringify({ type: "multimarket-unsubscribed" }));
      }
      // ── Global sidebar channels (sports-list, top-competitions, recommended-events) ──
      else if (data.action === "subscribe-channel" && isKnownChannel(data.channel)) {
        addSubscriber(data.channel, clientId, send);
        ws.send(JSON.stringify({ type: "channel-subscribed", channel: data.channel }));
      } else if (data.action === "unsubscribe-channel" && isKnownChannel(data.channel)) {
        removeSubscriber(data.channel, clientId);
        ws.send(JSON.stringify({ type: "channel-unsubscribed", channel: data.channel }));
      }
    } catch (error) {
      console.error("[WS] Message error:", (error as Error)?.message);
    }
  },
  close(ws) {
    const clientId = (ws.data as any)?._clientId as string | undefined;
    if (clientId) {
      LiveDataService.cleanup(clientId);
      LiveDataService.unsubscribeMultimarket(clientId);
      removeClientFromAllChannels(clientId);
    }
  },
});
