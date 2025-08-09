import { SQLDatabase } from "encore.dev/storage/sqldb";

export const exchangeDB = new SQLDatabase("exchange", {
  migrations: "./migrations",
});
