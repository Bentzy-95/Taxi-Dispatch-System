import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../drizzle/schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required. Set it in your .env file (see .env.example).");
}

// Neon (and most managed Postgres hosts) require SSL. Local Postgres
// typically doesn't support it, so only enable it when the connection
// string asks for it or points at a non-localhost host.
const needsSsl = /sslmode=require/.test(connectionString) || !/localhost|127\.0\.0\.1/.test(connectionString);

export const pool = new Pool({
  connectionString,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
});

export const db = drizzle(pool, { schema });
