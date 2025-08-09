import { api, APIError } from "encore.dev/api";
import { exchangeDB } from "./db";
import type { Transaction } from "./types";

interface GetTransactionParams {
  id: string;
}

// Gets a transaction by ID.
export const getTransaction = api<GetTransactionParams, Transaction>(
  { expose: true, method: "GET", path: "/exchange/transactions/:id" },
  async (params) => {
    const transaction = await exchangeDB.queryRow<Transaction>`
      SELECT * FROM transactions WHERE id = ${params.id}
    `;

    if (!transaction) {
      throw APIError.notFound("Transaction not found");
    }

    return transaction;
  }
);
