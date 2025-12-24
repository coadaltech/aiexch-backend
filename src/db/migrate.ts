import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "./index";

async function main() {
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    process.exit(0);
  } catch (err) {
    console.error("Migration failed:");
    process.exit(1);
  }
}

main();
