import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Load .env from the root directory FIRST
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "../../.env") });

// Now import after env is loaded
import { db } from "../db";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";
import { generateHashPassword } from "../utils/password";

async function createAdminUser() {
  try {
    console.log("Creating admin user...");
    console.log("Creating admin user...ewrwer");

    // Check if admin user already exists
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.email, "erfan@gmail.com"))
      .limit(1);

    console.log("----1111111");

    if (existingUser.length > 0) {
      console.log("Admin user already exists with email admin@gmail.com");
      console.log("User ID:", existingUser[0].id);
      return;
    }

    console.log("---22222222");

    // Hash the password
    const hashedPassword = await generateHashPassword("Admin@123");

    // Insert the admin user
    const result = await db
      .insert(users)
      .values({
        username: "erfan",
        email: "erfan@gmail.com",
        password: hashedPassword,
        role: "admin",
        membership: "platinum",
        status: "active",
        balance: "0",
        emailVerified: true,
      })
      .returning({
        id: users.id,
        username: users.username,
        email: users.email,
        role: users.role,
      });

    console.log("---33333");

    console.log("Admin user created successfully!");
    console.log("User ID:", result[0].id);
    console.log("Username:", result[0].username);
    console.log("Email:", result[0].email);
    console.log("Role:", result[0].role);
  } catch (error) {
    console.error("Error creating admin user:");
  }
}

// Run the script
createAdminUser();
