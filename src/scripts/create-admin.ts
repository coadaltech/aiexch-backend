import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema";
import { generateHashPassword } from "../utils/password";
import dotenv from "dotenv";

dotenv.config();

const connectionString = process.env.DATABASE_URL!;
const client = postgres(connectionString, {
  max: 1,
  idle_timeout: 20,
  connect_timeout: 10,
});

const db = drizzle(client, { schema });

async function createAdminUser() {
  try {
    console.log("Creating admin user...");

    // Check if admin user already exists
    const existingUser = await client`
      SELECT id FROM users WHERE email = 'admin@gmail.com'
    `;

    if (existingUser.length > 0) {
      console.log("Admin user already exists with email admin@gmail.com");
      console.log("User ID:", existingUser[0].id);
      return;
    }

    // Hash the password
    const hashedPassword = await generateHashPassword("Admin@123");

    // Insert the admin user
    const result = await client`
      INSERT INTO users (username, email, password, role, membership, status, balance, email_verified)
      VALUES ('admin', 'admin@gmail.com', ${hashedPassword}, 'admin', 'platinum', 'active', '0', true)
      RETURNING id, username, email, role
    `;

    console.log("Admin user created successfully!");
    console.log("User ID:", result[0].id);
    console.log("Username:", result[0].username);
    console.log("Email:", result[0].email);
    console.log("Role:", result[0].role);
  } catch (error) {
    console.error("Error creating admin user:", error);
  } finally {
    await client.end();
  }
}

// Run the script
createAdminUser();
