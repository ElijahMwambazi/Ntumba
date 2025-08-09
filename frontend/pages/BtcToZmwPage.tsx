import { useState } from 'react';
import { ArrowRight, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { QRCodeDisplay } from '../components/QRCodeDisplay';
import { TransactionStatus } from '../components/TransactionStatus';
import { ExchangeRateDisplay } from '../components/ExchangeRateDisplay';
import { DualCurrencyInput } from '../components/DualCurrencyInput';
import { PhoneInput } from '../components/PhoneInput';
import backend from '~backend/client';

interface CreateBtcToZmwResponse {
  transaction_id: string;
  lightning_invoice: string;
  amount_sats: number;
  exchange_rate: number;
  expires_at: string;
}

export function BtcToZmwPage() {
  const [recipientPhone, setRecipientPhone] = useState('');
  const [zmwAmount, setZmwAmount] = useState('');
  const [btcAmount, setBtcAmount] = useState('');
  const [exchangeRate, setExchangeRate] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [transaction, setTransaction] = useState<CreateBtcToZmwResponse | null>(null);
  const [formErrors, setFormErrors] = useState<{[key: string]: string}>({});
  const { toast } = useToast();

  const handleAmountChange = (zmw: number, btc: number) => {
    setZmwAmount(zmw > 0 ? zmw.toString() : '');
    setBtcAmount(btc > 0 ? btc.toString() : '');
    
    // Clear amount error when user starts typing
    if (formErrors.amount) {
      setFormErrors(prev => ({ ...prev, amount: '' }));
    }
  };

  const validateForm = (): boolean => {
    const errors: {[key: string]: string} = {};
    
    // Validate phone number
    if (!recipientPhone) {
      errors.phone = 'Recipient phone number is required';
    } else {
      const cleaned = recipientPhone.replace(/[^\d+]/g, '');
      if (!cleaned.startsWith('+260') || cleaned.length !== 13) {
        errors.phone = 'Please enter a valid Zambian phone number';
      }
    }
    
    // Validate amount
    if (!zmwAmount) {
      errors.amount = 'Amount is required';
    } else {
      const amount = parseFloat(zmwAmount);
      if (isNaN(amount) || amount <= 0) {
        errors.amount = 'Please enter a valid amount greater than 0';
      } else if (amount < 1) {
        errors.amount = 'Minimum amount is 1 ZMW';
      }
    }
    
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      toast({
        title: "Please fix the errors",
        description: "Check the form for validation errors.",
        variant: "destructive",
      });
      return;
    }

    const amount = parseFloat(zmwAmount);

    setLoading(true);
    try {
      const response = await backend.exchange.createBtcToZmw({
        amount_zmw: amount,
        recipient_info: { phone: recipientPhone },
      });
      
      setTransaction(response);
      toast({
        title: "Transaction Created",
        description: "Please pay the Lightning invoice to complete the transaction.",
      });
    } catch (error) {
      console.error('Failed to create transaction:', error);
      toast({
        title: "Transaction Failed",
        description: "Failed to create transaction. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const copyInvoice = () => {
    if (transaction) {
      navigator.clipboard.writeText(transaction.lightning_invoice);
      toast({
        title: "Copied",
        description: "Lightning invoice copied to clipboard.",
      });
    }
  };

  const formatSats = (sats: number) => {
    return new Intl.NumberFormat().format(sats);
  };

  const formatZmw = (amount: number) => {
    return new Intl.NumberFormat('en-ZM', {
      style: 'currency',
      currency: 'ZMW',
    }).format(amount);
  };

  const formatBtc = (amount: number) => {
    return amount.toFixed(8);
  };

  if (transaction) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">Pay Lightning Invoice</h1>
          <p className="text-gray-600 mt-2">
            Scan the QR code or copy the invoice to complete your transaction
          </p>
        </div>

        <ExchangeRateDisplay />

        <Card>
          <CardHeader>
            <CardTitle>Transaction Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <Label className="text-gray-500">Amount (ZMW)</Label>
                <p className="font-semibold">{formatZmw(parseFloat(zmwAmount))}</p>
              </div>
              <div>
                <Label className="text-gray-500">Amount (BTC)</Label>
                <p className="font-semibold">{formatBtc(parseFloat(btcAmount))}</p>
              </div>
              <div>
                <Label className="text-gray-500">Amount (Sats)</Label>
                <p className="font-semibold">{formatSats(transaction.amount_sats)}</p>
              </div>
              <div>
                <Label className="text-gray-500">Recipient</Label>
                <p className="font-semibold">{recipientPhone}</p>
              </div>
            </div>
            <div className="pt-2 border-t">
              <div className="flex justify-between text-sm">
                <Label className="text-gray-500">Exchange Rate</Label>
                <p className="font-semibold">1 BTC = {formatZmw(transaction.exchange_rate)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Lightning Invoice</CardTitle>
            <CardDescription>
              Pay this invoice with your Lightning wallet
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <QRCodeDisplay value={transaction.lightning_invoice} />
            
            <div className="space-y-2">
              <Label>Invoice</Label>
              <div className="flex space-x-2">
                <Input
                  value={transaction.lightning_invoice}
                  readOnly
                  className="font-mono text-xs"
                />
                <Button variant="outline" size="sm" onClick={copyInvoice}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="text-sm text-gray-500">
              Expires: {new Date(transaction.expires_at).toLocaleString()}
            </div>
          </CardContent>
        </Card>

        <TransactionStatus transactionId={transaction.transaction_id} />

        <div className="text-center">
          <Button variant="outline" onClick={() => setTransaction(null)}>
            Create New Transaction
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-900">Bitcoin → Kwacha</h1>
        <p className="text-gray-600 mt-2">
          Send Bitcoin and recipient gets Kwacha via mobile money
        </p>
      </div>

      <ExchangeRateDisplay onRateUpdate={setExchangeRate} />

      <Card>
        <CardHeader>
          <CardTitle>Transaction Details</CardTitle>
          <CardDescription>
            Enter the recipient's information and amount
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <PhoneInput
              id="phone"
              label="Recipient Phone Number"
              value={recipientPhone}
              onChange={setRecipientPhone}
              required
            />

            <DualCurrencyInput
              exchangeRate={exchangeRate}
              onAmountChange={handleAmountChange}
              zmwAmount={zmwAmount}
              btcAmount={btcAmount}
            />

            <Button type="submit" className="w-full" disabled={loading || !zmwAmount || !recipientPhone}>
              {loading ? (
                "Creating Transaction..."
              ) : (
                <>
                  Create Transaction
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
