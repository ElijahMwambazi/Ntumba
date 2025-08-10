import { useState } from 'react';
import { Download, X, FileText, Calendar, Hash, DollarSign, Bitcoin, Phone, Zap, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { generateReceiptPDF } from '../utils/pdfGenerator';
import type { Transaction } from '~backend/exchange/types';

interface ReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: Transaction;
  exchangeRate: number;
  recipientInfo?: {
    phone?: string;
    lightning_address?: string;
    lightning_invoice?: string;
  };
  senderInfo?: {
    phone?: string;
  };
}

export function ReceiptModal({
  isOpen,
  onClose,
  transaction,
  exchangeRate,
  recipientInfo,
  senderInfo
}: ReceiptModalProps) {
  const [downloading, setDownloading] = useState(false);

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

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-ZM', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short',
    }).format(date);
  };

  const getTransactionTitle = () => {
    return transaction.type === 'btc_to_zmw' 
      ? 'Bitcoin → Kwacha Exchange'
      : 'Kwacha → Bitcoin Exchange';
  };

  const getTransactionIcon = () => {
    return transaction.type === 'btc_to_zmw' 
      ? <Bitcoin className="h-5 w-5 text-orange-500" />
      : <DollarSign className="h-5 w-5 text-green-500" />;
  };

  const handleDownloadPDF = async () => {
    setDownloading(true);
    try {
      await generateReceiptPDF({
        transaction,
        exchangeRate,
        recipientInfo,
        senderInfo,
      });
    } catch (error) {
      console.error('Failed to generate PDF:', error);
    } finally {
      setDownloading(false);
    }
  };

  const getRecipientDisplay = () => {
    if (transaction.type === 'btc_to_zmw') {
      return recipientInfo?.phone || 'Mobile Money';
    } else {
      const lightning = recipientInfo?.lightning_address || recipientInfo?.lightning_invoice;
      if (lightning && lightning.length > 30) {
        return `${lightning.slice(0, 15)}...${lightning.slice(-10)}`;
      }
      return lightning || 'Lightning Address';
    }
  };

  const getSenderDisplay = () => {
    if (transaction.type === 'zmw_to_btc') {
      return senderInfo?.phone || 'Mobile Money';
    }
    return 'Lightning Network';
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <FileText className="h-5 w-5 text-blue-500" />
            <span>Transaction Receipt</span>
          </DialogTitle>
          <DialogDescription>
            Your transaction has been completed successfully. Download your receipt for your records.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Transaction Header */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-3">
                  {getTransactionIcon()}
                  <div>
                    <h3 className="font-semibold text-lg">{getTransactionTitle()}</h3>
                    <Badge variant="outline" className="mt-1">
                      {transaction.status.toUpperCase()}
                    </Badge>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-gray-500">Transaction ID</div>
                  <div className="font-mono text-sm">{transaction.id.slice(0, 8)}...</div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div className="flex items-center space-x-2">
                  <Calendar className="h-4 w-4 text-gray-400" />
                  <div>
                    <div className="text-gray-500">Date & Time</div>
                    <div className="font-medium">{formatDate(new Date(transaction.created_at))}</div>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <Hash className="h-4 w-4 text-gray-400" />
                  <div>
                    <div className="text-gray-500">Reference</div>
                    <div className="font-mono text-xs">{transaction.id}</div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Transaction Details */}
          <Card>
            <CardContent className="p-6">
              <h4 className="font-semibold mb-4">Transaction Details</h4>
              
              <div className="space-y-4">
                {/* Amount Breakdown */}
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Amount</span>
                    <div className="text-right">
                      <div className="font-medium">
                        {formatCurrency(transaction.amount_zmw, 'ZMW')}
                      </div>
                      <div className="text-sm text-gray-500">
                        ≈ {formatCurrency(transaction.amount_sats / 100000000, 'BTC')}
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Service Fee</span>
                    <div className="text-right">
                      <div className="font-medium">
                        {formatCurrency(transaction.fee_zmw, 'ZMW')}
                      </div>
                      <div className="text-sm text-gray-500">
                        ≈ {formatCurrency(transaction.fee_sats / 100000000, 'BTC')}
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <div className="flex justify-between items-center">
                    <span className="font-semibold">Total</span>
                    <div className="text-right">
                      <div className="font-bold text-lg">
                        {formatCurrency(transaction.total_zmw, 'ZMW')}
                      </div>
                      <div className="text-sm text-gray-500">
                        ≈ {formatCurrency(transaction.total_sats / 100000000, 'BTC')}
                      </div>
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Exchange Rate */}
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Exchange Rate</span>
                  <span className="font-medium">
                    1 BTC = {new Intl.NumberFormat('en-ZM', {
                      style: 'currency',
                      currency: 'ZMW',
                      minimumFractionDigits: 0,
                    }).format(exchangeRate)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Participant Details */}
          <Card>
            <CardContent className="p-6">
              <h4 className="font-semibold mb-4">Participant Details</h4>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <div className="text-sm text-gray-500">
                    {transaction.type === 'btc_to_zmw' ? 'Sender' : 'From'}
                  </div>
                  <div className="flex items-center space-x-2">
                    {transaction.type === 'btc_to_zmw' ? (
                      <Bitcoin className="h-4 w-4 text-orange-500" />
                    ) : (
                      <Phone className="h-4 w-4 text-green-500" />
                    )}
                    <span className="font-medium">{getSenderDisplay()}</span>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="text-sm text-gray-500">
                    {transaction.type === 'btc_to_zmw' ? 'Recipient' : 'To'}
                  </div>
                  <div className="flex items-center space-x-2">
                    {transaction.type === 'btc_to_zmw' ? (
                      <Phone className="h-4 w-4 text-green-500" />
                    ) : (
                      <Zap className="h-4 w-4 text-orange-500" />
                    )}
                    <span className="font-medium break-all">{getRecipientDisplay()}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Additional Information */}
          <Card>
            <CardContent className="p-6">
              <h4 className="font-semibold mb-4">Additional Information</h4>
              
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Transaction Type:</span>
                  <span className="font-medium">
                    {transaction.type === 'btc_to_zmw' ? 'Bitcoin to Kwacha' : 'Kwacha to Bitcoin'}
                  </span>
                </div>
                
                {transaction.completed_at && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Completed At:</span>
                    <span className="font-medium">
                      {formatDate(new Date(transaction.completed_at))}
                    </span>
                  </div>
                )}

                <div className="flex justify-between">
                  <span className="text-gray-600">Amount in Satoshis:</span>
                  <span className="font-mono">{formatSats(transaction.amount_sats)} sats</span>
                </div>

                <div className="flex justify-between">
                  <span className="text-gray-600">Fee in Satoshis:</span>
                  <span className="font-mono">{formatSats(transaction.fee_sats)} sats</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-3">
            <Button
              onClick={handleDownloadPDF}
              disabled={downloading}
              className="flex-1 h-12 bg-blue-500 hover:bg-blue-600 text-white"
            >
              {downloading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Opening Receipt...
                </>
              ) : (
                <>
                  <Printer className="mr-2 h-4 w-4" />
                  Print Receipt
                </>
              )}
            </Button>
            
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1 h-12"
            >
              <X className="mr-2 h-4 w-4" />
              Close
            </Button>
          </div>

          {/* Footer Note */}
          <div className="text-xs text-gray-500 text-center p-4 bg-gray-50 rounded-lg">
            <p>This receipt serves as proof of your transaction. Please keep it for your records.</p>
            <p className="mt-1">Generated by Ntumba Exchange Platform</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
