import "dotenv/config";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const connection = await mysql.createConnection({ uri: process.env.DATABASE_URL, timezone: "Z" });
  try {
    await connection.query("SET time_zone = '+00:00'");
    await migrate(drizzle({ client: connection }), { migrationsFolder: "./drizzle" });
    console.log("Database migrations completed.");
  } finally {
    await connection.end();
  }
}
main().catch((error: unknown) => {
  console.error("Migration failed:", error instanceof Error ? error.message : error);
  // Migration failures contain DDL only; the driver cause identifies e.g. SQL precision errors.
  if (error instanceof Error && error.cause instanceof Error)
    console.error("Database cause:", error.cause.message);
  process.exitCode = 1;
});
