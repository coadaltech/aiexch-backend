// services/socket-service.ts
import { MarketCronService } from "./market-cron-service";

// Map of eventId -> Set of WebSocket connections
// Using 'any' type to work with Elysia's WebSocket wrapper
const eventSubscriptions = new Map<string, Set<any>>();
// Map of WebSocket -> Set of subscribed eventIds
const socketSubscriptions = new Map<any, Set<string>>();

export const initSocket = () => {
  // NOTE: MarketCronService is no longer started here.
  // LiveDataService handles polling per-event at 330ms when subscribers are present.
  // Running both caused duplicate external API calls and doubled Redis writes.
  console.log("✅ WebSocket service initialized");
};

// Subscribe a WebSocket to an event
export const subscribeToEvent = (socket: any, eventId: string) => {
  // Add socket to event's subscription set
  if (!eventSubscriptions.has(eventId)) {
    eventSubscriptions.set(eventId, new Set());
  }
  eventSubscriptions.get(eventId)!.add(socket);

  // Track which events this socket is subscribed to
  if (!socketSubscriptions.has(socket)) {
    socketSubscriptions.set(socket, new Set());
  }
  socketSubscriptions.get(socket)!.add(eventId);

  // Add to cron updates
  MarketCronService.addEvent(eventId);

  console.log(`📡 Client subscribed to ${eventId}`);
};

// Unsubscribe a WebSocket from an event
export const unsubscribeFromEvent = (socket: any, eventId: string) => {
  // Remove socket from event's subscription set
  const subscribers = eventSubscriptions.get(eventId);
  if (subscribers) {
    subscribers.delete(socket);
    if (subscribers.size === 0) {
      eventSubscriptions.delete(eventId);
      MarketCronService.removeEvent(eventId);
    }
  }

  // Remove event from socket's subscription set
  const socketEvents = socketSubscriptions.get(socket);
  if (socketEvents) {
    socketEvents.delete(eventId);
    if (socketEvents.size === 0) {
      socketSubscriptions.delete(socket);
    }
  }

  console.log(`📡 Client unsubscribed from ${eventId}`);
};

// Clean up all subscriptions for a socket
export const cleanupSocket = (socket: any) => {
  const subscribedEvents = socketSubscriptions.get(socket);
  if (subscribedEvents) {
    // Unsubscribe from all events
    for (const eventId of subscribedEvents) {
      unsubscribeFromEvent(socket, eventId);
    }
  }
  console.log("🔌 Client disconnected and cleaned up");
};

// Broadcast market update to all subscribers of an event
export const broadcastMarketUpdate = (eventId: string, data: any) => {
  const subscribers = eventSubscriptions.get(eventId);
  if (!subscribers || subscribers.size === 0) {
    return;
  }

  const message = JSON.stringify({
    type: "market-update",
    eventId,
    markets: data.markets,
    timestamp: data.timestamp || Date.now(),
  });

  // Send to all subscribers, removing dead connections
  // WebSocket.OPEN = 1
  const deadSockets: any[] = [];
  for (const socket of subscribers) {
    try {
      if (socket.readyState === 1) { // OPEN state
        socket.send(message);
      } else {
        deadSockets.push(socket);
      }
    } catch (error) {
      console.error(`Error sending to socket:`, error);
      deadSockets.push(socket);
    }
  }

  // Clean up dead sockets
  for (const deadSocket of deadSockets) {
    cleanupSocket(deadSocket);
  }
};
