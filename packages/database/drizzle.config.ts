import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  out: "../../migrations",
  schema: "./src/schema.ts",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://ntumba:ntumba@localhost:5432/ntumba",
  },
  strict: true,
  verbose: true,
});
