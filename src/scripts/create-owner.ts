// import dotenv from "dotenv";
// import path from "path";
// import { fileURLToPath } from "url";
import "dotenv/config";


// dotenv.config();

// Load .env from the root directory FIRST
// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);
// dotenv.config({ path: path.join(__dirname, "../../.env") });

// Now import after env is loaded
// import { db } from "../index";
import { db } from "@db/index";
import { users, profiles } from "../db/schema";
import { eq } from "drizzle-orm";
import { generateHashPassword } from "../utils/password";
import { getGroupIdForRole } from "../utils/ownerScope";

async function createOwnerUser() {
  try {
    console.log("Creating owner user...");
    console.log("Creating owner user...ewrwer");

    // Check if owner user already exists
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.email, "admin@gmail.com"))
      .limit(1);


    if (existingUser.length > 0) {
      console.log("Owner user already exists with email admin@gmail.com");
      console.log("User ID:", existingUser[0].id);
      return;
    }


    // Hash the password
    const hashedPassword = await generateHashPassword("Admin@123");

    // Insert the owner user
    const result = await db
      .insert(users)
      .values({
        username: "owner",
        email: "admin@gmail.com",
        password: hashedPassword,
        role: "owner",
        emailVerified: true,
        groupId: getGroupIdForRole("owner"),
      })
      .returning({
        id: users.id,
        username: users.username,
        email: users.email,
        role: users.role,
      });

    await db.insert(profiles).values({
      userId: result[0].id,
      membership: "platinum",
    });


    console.log("Owner user created successfully!");
    console.log("User ID:", result[0].id);
    console.log("Username:", result[0].username);
    console.log("Email:", result[0].email);
    console.log("Role:", result[0].role);
  } catch (error) {
    console.error("Error creating owner user:", error);
  }
}

// Run the script
createOwnerUser();
