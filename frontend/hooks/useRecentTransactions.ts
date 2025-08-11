import { useState, useEffect } from 'react';

interface RecentTransaction {
  id: string;
  type: 'btc_to_zmw' | 'zmw_to_btc';
  amount_zmw: number;
  recipient_phone?: string;
  sender_phone?: string;
  lightning_address?: string;
  lightning_invoice?: string;
  completed_at: Date;
  exchange_rate: number;
}

const STORAGE_KEY = 'ntumba_recent_transactions';
const MAX_TRANSACTIONS = 3;
const EXPIRY_DAYS = 30;

export function useRecentTransactions() {
  const [recentTransactions, setRecentTransactions] = useState<RecentTransaction[]>([]);

  useEffect(() => {
    loadRecentTransactions();
  }, []);

  const loadRecentTransactions = () => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const transactions = JSON.parse(stored).map((t: any) => ({
          ...t,
          completed_at: new Date(t.completed_at)
        }));
        
        // Filter out expired transactions (older than 30 days)
        const now = new Date();
        const validTransactions = transactions.filter((t: RecentTransaction) => {
          const daysDiff = (now.getTime() - t.completed_at.getTime()) / (1000 * 60 * 60 * 24);
          return daysDiff <= EXPIRY_DAYS;
        });

        // If we filtered out expired transactions, update storage
        if (validTransactions.length !== transactions.length) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(validTransactions));
        }

        setRecentTransactions(validTransactions);
      }
    } catch (error) {
      console.error('Failed to load recent transactions:', error);
    }
  };

  const addRecentTransaction = (transaction: Omit<RecentTransaction, 'completed_at'>) => {
    try {
      const newTransaction: RecentTransaction = {
        ...transaction,
        completed_at: new Date()
      };

      // Remove any existing transaction with the same ID
      const filteredTransactions = recentTransactions.filter(t => t.id !== transaction.id);
      
      // Add new transaction at the beginning
      const updatedTransactions = [newTransaction, ...filteredTransactions]
        .slice(0, MAX_TRANSACTIONS); // Keep only the most recent transactions

      setRecentTransactions(updatedTransactions);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedTransactions));
    } catch (error) {
      console.error('Failed to save recent transaction:', error);
    }
  };

  const clearRecentTransactions = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      setRecentTransactions([]);
    } catch (error) {
      console.error('Failed to clear recent transactions:', error);
    }
  };

  const getTransactionsForType = (type: 'btc_to_zmw' | 'zmw_to_btc') => {
    return recentTransactions.filter(t => t.type === type);
  };

  return {
    recentTransactions,
    addRecentTransaction,
    clearRecentTransactions,
    getTransactionsForType
  };
}
