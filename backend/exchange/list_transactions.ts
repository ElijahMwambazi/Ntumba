import { api } from "encore.dev/api";
import { Query } from "encore.dev/api";
import { exchangeDB } from "./db";
import type { Transaction } from "./types";

interface ListTransactionsParams {
  limit?: Query<number>;
  offset?: Query<number>;
  status?: Query<string>;
  type?: Query<string>;
}

interface ListTransactionsResponse {
  transactions: Transaction[];
  total: number;
}

// Lists transactions with optional filtering.
export const listTransactions = api<ListTransactionsParams, ListTransactionsResponse>(
  { expose: true, method: "GET", path: "/exchange/transactions" },
  async (params) => {
    const limit = params.limit || 20;
    const offset = params.offset || 0;

    let whereClause = "";
    const conditions: string[] = [];
    
    if (params.status) {
      conditions.push(`status = '${params.status}'`);
    }
    
    if (params.type) {
      conditions.push(`type = '${params.type}'`);
    }

    if (conditions.length > 0) {
      whereClause = `WHERE ${conditions.join(' AND ')}`;
    }

    const transactions = await exchangeDB.queryAll<Transaction>`
      SELECT * FROM transactions 
      ${whereClause}
      ORDER BY created_at DESC 
      LIMIT ${limit} OFFSET ${offset}
    `;

    const totalResult = await exchangeDB.queryRow<{ count: number }>`
      SELECT COUNT(*) as count FROM transactions ${whereClause}
    `;

    return {
      transactions,
      total: totalResult?.count || 0,
    };
  }
);
