import { useState } from 'react';
import { Clock, ArrowRight, X, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

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

interface QuickFillCardProps {
  transactions: RecentTransaction[];
  onQuickFill: (transaction: RecentTransaction) => void;
  onClearHistory?: () => void;
  className?: string;
}

export function QuickFillCard({ 
  transactions, 
  onQuickFill, 
  onClearHistory,
  className = "" 
}: QuickFillCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (transactions.length === 0) {
    return null;
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-ZM', {
      style: 'currency',
      currency: 'ZMW',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (date: Date) => {
    const now = new Date();
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);
    
    if (diffInHours < 24) {
      return `${Math.floor(diffInHours)}h ago`;
    } else {
      const diffInDays = Math.floor(diffInHours / 24);
      return `${diffInDays}d ago`;
    }
  };

  const getRecipientDisplay = (transaction: RecentTransaction) => {
    if (transaction.type === 'btc_to_zmw') {
      return transaction.recipient_phone || 'Mobile Money';
    } else {
      const lightning = transaction.lightning_address || transaction.lightning_invoice;
      if (lightning && lightning.length > 25) {
        return `${lightning.slice(0, 12)}...${lightning.slice(-8)}`;
      }
      return lightning || 'Lightning';
    }
  };

  const getSenderDisplay = (transaction: RecentTransaction) => {
    if (transaction.type === 'zmw_to_btc') {
      return transaction.sender_phone || 'Mobile Money';
    }
    return 'Lightning';
  };

  const getTransactionLabel = (transaction: RecentTransaction) => {
    return transaction.type === 'btc_to_zmw' ? 'BTC → ZMW' : 'ZMW → BTC';
  };

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center">
            <Clock className="h-5 w-5 mr-2 text-blue-500" />
            Quick Fill
          </CardTitle>
          <div className="flex items-center space-x-2">
            {onClearHistory && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onClearHistory}
                className="h-8 w-8 p-0 text-gray-400 hover:text-red-500"
                title="Clear history"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
              className="h-8 w-8 p-0"
            >
              {isExpanded ? (
                <X className="h-4 w-4" />
              ) : (
                <ArrowRight className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </CardHeader>
      
      {isExpanded && (
        <CardContent className="pt-0">
          <div className="space-y-3">
            {transactions.map((transaction) => (
              <div
                key={transaction.id}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
                onClick={() => onQuickFill(transaction)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2 mb-1">
                    <Badge variant="outline" className="text-xs">
                      {getTransactionLabel(transaction)}
                    </Badge>
                    <span className="text-sm text-gray-500">
                      {formatDate(transaction.completed_at)}
                    </span>
                  </div>
                  
                  <div className="text-sm font-medium text-gray-900 mb-1">
                    {formatCurrency(transaction.amount_zmw)}
                  </div>
                  
                  <div className="text-xs text-gray-500 truncate">
                    {transaction.type === 'btc_to_zmw' ? (
                      <>To: {getRecipientDisplay(transaction)}</>
                    ) : (
                      <>
                        From: {getSenderDisplay(transaction)} → To: {getRecipientDisplay(transaction)}
                      </>
                    )}
                  </div>
                </div>
                
                <ArrowRight className="h-4 w-4 text-gray-400 ml-2 flex-shrink-0" />
              </div>
            ))}
          </div>
          
          <div className="mt-4 pt-3 border-t text-xs text-gray-500 text-center">
            Click any transaction to auto-fill the form
          </div>
        </CardContent>
      )}
      
      {!isExpanded && (
        <CardContent className="pt-0">
          <div className="text-sm text-gray-600">
            {transactions.length} recent transaction{transactions.length !== 1 ? 's' : ''} available
          </div>
        </CardContent>
      )}
    </Card>
  );
}
