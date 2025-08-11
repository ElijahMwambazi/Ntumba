import { useEffect, useState } from 'react';
import { CheckCircle, Clock, XCircle, Loader2, Download } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ReceiptModal } from './ReceiptModal';
import backend from '~backend/client';
import type { Transaction } from '~backend/exchange/types';

interface TransactionStatusProps {
  transactionId: string;
  exchangeRate?: number;
  recipientInfo?: {
    phone?: string;
    lightning_address?: string;
    lightning_invoice?: string;
  };
  senderInfo?: {
    phone?: string;
  };
  onTransactionUpdate?: (transaction: Transaction) => void;
}

export function TransactionStatus({ 
  transactionId, 
  exchangeRate,
  recipientInfo,
  senderInfo,
  onTransactionUpdate
}: TransactionStatusProps) {
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [loading, setLoading] = useState(true);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [hasShownSuccessPrompt, setHasShownSuccessPrompt] = useState(false);

  useEffect(() => {
    const fetchTransaction = async () => {
      try {
        const response = await backend.exchange.getTransaction({ id: transactionId });
        setTransaction(response);
        
        // Notify parent component of transaction updates
        if (onTransactionUpdate) {
          onTransactionUpdate(response);
        }
        
        // Show receipt prompt when transaction completes for the first time
        if (response.status === 'completed' && !hasShownSuccessPrompt) {
          setHasShownSuccessPrompt(true);
          // Small delay to let the user see the completion status first
          setTimeout(() => {
            setShowReceiptModal(true);
          }, 1000);
        }
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
  }, [transactionId, transaction?.status, hasShownSuccessPrompt, onTransactionUpdate]);

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

  const getStatusMessage = (status: string) => {
    switch (status) {
      case 'pending':
        return 'Waiting for payment...';
      case 'processing':
        return 'Processing payment...';
      case 'completed':
        return 'Transaction completed successfully!';
      case 'failed':
        return 'Transaction failed. Please try again.';
      case 'cancelled':
        return 'Transaction was cancelled.';
      default:
        return 'Unknown status';
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
    <>
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

          <div className={`text-sm ${
            transaction.status === 'completed' ? 'text-green-600' :
            transaction.status === 'failed' || transaction.status === 'cancelled' ? 'text-red-600' :
            'text-blue-600'
          }`}>
            {getStatusMessage(transaction.status)}
          </div>

          {transaction.status === 'completed' && (
            <div className="pt-4 border-t">
              <Button
                onClick={() => setShowReceiptModal(true)}
                variant="outline"
                className="w-full h-10"
              >
                <Download className="mr-2 h-4 w-4" />
                Download Receipt
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {transaction && exchangeRate && (
        <ReceiptModal
          isOpen={showReceiptModal}
          onClose={() => setShowReceiptModal(false)}
          transaction={transaction}
          exchangeRate={exchangeRate}
          recipientInfo={recipientInfo}
          senderInfo={senderInfo}
        />
      )}
    </>
  );
}
