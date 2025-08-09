import { ArrowLeft, ArrowRight, Clock, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';

interface ConfirmationStepProps {
  transactionType: 'btc_to_zmw' | 'zmw_to_btc';
  recipientPhone?: string;
  senderPhone?: string;
  recipientLightning?: string;
  zmwAmount: string;
  btcAmount: string;
  feeCalculation: {
    amount_zmw: number;
    amount_sats: number;
    fee_zmw: number;
    fee_sats: number;
    total_zmw: number;
    total_sats: number;
    fee_percentage: number;
    exchange_rate: number;
    estimated_delivery_time: string;
  };
  onBack: () => void;
  onConfirm: () => void;
  loading: boolean;
}

export function ConfirmationStep({
  transactionType,
  recipientPhone,
  senderPhone,
  recipientLightning,
  zmwAmount,
  btcAmount,
  feeCalculation,
  onBack,
  onConfirm,
  loading
}: ConfirmationStepProps) {
  const formatCurrency = (value: number, currency: 'ZMW' | 'BTC') => {
    if (currency === 'ZMW') {
      return new Intl.NumberFormat('en-ZM', {
        style: 'currency',
        currency: 'ZMW',
        minimumFractionDigits: 2,
      }).format(value);
    } else {
      return `${value.toFixed(8)} BTC`;
    }
  };

  const formatSats = (sats: number) => {
    return new Intl.NumberFormat().format(sats);
  };

  const getTransactionTitle = () => {
    return transactionType === 'btc_to_zmw' 
      ? 'Bitcoin → Kwacha Transaction'
      : 'Kwacha → Bitcoin Transaction';
  };

  const getConfirmButtonText = () => {
    return transactionType === 'btc_to_zmw' 
      ? 'Confirm & Create Invoice'
      : 'Confirm & Request Payment';
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-900">Review & Confirm</h1>
        <p className="text-gray-600 mt-2">
          Please review your transaction details before confirming
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            {getTransactionTitle()}
            <Badge variant="outline" className="ml-2">
              {transactionType === 'btc_to_zmw' ? 'BTC → ZMW' : 'ZMW → BTC'}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Transaction Details */}
          <div className="space-y-4">
            <h3 className="font-semibold text-lg">Transaction Details</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {transactionType === 'btc_to_zmw' ? (
                <>
                  <div className="space-y-2">
                    <div className="text-sm text-gray-500">You're sending</div>
                    <div className="font-semibold text-lg">
                      {formatCurrency(feeCalculation.total_sats / 100000000, 'BTC')}
                    </div>
                    <div className="text-sm text-gray-500">
                      {formatSats(feeCalculation.total_sats)} sats
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="text-sm text-gray-500">Recipient gets</div>
                    <div className="font-semibold text-lg">
                      {formatCurrency(feeCalculation.amount_zmw, 'ZMW')}
                    </div>
                    <div className="text-sm text-gray-500">
                      Via mobile money
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    <div className="text-sm text-gray-500">You're sending</div>
                    <div className="font-semibold text-lg">
                      {formatCurrency(feeCalculation.total_zmw, 'ZMW')}
                    </div>
                    <div className="text-sm text-gray-500">
                      Via mobile money
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="text-sm text-gray-500">Recipient gets</div>
                    <div className="font-semibold text-lg">
                      {formatCurrency(feeCalculation.amount_sats / 100000000, 'BTC')}
                    </div>
                    <div className="text-sm text-gray-500">
                      {formatSats(feeCalculation.amount_sats)} sats
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          <Separator />

          {/* Recipient Information */}
          <div className="space-y-4">
            <h3 className="font-semibold text-lg">
              {transactionType === 'btc_to_zmw' ? 'Recipient Information' : 'Payment Information'}
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {transactionType === 'btc_to_zmw' ? (
                <div className="space-y-2">
                  <div className="text-sm text-gray-500">Mobile Money Number</div>
                  <div className="font-semibold">{recipientPhone}</div>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <div className="text-sm text-gray-500">Your Phone Number</div>
                    <div className="font-semibold">{senderPhone}</div>
                  </div>
                  <div className="space-y-2">
                    <div className="text-sm text-gray-500">Lightning Address</div>
                    <div className="font-semibold break-all">{recipientLightning}</div>
                  </div>
                </>
              )}
            </div>
          </div>

          <Separator />

          {/* Fee Breakdown */}
          <div className="space-y-4">
            <h3 className="font-semibold text-lg">Fee Breakdown</h3>
            
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-gray-600">Amount</span>
                <div className="text-right">
                  <div className="font-medium">
                    {formatCurrency(feeCalculation.amount_zmw, 'ZMW')}
                  </div>
                  <div className="text-sm text-gray-500">
                    ≈ {formatCurrency(feeCalculation.amount_sats / 100000000, 'BTC')}
                  </div>
                </div>
              </div>

              <div className="flex justify-between items-center">
                <div className="flex items-center space-x-1">
                  <span className="text-gray-600">Service Fee</span>
                  <span className="text-xs text-gray-500">
                    ({feeCalculation.fee_percentage.toFixed(2)}%)
                  </span>
                </div>
                <div className="text-right">
                  <div className="font-medium">
                    {formatCurrency(feeCalculation.fee_zmw, 'ZMW')}
                  </div>
                  <div className="text-sm text-gray-500">
                    ≈ {formatCurrency(feeCalculation.fee_sats / 100000000, 'BTC')}
                  </div>
                </div>
              </div>

              <Separator />

              <div className="flex justify-between items-center">
                <span className="font-semibold">Total</span>
                <div className="text-right">
                  <div className="font-bold text-lg">
                    {formatCurrency(feeCalculation.total_zmw, 'ZMW')}
                  </div>
                  <div className="text-sm text-gray-500">
                    ≈ {formatCurrency(feeCalculation.total_sats / 100000000, 'BTC')}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <Separator />

          {/* Exchange Rate & Delivery Time */}
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="text-sm text-gray-500">Exchange Rate</div>
                <div className="font-medium">
                  1 BTC = {new Intl.NumberFormat('en-ZM', {
                    style: 'currency',
                    currency: 'ZMW',
                    minimumFractionDigits: 0,
                  }).format(feeCalculation.exchange_rate)}
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-sm text-gray-500">Estimated Delivery</div>
                <div className="font-medium flex items-center">
                  <Clock className="h-4 w-4 mr-1 text-blue-500" />
                  {feeCalculation.estimated_delivery_time}
                </div>
              </div>
            </div>
          </div>

          {/* Important Notice */}
          <div className="bg-amber-50 p-4 rounded-lg">
            <div className="flex items-start space-x-2">
              <Info className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-amber-800">
                <div className="font-medium mb-1">Important Notice</div>
                <div>
                  {transactionType === 'btc_to_zmw' 
                    ? 'Once you pay the Lightning invoice, the transaction cannot be reversed. Please ensure all details are correct.'
                    : 'Once you send the mobile money payment, the transaction cannot be reversed. Please ensure all details are correct.'
                  }
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex space-x-4">
        <Button
          variant="outline"
          onClick={onBack}
          disabled={loading}
          className="flex-1"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Edit
        </Button>
        
        <Button
          onClick={onConfirm}
          disabled={loading}
          className="flex-1"
        >
          {loading ? (
            "Processing..."
          ) : (
            <>
              {getConfirmButtonText()}
              <ArrowRight className="ml-2 h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
