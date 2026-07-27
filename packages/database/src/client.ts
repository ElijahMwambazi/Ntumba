import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

export function createDatabase(connectionString: string) {
  const pool = new Pool({ connectionString });
  const database = drizzle(pool, { schema });
  return { database, pool };
}

export type NtumbaDatabase = ReturnType<typeof createDatabase>["database"];
