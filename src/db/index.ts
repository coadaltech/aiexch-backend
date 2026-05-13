import dotenv from "dotenv";
dotenv.config();
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@db/schema";

const connectionString = process.env.DATABASE_URL!;
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString);
const client = postgres(connectionString, {
  max: 10,
  idle_timeout: 30,
  connect_timeout: 30, // Neon free-tier cold start can take 15-30s
  max_lifetime: 60 * 10, // Recycle connections every 10 min to avoid stale connections
  ssl: isLocal ? false : { rejectUnauthorized: false },
  // Pin every session to UTC. Our timestamp columns are TIMESTAMP WITHOUT
  // TIME ZONE and the SQL functions stamp the output with a literal "Z" —
  // both only line up if writes and reads happen in UTC. Without this, a
  // session that inherits IST (or any non-UTC TZ) from the server stores
  // shifted wall-clock values and the frontend then double-converts them,
  // which surfaces as a wrong match start time in the UI.
  connection: { TimeZone: "UTC" },
});

export const db = drizzle(client, { schema });
