import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import dotenv from "dotenv";
dotenv.config();

const connectionString = process.env.DATABASE_URL;
const client = postgres(connectionString, { max: 1 });

async function checkUserRole() {
  try {
    const result =
      await client`SELECT id, username, email, role FROM users WHERE email = 'admin@gmail.com'`;
    console.log("User data:", result);
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await client.end();
  }
}
checkUserRole();
