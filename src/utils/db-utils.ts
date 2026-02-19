import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema";

const dbClients = new Map<string, ReturnType<typeof drizzle>>();

export const generateDatabaseClient = (dbName: string) => {
  if (dbClients.has(dbName)) {
    return dbClients.get(dbName)!;
  }

  const client = postgres(`${process.env.DATABASE_BASE_URL}/${dbName}`, {
    max: 10,
    idle_timeout: 60,
    connect_timeout: 10,
    max_lifetime: 60 * 30,
    ssl: { rejectUnauthorized: false },
  });

  const dbClient = drizzle(client, { schema }); // ✅ Make sure schema is passed
  dbClients.set(dbName, dbClient);
  return dbClient;
};
