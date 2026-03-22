// routes/websocket.ts
import { Elysia, t } from "elysia";
import { LiveDataService } from "@services/live-data-service";

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
    } catch (error) {
      console.error("[WS] Message error:", (error as Error)?.message);
    }
  },
  close(ws) {
    const clientId = (ws.data as any)?._clientId as string | undefined;
    if (clientId) {
      LiveDataService.cleanup(clientId);
    }
  },
});
