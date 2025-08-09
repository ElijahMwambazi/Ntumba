import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { TransactionStatus } from '../components/TransactionStatus';
import { ExchangeRateDisplay } from '../components/ExchangeRateDisplay';
import { DualCurrencyInput } from '../components/DualCurrencyInput';
import backend from '~backend/client';

interface CreateZmwToBtcResponse {
  transaction_id: string;
  amount_sats: number;
  exchange_rate: number;
  collection_reference: string;
}

export function ZmwToBtcPage() {
  const [senderPhone, setSenderPhone] = useState('');
  const [recipientLightning, setRecipientLightning] = useState('');
  const [zmwAmount, setZmwAmount] = useState('');
  const [btcAmount, setBtcAmount] = useState('');
  const [exchangeRate, setExchangeRate] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [transaction, setTransaction] = useState<CreateZmwToBtcResponse | null>(null);
  const { toast } = useToast();

  const handleAmountChange = (zmw: number, btc: number) => {
    setZmwAmount(zmw > 0 ? zmw.toString() : '');
    setBtcAmount(btc > 0 ? btc.toString() : '');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!senderPhone || !recipientLightning || !zmwAmount) {
      toast({
        title: "Missing Information",
        description: "Please fill in all required fields.",
        variant: "destructive",
      });
      return;
    }

    const amount = parseFloat(zmwAmount);
    if (isNaN(amount) || amount <= 0) {
      toast({
        title: "Invalid Amount",
        description: "Please enter a valid amount.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const response = await backend.exchange.createZmwToBtc({
        amount_zmw: amount,
        sender_phone: senderPhone,
        recipient_info: { lightning_address: recipientLightning },
      });
      
      setTransaction(response);
      toast({
        title: "Transaction Created",
        description: "Please send the Kwacha from your mobile money account.",
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
          <h1 className="text-3xl font-bold text-gray-900">Send Mobile Money</h1>
          <p className="text-gray-600 mt-2">
            Complete the mobile money payment to receive Bitcoin
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
                <Label className="text-gray-500">Your Phone</Label>
                <p className="font-semibold">{senderPhone}</p>
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
            <CardTitle>Payment Instructions</CardTitle>
            <CardDescription>
              Send money from your mobile money account
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-blue-50 p-4 rounded-lg">
              <h3 className="font-semibold text-blue-900 mb-2">Mobile Money Payment</h3>
              <div className="space-y-2 text-sm">
                <p><strong>Reference:</strong> {transaction.collection_reference}</p>
                <p><strong>Amount:</strong> {formatZmw(parseFloat(zmwAmount))}</p>
                <p className="text-blue-700">
                  You should receive a mobile money prompt on your phone ({senderPhone}) shortly.
                </p>
              </div>
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
        <h1 className="text-3xl font-bold text-gray-900">Kwacha → Bitcoin</h1>
        <p className="text-gray-600 mt-2">
          Send Kwacha via mobile money and receive Bitcoin
        </p>
      </div>

      <ExchangeRateDisplay onRateUpdate={setExchangeRate} />

      <Card>
        <CardHeader>
          <CardTitle>Transaction Details</CardTitle>
          <CardDescription>
            Enter your phone number and recipient's Lightning address
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sender-phone">Your Phone Number</Label>
              <Input
                id="sender-phone"
                type="tel"
                placeholder="+260 XXX XXX XXX"
                value={senderPhone}
                onChange={(e) => setSenderPhone(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="lightning">Recipient Lightning Address</Label>
              <Input
                id="lightning"
                type="text"
                placeholder="user@wallet.com or Lightning invoice"
                value={recipientLightning}
                onChange={(e) => setRecipientLightning(e.target.value)}
                required
              />
            </div>

            <DualCurrencyInput
              exchangeRate={exchangeRate}
              onAmountChange={handleAmountChange}
              zmwAmount={zmwAmount}
              btcAmount={btcAmount}
            />

            <Button type="submit" className="w-full" disabled={loading || !zmwAmount}>
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
