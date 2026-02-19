// Script to check if owner user exists in production database
require("dotenv").config();

// You need to connect to the production database here
// This is a template - you'll need to run this with production DB credentials

console.log("=== Production Owner User Check ===");
console.log("DATABASE_URL:", process.env.DATABASE_URL ? "Set" : "Not set");

// Import your database connection and schema
// const { db } = require('./src/db');
// const { users } = require('./src/db/schema');
// const { eq } = require('drizzle-orm');

async function checkOwnerUser() {
  try {
    console.log("Checking for owner user with email: erfan@gmail.com");

    // Uncomment and modify this when you have production DB access
    // const [ownerUser] = await db
    //   .select()
    //   .from(users)
    //   .where(eq(users.email, 'erfan@gmail.com'))
    //   .limit(1);

    // if (ownerUser) {
    //   console.log('✅ Owner user found:', {
    //     id: ownerUser.id,
    //     username: ownerUser.username,
    //     email: ownerUser.email,
    //     role: ownerUser.role,
    //     status: ownerUser.status,
    //     emailVerified: ownerUser.emailVerified
    //   });
    // } else {
    //   console.log('❌ Owner user not found!');
    //   console.log('You need to create the owner user in production.');
    // }

    console.log("\n⚠️  This script needs production database access to run.");
    console.log(
      "Please run the create-owner.js script in production environment."
    );
  } catch (error) {
    console.error("Error checking owner user:", error);
  }
}

checkOwnerUser();
