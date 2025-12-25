// Script to check if admin user exists in production database
require("dotenv").config();

// You need to connect to the production database here
// This is a template - you'll need to run this with production DB credentials

console.log("=== Production Admin User Check ===");
console.log("DATABASE_URL:", process.env.DATABASE_URL ? "Set" : "Not set");

// Import your database connection and schema
// const { db } = require('./src/db');
// const { users } = require('./src/db/schema');
// const { eq } = require('drizzle-orm');

async function checkAdminUser() {
  try {
    console.log("Checking for admin user with email: erfan@gmail.com");

    // Uncomment and modify this when you have production DB access
    // const [adminUser] = await db
    //   .select()
    //   .from(users)
    //   .where(eq(users.email, 'erfan@gmail.com'))
    //   .limit(1);

    // if (adminUser) {
    //   console.log('✅ Admin user found:', {
    //     id: adminUser.id,
    //     username: adminUser.username,
    //     email: adminUser.email,
    //     role: adminUser.role,
    //     status: adminUser.status,
    //     emailVerified: adminUser.emailVerified
    //   });
    // } else {
    //   console.log('❌ Admin user not found!');
    //   console.log('You need to create the admin user in production.');
    // }

    console.log("\n⚠️  This script needs production database access to run.");
    console.log(
      "Please run the create-admin.js script in production environment."
    );
  } catch (error) {
    console.error("Error checking admin user:", error);
  }
}

checkAdminUser();
