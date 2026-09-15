import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema";

function createDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required.");
  const pool = mysql.createPool({
    uri: url,
    connectionLimit: 10,
    timezone: "Z",
    enableKeepAlive: true,
  });
  // TIMESTAMP values use the MySQL session timezone, independently from the driver setting.
  pool.on("connection", (connection) => {
    connection.query("SET time_zone = '+00:00'");
  });
  return { db: drizzle({ client: pool, schema, mode: "default" }), pool };
}

// Lazy initialization keeps builds independent of a running database; reuse the pool during HMR.
const globalDb = globalThis as typeof globalThis & {
  repereDatabase?: ReturnType<typeof createDatabase>;
};
export function database() {
  return (globalDb.repereDatabase ??= createDatabase()).db;
}
export type Database = ReturnType<typeof database>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
