import { Elysia } from "elysia";
import { sportsWebSocketManager } from "../services/sports-websocket";

let clientIdCounter = 0;
// Map to store client IDs by WebSocket connection (since ws.data might not persist)
const clientIdMap = new WeakMap<any, string>();

export const sportsWebSocketRoutes = new Elysia({ prefix: "/sports" })
  .ws("/ws", {
    open(ws) {
      const clientId = `client-${++clientIdCounter}-${Date.now()}`;
      (ws as any).data = { clientId };
      clientIdMap.set(ws, clientId);

      sportsWebSocketManager.addClient(clientId, (data) => {
        try {
          ws.send(data);
        } catch (error) {
          throw error;
        }
      });

    },
    message(ws, message) {
      try {
        const data =
          typeof message === "string" ? JSON.parse(message) : message;
        const { action, type, eventTypeId, marketIds, matchId } = data;
        // Get clientId from ws.data or WeakMap
        let finalClientId = (ws as any).data?.clientId || clientIdMap.get(ws);

        // If clientId is missing, initialize it now
        if (!finalClientId) {
          finalClientId = `client-${++clientIdCounter}-${Date.now()}`;
          (ws as any).data = { clientId: finalClientId };
          clientIdMap.set(ws, finalClientId);
          sportsWebSocketManager.addClient(finalClientId, (data) => {
            try {
              ws.send(data);
            } catch (error) {
              console.error(
                "[WebSocket Route] Error sending WebSocket message:",
                error
              );
            }
          });
        }

        if (action === "subscribe") {
          if (!type || !eventTypeId) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Missing required fields: type, eventTypeId",
              })
            );
            return;
          }

          const subscription = {
            type,
            eventTypeId,
            marketIds: marketIds || undefined,
            matchId: matchId || undefined,
          } as any;

          sportsWebSocketManager.subscribe(finalClientId, subscription);
          ws.send(
            JSON.stringify({
              type: "subscribed",
              subscription,
            })
          );
        } else if (action === "unsubscribe") {
          if (!type || !eventTypeId) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Missing required fields: type, eventTypeId",
              })
            );
            return;
          }

          const subscription = {
            type,
            eventTypeId,
            marketIds: marketIds || undefined,
            matchId: matchId || undefined,
          } as any;

          sportsWebSocketManager.unsubscribe(finalClientId, subscription);
          ws.send(
            JSON.stringify({
              type: "unsubscribed",
              subscription,
            })
          );
        } else {
          ws.send(
            JSON.stringify({
              type: "error",
              message: "Unknown action. Use 'subscribe' or 'unsubscribe'",
            })
          );
        }
      } catch (error) {
        console.error(
          `[WebSocket Route] Message parsing error from ${
            (ws as any).data?.clientId || "unknown"
          }:`,
          error
        );
        ws.send(
          JSON.stringify({
            type: "error",
            message: "Invalid message format",
          })
        );
      }
    },
    close(ws) {
      const clientId = (ws as any).data?.clientId || clientIdMap.get(ws);
      if (clientId) {

        sportsWebSocketManager.removeClient(clientId);
        clientIdMap.delete(ws);

      } else {
      }
    },
  })
  // Legacy endpoint for backwards compatibility
  .ws("/odds-stream", {
    open(ws) {
      const clientId = `client-${++clientIdCounter}-${Date.now()}`;
      (ws as any).data = { clientId };
      clientIdMap.set(ws, clientId);
      sportsWebSocketManager.addClient(clientId, (data) => {
        try {
          ws.send(data);
        } catch (error) {
          console.error(`[WebSocket Route] Legacy send failed for ${clientId}:`, error);
          throw error;
        }
      });

    },
    message(ws, message) {
      try {
        const data =
          typeof message === "string" ? JSON.parse(message) : message;
        const { action, eventTypeId, marketIds } = data;
        const clientId = (ws as any).data?.clientId;

        if (!clientId) return;

        if (action === "subscribe") {
          const subscription = {
            type: "odds" as const,
            eventTypeId,
            marketIds: marketIds || [],
          };
          sportsWebSocketManager.subscribe(clientId, subscription);
        } else if (action === "unsubscribe") {
          const subscription = {
            type: "odds" as const,
            eventTypeId,
            marketIds: marketIds || [],
          };
          sportsWebSocketManager.unsubscribe(clientId, subscription);
        }
      } catch (error) {
        console.error("WebSocket message error:", error);
      }
    },
    close(ws) {
      const clientId = (ws as any).data?.clientId;
      if (clientId) {

        sportsWebSocketManager.removeClient(clientId);

      } else {
      }
    },
  });
