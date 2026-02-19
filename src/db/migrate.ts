import dotenv from "dotenv";
dotenv.config();
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import path from "path";

async function main() {
  try {
    if (!process.env.DATABASE_URL) {
      console.error("DATABASE_URL is not set");
      process.exit(1);
    }

    console.log("Connecting to database:", process.env.DATABASE_URL.replace(/:[^:@]+@/, ":****@"));
    
    // Create a new connection with SSL config
    const client = postgres(process.env.DATABASE_URL, {
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
      ssl: { rejectUnauthorized: false },
    });

    const db = drizzle(client);

    // Use absolute path for migrations folder
    const migrationsFolder = path.join(process.cwd(), "drizzle");
    console.log("Migrations folder:", migrationsFolder);

    await migrate(db, { migrationsFolder });
    
    console.log("Migration completed successfully");
    await client.end();
    process.exit(0);
  } catch (err: any) {
    console.error("Migration failed:");
    console.error(err);
    process.exit(1);
  }
}

main();
