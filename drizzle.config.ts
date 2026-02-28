import { defineConfig } from "drizzle-kit";
import "dotenv/config";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set in .env");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});


// import { defineConfig } from "drizzle-kit";
// import fs from "fs";
 
//  export default defineConfig({
//      schema: "./src/db/schema.ts",
//      out: "./drizzle",
//      dialect: "postgresql",
//      dbCredentials: {
//      host: "aiexch-psql.cwrmuyg06gc7.us-east-1.rds.amazonaws.com",
//      port: 5432,
//      user: "postgres",
//      password: "Gc6rBiHRtVx8OA3V2fzoR3qxdf",
//      database: "aiexch",
//      ssl: {
//        rejectUnauthorized: true,
//        ca: fs.readFileSync("./global-bundle.pem").toString(),
//      },
//   },
// });
