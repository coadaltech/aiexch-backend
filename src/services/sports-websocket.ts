import { SportsService } from "./sports";
import { CacheService } from "./cache";

type Subscription = {
  eventTypeId: string;
  marketIds?: string[];
  matchId?: string;
  type:
    | "odds"
    | "bookmakers"
    | "sessions"
    | "score"
    | "premium"
    | "matchDetails"
    | "series";
};

type WebSocketClient = {
  id: string;
  subscriptions: Set<string>;
  send: (data: any) => void;
};

class SportsWebSocketManager {
  private clients: Map<string, WebSocketClient> = new Map();
  private intervals: Map<string, NodeJS.Timeout> = new Map();
  private subscriptionMap: Map<string, Set<string>> = new Map(); // subscriptionKey -> Set of clientIds

  private getSubscriptionKey(sub: Subscription): string {
    if (sub.type === "odds" || sub.type === "bookmakers") {
      return `${sub.type}:${sub.eventTypeId}:${
        sub.marketIds?.sort().join(",") || ""
      }`;
    }
    if (
      sub.type === "sessions" ||
      sub.type === "score" ||
      sub.type === "premium"
    ) {
      return `${sub.type}:${sub.eventTypeId}:${sub.matchId}`;
    }
    if (sub.type === "matchDetails") {
      return `${sub.type}:${sub.eventTypeId}:${sub.matchId}`;
    }
    if (sub.type === "series") {
      return `${sub.type}:${sub.eventTypeId}`;
    }
    return `${sub.type}:${sub.eventTypeId}`;
  }

  addClient(clientId: string, send: (data: any) => void): void {
    this.clients.set(clientId, {
      id: clientId,
      subscriptions: new Set(),
      send,
    });
  }

  removeClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) {
      return;
    }

    // Remove client from all subscriptions
    client.subscriptions.forEach((subKey) => {
      const subscribers = this.subscriptionMap.get(subKey);
      if (subscribers) {
        subscribers.delete(clientId);
        if (subscribers.size === 0) {
          // No more subscribers, stop polling
          const interval = this.intervals.get(subKey);
          if (interval) {
            clearInterval(interval);
            this.intervals.delete(subKey);
          }
          this.subscriptionMap.delete(subKey);
        }
      }
    });

    this.clients.delete(clientId);
  }

  subscribe(clientId: string, subscription: Subscription): void {
    const client = this.clients.get(clientId);
    if (!client) {
      return;
    }

    const subKey = this.getSubscriptionKey(subscription);
    client.subscriptions.add(subKey);

    // Add client to subscription map
    if (!this.subscriptionMap.has(subKey)) {
      this.subscriptionMap.set(subKey, new Set());
    }
    this.subscriptionMap.get(subKey)!.add(clientId);

    // Start polling if not already started
    if (!this.intervals.has(subKey)) {
      // Start polling (don't await, but handle errors)
      this.startPolling(subKey, subscription).catch((error) => {});
    } else {
      // If polling already exists, immediately send cached data to new subscriber
      // Use setImmediate to ensure client is fully registered before fetching
      setImmediate(() => {
        this.fetchAndBroadcast(subKey, subscription).catch((error) => {
          console.error(
            `[WebSocket Manager] Failed to fetch cached data for ${subKey}:`,
            error
          );
        });
      });
    }
  }

  unsubscribe(clientId: string, subscription: Subscription): void {
    const client = this.clients.get(clientId);
    if (!client) {
      return;
    }

    const subKey = this.getSubscriptionKey(subscription);
    client.subscriptions.delete(subKey);

    const subscribers = this.subscriptionMap.get(subKey);
    if (subscribers) {
      subscribers.delete(clientId);

      if (subscribers.size === 0) {
        // No more subscribers, stop polling
        const interval = this.intervals.get(subKey);
        if (interval) {
          clearInterval(interval);
          this.intervals.delete(subKey);
        }
        this.subscriptionMap.delete(subKey);
      }
    }
  }

  private async startPolling(
    subKey: string,
    subscription: Subscription
  ): Promise<void> {
    // Initial fetch
    await this.fetchAndBroadcast(subKey, subscription);

    // Set polling interval based on data type
    // Odds: 2 seconds (real-time, always poll)
    // Series: 1 second (odds within series need to update every 1 second)
    // MatchDetails: Only check cache periodically, fetch when expired (check every 5 minutes)
    // Other: 1 second
    const pollingInterval =
      subscription.type === "odds"
        ? 1000 // 1 seconds for odds (real-time)
        : subscription.type === "series"
        ? 1000 // 1 second for series (real-time odds updates)
        : subscription.type === "matchDetails"
        ? 5 * 60 * 1000 // Check every 5 minutes for cache expiration (markets cached for 4.5 hours)
        : 1000; // 1 second for other types

    const interval = setInterval(async () => {
      await this.fetchAndBroadcast(subKey, subscription);
    }, pollingInterval);

    this.intervals.set(subKey, interval);
  }

  private async fetchAndBroadcast(
    subKey: string,
    subscription: Subscription
  ): Promise<void> {
    try {
      let data: any = null;
      const cacheKey = `ws:${subKey}`;
      const startTime = Date.now();

      // Check cache first (skip for series - we always want fresh odds)
      const cached = await CacheService.get(cacheKey);
      if (cached && subscription.type !== "series") {
        data = cached;
      } else {
        if (subscription.type === "series") {
        } else {
        }
        // Fetch fresh data
        switch (subscription.type) {
          case "odds":
            if (subscription.marketIds && subscription.marketIds.length > 0) {
              data = await SportsService.getOdds({
                eventTypeId: subscription.eventTypeId,
                marketId: subscription.marketIds,
              });
              // Cache for 2 seconds (matches polling interval)
              await CacheService.set(cacheKey, data, 2);
            } else {
              data = []; // Return empty array as fallback
            }
            break;

          case "bookmakers":
            if (subscription.marketIds && subscription.marketIds.length > 0) {
              data = await SportsService.getBookmakers({
                eventTypeId: subscription.eventTypeId,
                marketId: subscription.marketIds,
              });
              await CacheService.set(cacheKey, data, 1);
            } else {
              data = []; // Return empty array as fallback
            }
            break;

          case "sessions":
            if (subscription.matchId) {
              data = await SportsService.getSessions({
                eventTypeId: subscription.eventTypeId,
                matchId: subscription.matchId,
              });
              await CacheService.set(cacheKey, data, 1);
            }
            break;

          case "score":
            if (subscription.matchId) {
              data = await SportsService.getScore({
                eventTypeId: subscription.eventTypeId,
                matchId: subscription.matchId,
              });
              await CacheService.set(cacheKey, data, 1);
            }
            break;

          case "premium":
            if (subscription.matchId) {
              data = await SportsService.getPremiumFancy({
                eventTypeId: subscription.eventTypeId,
                matchId: subscription.matchId,
              });
              await CacheService.set(cacheKey, data, 1);
            }
            break;

          case "matchDetails":
            if (subscription.matchId) {
              data = await SportsService.getMatchDetails({
                eventTypeId: subscription.eventTypeId,
                matchId: subscription.matchId,
              });
              // Cache for 4.5 hours (contains markets data which doesn't change frequently)
              await CacheService.set(cacheKey, data, 4.5 * 60 * 60);
            }
            break;

          case "series":
            // Check if series structure (without odds) is cached
            const seriesStructureKey = `series:structure:${subscription.eventTypeId}`;
            let seriesStructure = await CacheService.get(seriesStructureKey);

            if (!seriesStructure) {
              // Fetch series structure (series + matches, without odds) and cache it
              const seriesList = await SportsService.getSeriesList({
                eventTypeId: subscription.eventTypeId,
              });

              seriesStructure = await Promise.all(
                seriesList.map(async (series: any) => {
                  const matches = await SportsService.getMatchList({
                    eventTypeId: subscription.eventTypeId,
                    competitionId: series.competition.id,
                  });

                  return {
                    id: series.competition.id,
                    name: series.competition.name,
                    matches: matches.map((match: any) => ({
                      ...match,
                      // Don't include odds here, we'll add them fresh
                    })),
                  };
                })
              );

              // Cache structure for 4.5 hours
              await CacheService.set(
                seriesStructureKey,
                seriesStructure,
                4.5 * 60 * 60
              );
            } else {
            }

            // Always fetch fresh odds for all matches
            data = await Promise.all(
              (seriesStructure as any[]).map(async (series: any) => {
                const matchesWithOdds = await Promise.all(
                  series.matches.map(async (match: any) => {
                    const odds = await SportsService.getMarketsWithOdds({
                      eventTypeId: subscription.eventTypeId,
                      eventId: match.event.id,
                    });

                    return {
                      ...match,
                      odds,
                    };
                  })
                );

                return {
                  ...series,
                  matches: matchesWithOdds,
                };
              })
            );

            const seriesCount = Array.isArray(data) ? data.length : 0;
            if (seriesCount === 0) {
            }

            // Cache the complete data (with fresh odds) for 1 second (matches polling interval)
            // This helps if multiple clients subscribe at the same time
            await CacheService.set(cacheKey, data, 1);
            break;
        }
      }

      // Broadcast to all subscribers
      if (data !== null) {
        const subscribers = this.subscriptionMap.get(subKey);
        if (subscribers && subscribers.size > 0) {
          const message = {
            type: `${subscription.type}:update`,
            subscription: {
              eventTypeId: subscription.eventTypeId,
              marketIds: subscription.marketIds,
              matchId: subscription.matchId,
            },
            data,
          };

          const dataSize = JSON.stringify(message).length;
          const duration = Date.now() - startTime;
          const dataLength = Array.isArray(data) ? data.length : data ? 1 : 0;

          let successCount = 0;
          let errorCount = 0;
          const deadClients: string[] = [];

          subscribers.forEach((clientId) => {
            const client = this.clients.get(clientId);
            if (client) {
              try {
                client.send(JSON.stringify(message));
                successCount++;
              } catch (error) {
                console.error(
                  `[WebSocket Manager] ❌ Error sending to client ${clientId}:`,
                  error
                );
                errorCount++;
                deadClients.push(clientId);
              }
            } else {
              console.warn(
                `[WebSocket Manager] ⚠️ Client ${clientId} not found in clients map`
              );
              errorCount++;
              deadClients.push(clientId);
            }
          });

          // Remove dead clients after iteration
          deadClients.forEach((clientId) => this.removeClient(clientId));
        } else {
          console.warn(
            `[WebSocket Manager] ⚠️ No subscribers for ${subKey}, skipping broadcast. Subscription map has key: ${this.subscriptionMap.has(
              subKey
            )}, subscribers: ${subscribers ? subscribers.size : "null"}`
          );
        }
      } else {
        console.warn(
          `[WebSocket Manager] ⚠️ No data fetched for ${subKey} (data is null or undefined)`
        );
      }
    } catch (error) {
      console.error(
        `[WebSocket Manager] Error fetching data for ${subKey}:`,
        error
      );
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }

  getSubscriptionCount(): number {
    return this.subscriptionMap.size;
  }
}

export const sportsWebSocketManager = new SportsWebSocketManager();
