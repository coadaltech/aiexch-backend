import dotenv from "dotenv";
dotenv.config();
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@db/schema";

const connectionString = process.env.DATABASE_URL!;
const client = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  ssl: { rejectUnauthorized: false },
});

export const db = drizzle(client, { schema });
