import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Clock, Info } from 'lucide-react';

interface FeeBreakdownProps {
  amount: number;
  fee: number;
  total: number;
  currency: 'ZMW' | 'BTC';
  exchangeRate?: number;
  feePercentage?: number;
  estimatedDeliveryTime?: string;
  className?: string;
}

export function FeeBreakdown({
  amount,
  fee,
  total,
  currency,
  exchangeRate,
  feePercentage,
  estimatedDeliveryTime,
  className = ""
}: FeeBreakdownProps) {
  const formatCurrency = (value: number, curr: 'ZMW' | 'BTC') => {
    if (curr === 'ZMW') {
      return new Intl.NumberFormat('en-ZM', {
        style: 'currency',
        currency: 'ZMW',
        minimumFractionDigits: 2,
      }).format(value);
    } else {
      return `${value.toFixed(8)} BTC`;
    }
  };

  const formatSats = (btcAmount: number) => {
    return new Intl.NumberFormat().format(Math.round(btcAmount * 100000000));
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-lg">Transaction Summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-gray-600">Amount</span>
            <div className="text-right">
              <div className="font-medium">{formatCurrency(amount, currency)}</div>
              {currency === 'BTC' && (
                <div className="text-sm text-gray-500">{formatSats(amount)} sats</div>
              )}
            </div>
          </div>

          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-1">
              <span className="text-gray-600">Service Fee</span>
              {feePercentage && (
                <span className="text-xs text-gray-500">({feePercentage.toFixed(2)}%)</span>
              )}
            </div>
            <div className="text-right">
              <div className="font-medium">{formatCurrency(fee, currency)}</div>
              {currency === 'BTC' && (
                <div className="text-sm text-gray-500">{formatSats(fee)} sats</div>
              )}
            </div>
          </div>

          <Separator />

          <div className="flex justify-between items-center">
            <span className="font-semibold">Total</span>
            <div className="text-right">
              <div className="font-bold text-lg">{formatCurrency(total, currency)}</div>
              {currency === 'BTC' && (
                <div className="text-sm text-gray-500">{formatSats(total)} sats</div>
              )}
            </div>
          </div>
        </div>

        {exchangeRate && (
          <div className="pt-4 border-t">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Exchange Rate</span>
              <span>1 BTC = {new Intl.NumberFormat('en-ZM', {
                style: 'currency',
                currency: 'ZMW',
                minimumFractionDigits: 0,
              }).format(exchangeRate)}</span>
            </div>
          </div>
        )}

        {estimatedDeliveryTime && (
          <div className="bg-blue-50 p-4 rounded-lg">
            <div className="flex items-start space-x-3">
              <Clock className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
              <div>
                <div className="text-sm font-medium text-blue-900">Delivery Time</div>
                <div className="text-sm text-blue-700 mt-1">{estimatedDeliveryTime}</div>
              </div>
            </div>
          </div>
        )}

        <div className="bg-gray-50 p-4 rounded-lg">
          <div className="flex items-start space-x-3">
            <Info className="h-4 w-4 text-gray-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-gray-600">
              <div className="font-medium mb-2">Fee Information</div>
              <div>
                Service fee is 1.5% with a minimum of 5 ZMW and maximum of 500 ZMW. 
                This covers exchange processing and network fees.
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
