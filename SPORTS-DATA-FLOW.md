# Sports Data Flow — Complete Architecture

## Overview

This document explains how sports data flows through the backend — from database/external APIs, through Redis caching, to the frontend via REST APIs and WebSockets.

---

## 1. STARTUP SEQUENCE (`index.ts`)

When the server starts, services initialize in this order:

```
1. connectRedis()                          → Establish Redis connection
2. loadWhitelabelOrigins()                 → Load allowed CORS domains from DB
3. AdminMarketService.syncOverridesToRedis() → Sync admin overrides from DB → Redis
4. OddsHistoryWorker.init()                → Start background odds archival worker
5. startBetSettlementService()             → Start bet settlement checks
6. initSocket()                            → Start MarketCronService (1s interval)
```

---

## 2. DATA HIERARCHY

```
Sports (Cricket, Tennis, Football...)
  └── Competitions/Series (IPL, T20 World Cup...)
        └── Events/Matches (India vs Australia, England vs SA...)
              └── Markets (Match Winner, Over/Under 2.5...)
                    └── Runners/Selections (India, Australia...)
                          └── Odds (Back: 1.5, Lay: 1.52...)
```

---

## 3. HOW EACH LEVEL IS FETCHED

### 3.1 Sports (Event Types)

```
Frontend calls:  GET /api/sports/sports-list
Function:        getAvailableSportsList()  (sports-service.ts)
DB Table:        sports
Redis Key:       sports:list
TTL:             300 seconds (5 minutes)
```

**Flow:**
```
Request → Check Redis "sports:list"
            ├── HIT  → Return cached data instantly
            └── MISS → Query DB: SELECT * FROM sports
                        → Transform data (id, name, is_active, sort_order)
                        → Store in Redis with 5min TTL
                        → Return to frontend
```

**Data returned:**
```json
[
  { "id": 4, "name": "Cricket", "is_active": true, "sort_order": 1 },
  { "id": 1, "name": "Football", "is_active": true, "sort_order": 2 },
  { "id": 2, "name": "Tennis", "is_active": true, "sort_order": 3 }
]
```

---

### 3.2 Competitions/Series for a Sport

```
Function:        getSeriesList({ eventTypeId })  (sports.ts)
DB Table:        competitions
Redis Key:       series:{eventTypeId}           e.g. series:4
TTL:             10,800 seconds (3 hours)
```

**Flow:**
```
Called internally (not a direct API route)
  → Check Redis "series:4"
      ├── HIT  → Return cached competitions
      └── MISS → Query DB: SELECT * FROM competitions
                            WHERE sport_id = 4 AND is_active = true
                            ORDER BY name
                  → Transform: use competition_id as external ID
                  → Store in Redis with 3hr TTL
                  → Return array
```

**Data returned:**
```json
[
  { "id": "12345", "name": "IPL 2026", "sportId": 4, "provider": "betfair" },
  { "id": "67890", "name": "T20 World Cup", "sportId": 4, "provider": "betfair" }
]
```

---

### 3.3 Matches/Events for a Competition

```
Function:        getMatchList({ eventTypeId, competitionId })  (sports.ts)
External API:    GET /sports/competitions/{competitionId}
Redis Key:       matches:{eventTypeId}:{competitionId}     e.g. matches:4:12345
TTL:             120 seconds (2 minutes)
```

**Flow:**
```
Called internally
  → Check Redis "matches:4:12345"
      ├── HIT  → Return cached matches
      └── MISS → Call external API: /sports/competitions/12345
                  → Extract response.data.events array
                  → Store in Redis with 2min TTL
                  → Return matches
```

**Data returned:**
```json
[
  { "id": "31234567", "name": "India v Australia", "openDate": "2026-03-20T10:00:00Z", "status": "OPEN" },
  { "id": "31234568", "name": "England v South Africa", "openDate": "2026-03-20T14:00:00Z", "status": "IN_PLAY" }
]
```

---

### 3.4 Markets for an Event

```
Function:        getMarkets({ eventId })  (sports.ts)
External API:    GET /sports/events/{eventId}
Redis Key:       markets:{eventId}                   e.g. markets:31234567
TTL:             60 seconds (1 minute)
```

**Flow:**
```
Called internally
  → Check Redis "markets:31234567"
      ├── HIT  → Return cached markets
      └── MISS → Call external API: /sports/events/31234567
                  → Extract response.data.catalogues array
                  → Store in Redis with 60s TTL
                  → Return markets
```

**Data returned:**
```json
[
  {
    "marketId": "1.234567",
    "marketName": "Match Winner",
    "marketType": "MATCH_ODDS",
    "status": "OPEN",
    "inPlay": true,
    "runners": [
      { "id": 456789, "name": "India" },
      { "id": 456790, "name": "Australia" }
    ]
  }
]
```

---

### 3.5 Odds for Markets

```
Function:        getOdds({ marketId })  (sports.ts)
External API:    GET /sports/books/{marketId1},{marketId2},...
Redis Key:       NONE (always fresh)
```

**Flow:**
```
Called internally — NO CACHING, always fetches fresh
  → Takes array of marketIds
  → Chunks into groups of 30 (API limit)
  → For each chunk: GET /sports/books/{comma-separated-ids}
  → Merge all results into single object
  → Return odds keyed by marketId
```

**Data returned:**
```json
{
  "1.234567": {
    "marketId": "1.234567",
    "sportingEvent": { ... },
    "runners": [
      { "selectionId": 456789, "status": "ACTIVE", "back": [[1.5, 100]], "lay": [[1.52, 200]] },
      { "selectionId": 456790, "status": "ACTIVE", "back": [[2.8, 150]], "lay": [[2.82, 100]] }
    ]
  }
}
```

---

## 4. COMBINED ENDPOINTS (What the frontend actually calls)

### 4.1 Get All Series with Matches

```
Frontend calls:  GET /api/sports/getAllSeries/{eventTypeId}
Function:        getSeriesWithMatches(eventTypeId)  (sports.ts)
Redis Keys:      sports:seriesWithMatches:{eventTypeId}   (TTL: 45s)
                 sports:seriesMatches:{eventTypeId}:{seriesId}  (TTL: 60s)
```

**This is the MAIN endpoint for the sports listing page.**

**Flow:**
```
GET /api/sports/getAllSeries/4
  │
  ├── Check route-level cache: "series:withMatches:4" (1hr TTL)
  │     └── HIT → Return instantly
  │
  └── MISS → Call getSeriesWithMatches("4")
               │
               ├── Check "sports:seriesWithMatches:4" (45s TTL)
               │     └── HIT → Return instantly
               │
               └── MISS → Fetch fresh data:
                    │
                    ├── getSeriesList("4")
                    │     → Returns 6 competitions (IPL, T20 WC, etc.)
                    │
                    └── For EACH series (processed ONE AT A TIME):
                          │
                          ├── Check "sports:seriesMatches:4:12345" (60s TTL)
                          │     └── HIT → Use cached matches
                          │
                          └── MISS:
                                ├── getMatchList("4", "12345")
                                │     → Returns matches for this series
                                │
                                └── For EACH match (ONE AT A TIME):
                                      └── getMarkets(matchId)
                                            → Check inPlay status
                                            → Return match with inPlay flag

                    → Cache each series matches (60s)
                    → Cache final combined result (45s)
                    → Return to frontend
```

**Deduplication:** If multiple requests hit `/getAllSeries/4` simultaneously, only ONE fetch runs. Others wait for the same promise.

**Data returned to frontend:**
```json
{
  "success": true,
  "eventTypeId": "4",
  "count": 6,
  "data": [
    {
      "id": "12345",
      "name": "IPL 2026",
      "eventTypeId": "4",
      "matches": [
        { "id": "31234567", "name": "India v Australia", "openDate": "...", "inPlay": true },
        { "id": "31234568", "name": "England v SA", "openDate": "...", "inPlay": false }
      ]
    },
    {
      "id": "67890",
      "name": "T20 World Cup",
      "eventTypeId": "4",
      "matches": [ ... ]
    }
  ]
}
```

---

### 4.2 Get Markets with Odds (for a specific match)

```
Frontend calls:  GET /api/sports/getMarketWithOdds/{eventId}
Function:        getMarketsWithOdds({ eventId })  (sports.ts)
Redis Key:       NONE for final result (sub-calls use cache)
```

**Flow:**
```
GET /api/sports/getMarketWithOdds/31234567
  │
  ├── getMarkets("31234567")        → Get all markets (cached 60s)
  ├── Filter: only OPEN markets
  ├── getOdds([marketIds])          → Get fresh odds (NO cache)
  ├── MERGE: Attach odds to each market's runners
  ├── broadcastMarketUpdate()       → Push to WebSocket subscribers
  └── Return merged data
```

**Data returned:**
```json
{
  "success": true,
  "eventId": "31234567",
  "data": [
    {
      "marketId": "1.234567",
      "marketName": "Match Winner",
      "status": "OPEN",
      "inPlay": true,
      "runners": [
        { "selectionId": 456789, "name": "India", "back": [[1.5, 100]], "lay": [[1.52, 200]] },
        { "selectionId": 456790, "name": "Australia", "back": [[2.8, 150]], "lay": [[2.82, 100]] }
      ]
    }
  ]
}
```

---

### 4.3 Get Full Match Details (via sports route)

```
Frontend calls:  POST /sports/matchDetails/{eventTypeId}/{eventId}
Function:        getMatchDetails({ eventTypeId, matchId })  (sports.ts)
```

**Flow:**
```
Fetches ALL data for a match in parallel:
  ├── getMarketsWithOdds(matchId)     → Markets + odds
  ├── getScore(eventTypeId, matchId)  → Live score
  ├── getPremiumFancy(...)            → Premium fancy markets (skipped for horse racing)
  ├── getBookmakersWithOdds(...)      → Bookmaker markets + odds (skipped for horse racing)
  └── getSessions(...)                → Session markets

Returns combined object with all match data.
```

---

## 5. REAL-TIME UPDATES (WebSocket + Cron)

### 5.1 Market Cron Service (Every 1 second)

```
File: market-cron-service.ts
Trigger: node-cron schedule "* * * * * *" (every second)
```

**Flow:**
```
Every 1 second:
  └── For each event with active WebSocket subscribers:
        └── MarketPipelineService.processEvent(eventId)
              │
              ├── Check admin event overrides (Redis: admin:event:{eventId})
              │     └── If disabled → broadcast empty, skip
              │
              ├── Fetch markets from external API (with cache)
              ├── Filter OPEN markets only
              ├── Fetch fresh odds from external API
              │
              ├── Load admin market overrides (Redis pipeline)
              │     → admin:market:{marketId} for all markets
              │
              ├── MERGE: API data + admin overrides
              │     → Admin values override API values
              │     → betDelay, minBet, maxBet, suspended, etc.
              │
              ├── Load custom markets (Redis: custom:markets:{eventId})
              │     → Add admin-created custom markets to the mix
              │
              ├── Store in live cache: live:markets:{eventId} (10s TTL)
              ├── Push odds snapshot to Redis Stream (throttled: max every 10s per market)
              └── Broadcast to all WebSocket subscribers
```

### 5.2 Event-Based WebSocket (`/ws/markets`)

```
File: socket-service.ts + routes/websocket.ts
```

**Client subscribes:**
```json
{ "type": "subscribe-markets", "eventId": "31234567" }
```

**Server flow:**
```
1. Client subscribes to eventId
2. eventId added to MarketCronService.activeEvents
3. Every 1 second, cron processes this event
4. broadcastMarketUpdate() sends to ALL subscribers of that event
5. When last subscriber leaves, event removed from activeEvents
```

**Data pushed to client:**
```json
{
  "type": "market-update",
  "eventId": "31234567",
  "markets": [ ...processed markets with odds... ],
  "timestamp": 1710756000000
}
```

### 5.3 Sports Polling WebSocket (`/sports/ws`)

```
File: sports-websocket.ts
```

**Supports multiple subscription types with different polling intervals:**

| Type | Interval | What it fetches |
|------|----------|----------------|
| `odds` | 1 second | Market odds for specific marketIds |
| `bookmakers` | 1 second | Bookmaker odds |
| `sessions` | 1 second | Session/fancy data |
| `score` | 1 second | Live match score |
| `premium` | 1 second | Premium fancy markets |
| `series` | 20 seconds | Series with matches (heavy, longer interval) |
| `matchDetails` | 5 minutes | Full match details |

---

## 6. REDIS CACHING SUMMARY

### Cache Key Reference Table

| Key Pattern | TTL | Source | Purpose |
|---|---|---|---|
| `sports:list` | 5 min | DB: sports | Available sports list |
| `series:{eventTypeId}` | 3 hours | DB: competitions | Competitions for a sport |
| `sports:seriesWithMatches:{eventTypeId}` | 45 sec | Computed | Full series + matches hierarchy |
| `sports:seriesMatches:{eventTypeId}:{seriesId}` | 60 sec | Computed | Matches in one series |
| `matches:{eventTypeId}:{competitionId}` | 2 min | External API | Match list for competition |
| `markets:{eventId}` | 60 sec | External API | Markets for an event |
| `bookmakers:{eventTypeId}:{eventId}` | 4 hours | External API | Bookmaker markets |
| `series:withMatches:{eventTypeId}` | 1 hour | Route-level | Route cache for getAllSeries |
| `live:markets:{eventId}` | 10 sec | Pipeline | Processed markets (with overrides) |
| `admin:event:{eventId}` | No TTL | DB: events | Admin event overrides |
| `admin:market:{marketId}` | No TTL | DB: marketSettings | Admin market overrides |
| `custom:markets:{eventId}` | No TTL | DB: marketSettings | Set of custom market IDs |
| `custom:odds:{marketId}` | No TTL | DB: customMarketOdds | Custom runner odds |
| `lastsnapshot:{marketId}` | 60 sec | Computed | Dedup hash for history |
| `stream:odds:history` | Trimmed | Pipeline | Odds history stream |

### Caching Hierarchy (Outer → Inner)

```
Route cache: series:withMatches:4                    (1 hour)
  └── Method cache: sports:seriesWithMatches:4       (45 seconds)
        └── Series cache: sports:seriesMatches:4:123 (60 seconds)
              └── Match cache: matches:4:123         (2 minutes)
                    └── Market cache: markets:31234  (60 seconds)
                          └── Odds: NO CACHE         (always fresh)
```

---

## 7. ADMIN OVERRIDES (How they modify the pipeline)

Admin can override market behavior via the dashboard. These are stored in DB and synced to Redis on startup.

### Override Flow:
```
Admin sets override in dashboard
  → Saved to DB (events / marketSettings table)
  → Synced to Redis immediately
  → Next cron tick (1 second), pipeline reads override from Redis
  → Applied BEFORE broadcasting to WebSocket
```

### What can be overridden:
- **Event level:** isActive, isVisible, suspended, betDelay
- **Market level:** isActive, isVisible, suspended, betDelay, minBet, maxBet, maxProfit, betLock
- **Custom markets:** Admin can create entirely new markets with custom odds

---

## 8. EXTERNAL API REFERENCE

**Base URL:** `process.env.SPORTS_GAME_PROVIDER_BASE_URL` (default: `http://100.30.62.142`)

| Endpoint | Method | Used By | Returns |
|---|---|---|---|
| `/sports/competitions/{competitionId}` | GET | getMatchList | `{ events: [...] }` |
| `/sports/events/{eventId}` | GET | getMarkets | `{ catalogues: [...] }` |
| `/sports/books/{marketIds}` | GET | getOdds | Object with odds per market |
| `/getBookmakerOdds?EventTypeID=&marketId=` | GET | getBookmarkOdds | Array of bookmaker odds |
| `/getSessions?EventTypeID=&matchId=` | GET | getSessions | Array of sessions |
| `/getPremium?EventTypeID=&matchId=` | GET | getPremiumFancy | Array of fancy markets |
| `/score?EventTypeID=&matchId=` | GET | getScore | Score object |

**Results API Base URL:** `process.env.SPORTS_GAME_PROVIDER_BASE_RESULT_URL`

| Endpoint | Used By |
|---|---|
| `/market/result/{marketId}` | getNewMarketResult |

---

## 9. DATABASE TABLES

### `sports`
| Column | Type | Description |
|---|---|---|
| sport_id | BIGINT (unique) | External sport ID (4=Cricket, 1=Football) |
| name | VARCHAR(100) | Sport name |
| is_active | BOOLEAN | Show/hide in frontend |
| sort_order | INTEGER | Display order |

### `competitions`
| Column | Type | Description |
|---|---|---|
| competition_id | BIGINT (unique) | External competition ID |
| sport_id | BIGINT | FK to sports |
| name | VARCHAR(200) | Series/competition name |
| is_active | BOOLEAN | Show/hide |
| metadata | JSONB | Extra data (totalEvents, etc.) |

### `events`
| Column | Type | Description |
|---|---|---|
| eventId | BIGINT (unique) | External event ID |
| competitionId | BIGINT | FK to competition |
| sportId | BIGINT | FK to sport |
| name | VARCHAR(255) | Match name |
| isActive, isVisible, suspended | BOOLEAN | Admin controls |
| betDelay | INTEGER | Delay before bet placement |

### `marketSettings`
| Column | Type | Description |
|---|---|---|
| marketId | NUMERIC (unique) | External market ID |
| eventId | BIGINT | FK to event |
| isCustom | BOOLEAN | Admin-created market? |
| isActive, isVisible, suspended | BOOLEAN | Admin controls |
| minBet, maxBet, maxProfit | DECIMAL | Betting limits |

---

## 10. COMPLETE REQUEST LIFECYCLE EXAMPLE

**User opens Cricket page in frontend:**

```
1. Frontend calls: GET /api/sports/sports-list
   → Returns: [Cricket, Football, Tennis, ...]
   → User clicks "Cricket" (eventTypeId = 4)

2. Frontend calls: GET /api/sports/getAllSeries/4
   → Backend checks Redis cache (45s TTL)
   → If miss: fetches series from DB, matches from API, markets from API
   → Returns: IPL (3 matches), T20 WC (2 matches), ...
   → User sees list of series with their matches

3. User clicks "India vs Australia" (eventId = 31234567)
   → Frontend calls: GET /api/sports/getMarketWithOdds/31234567
   → Returns: Match Winner market with back/lay odds
   → Frontend ALSO connects WebSocket: /ws/markets
   → Sends: { type: "subscribe-markets", eventId: "31234567" }

4. Every 1 second (automatic via cron):
   → MarketPipelineService processes event 31234567
   → Fetches fresh odds from external API
   → Applies admin overrides (bet delays, limits, etc.)
   → Broadcasts to WebSocket → Frontend updates odds in real-time

5. User navigates away:
   → WebSocket disconnects
   → Event removed from active updates
   → Cron stops processing this event
```

---

## 11. FILE REFERENCE

| File | Purpose |
|---|---|
| `src/index.ts` | Startup, service initialization |
| `src/db/redis.ts` | Redis client, health checks, reconnection |
| `src/db/index.ts` | Postgres client (Drizzle ORM) |
| `src/services/cache.ts` | CacheService wrapper (get/set with timeouts) |
| `src/services/sports.ts` | ALL sports data fetching (series, matches, markets, odds) |
| `src/services/sports-service.ts` | getAvailableSportsList() from DB |
| `src/services/market-cron-service.ts` | 1-second market update trigger |
| `src/services/market-pipeline-service.ts` | Fetch → Override → Broadcast pipeline |
| `src/services/socket-service.ts` | Event-based WebSocket management |
| `src/services/sports-websocket.ts` | Sports polling WebSocket with intervals |
| `src/services/admin-market-service.ts` | Admin overrides & custom markets |
| `src/services/odds-history-worker.ts` | Background odds archival to DB |
| `src/routes/series-route.ts` | /api/sports/* endpoints |
| `src/routes/sports.ts` | /sports/* endpoints |
| `src/routes/websocket.ts` | /ws/markets WebSocket route |
