// routes/live-websocket.ts
// Unified WebSocket endpoint for all live match data (odds, bookmakers, sessions, score).

import { Elysia, t } from "elysia";
import { LiveDataService } from "@services/live-data-service";

let clientIdCounter = 0;

export const liveWebSocketRoutes = new Elysia({ prefix: "/ws" }).ws("/live", {
  body: t.Any(),
  open(ws) {
    const clientId = `live-${++clientIdCounter}-${Date.now()}`;
    (ws.data as any)._clientId = clientId;
    console.log(`[WS /live] Client connected: ${clientId}`);
  },

  message(ws, message) {
    try {
      const data =
        typeof message === "string" ? JSON.parse(message) : message;
      const clientId = (ws.data as any)?._clientId as string | undefined;
      if (!clientId) return;

      console.log(`[WS /live] Message from ${clientId}:`, JSON.stringify(data));

      const send = (msg: string) => {
        try {
          ws.send(msg);
        } catch { /* dead socket, will be cleaned up */ }
      };

      if (data.action === "subscribe") {
        const { eventId, eventTypeId } = data;
        if (!eventId || !eventTypeId) {
          ws.send(JSON.stringify({ type: "error", message: "Missing eventId or eventTypeId" }));
          return;
        }
        LiveDataService.subscribe(clientId, send, eventId, eventTypeId);
        ws.send(JSON.stringify({ type: "subscribed", eventId }));
      } else if (data.action === "unsubscribe") {
        const { eventId } = data;
        if (!eventId) {
          ws.send(JSON.stringify({ type: "error", message: "Missing eventId" }));
          return;
        }
        LiveDataService.unsubscribe(clientId, eventId);
        ws.send(JSON.stringify({ type: "unsubscribed", eventId }));
      }
      // Also support the old message format for backward compatibility
      else if (data.type === "subscribe-markets") {
        const eventId = data.eventId;
        const eventTypeId = data.eventTypeId || "4"; // default to cricket
        if (eventId) {
          LiveDataService.subscribe(clientId, send, eventId, eventTypeId);
        }
      } else if (data.type === "unsubscribe-markets") {
        const eventId = data.eventId;
        if (eventId) {
          LiveDataService.unsubscribe(clientId, eventId);
        }
      }
    } catch (error) {
      console.error("[WS /live] Message parse error:", error);
      ws.send(JSON.stringify({ type: "error", message: "Invalid message format" }));
    }
  },

  close(ws) {
    const clientId = (ws.data as any)?._clientId as string | undefined;
    if (clientId) {
      LiveDataService.cleanup(clientId);
    }
  },
});
