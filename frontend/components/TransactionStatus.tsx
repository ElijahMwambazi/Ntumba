import { useEffect, useState } from 'react';
import { CheckCircle, Clock, XCircle, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import backend from '~backend/client';
import type { Transaction } from '~backend/exchange/types';

interface TransactionStatusProps {
  transactionId: string;
}

export function TransactionStatus({ transactionId }: TransactionStatusProps) {
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTransaction = async () => {
      try {
        const response = await backend.exchange.getTransaction({ id: transactionId });
        setTransaction(response);
      } catch (error) {
        console.error('Failed to fetch transaction:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchTransaction();

    // Poll for updates every 5 seconds if transaction is not completed
    const interval = setInterval(() => {
      if (transaction?.status === 'pending' || transaction?.status === 'processing') {
        fetchTransaction();
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [transactionId, transaction?.status]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'failed':
      case 'cancelled':
        return <XCircle className="h-5 w-5 text-red-500" />;
      case 'processing':
        return <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />;
      default:
        return <Clock className="h-5 w-5 text-yellow-500" />;
    }
  };

  const getStatusVariant = (status: string) => {
    switch (status) {
      case 'completed':
        return 'default' as const;
      case 'failed':
      case 'cancelled':
        return 'destructive' as const;
      case 'processing':
        return 'secondary' as const;
      default:
        return 'outline' as const;
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Transaction Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-2">
            <div className="h-4 bg-gray-200 rounded w-1/4"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!transaction) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Transaction Status</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-500">Transaction not found</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Transaction Status</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            {getStatusIcon(transaction.status)}
            <Badge variant={getStatusVariant(transaction.status)}>
              {transaction.status.toUpperCase()}
            </Badge>
          </div>
          <div className="text-sm text-gray-500">
            ID: {transaction.id.slice(0, 8)}...
          </div>
        </div>

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">Created:</span>
            <span>{new Date(transaction.created_at).toLocaleString()}</span>
          </div>
          {transaction.completed_at && (
            <div className="flex justify-between">
              <span className="text-gray-500">Completed:</span>
              <span>{new Date(transaction.completed_at).toLocaleString()}</span>
            </div>
          )}
        </div>

        {transaction.status === 'pending' && (
          <div className="text-sm text-blue-600">
            Waiting for payment...
          </div>
        )}

        {transaction.status === 'processing' && (
          <div className="text-sm text-blue-600">
            Processing payment...
          </div>
        )}

        {transaction.status === 'completed' && (
          <div className="text-sm text-green-600">
            Transaction completed successfully!
          </div>
        )}

        {transaction.status === 'failed' && (
          <div className="text-sm text-red-600">
            Transaction failed. Please try again.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
