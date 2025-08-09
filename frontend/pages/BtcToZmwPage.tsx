import { useState } from 'react';
import { ArrowRight, Copy, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { QRCodeDisplay } from '../components/QRCodeDisplay';
import { TransactionStatus } from '../components/TransactionStatus';
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
  const [amountZmw, setAmountZmw] = useState('');
  const [loading, setLoading] = useState(false);
  const [transaction, setTransaction] = useState<CreateBtcToZmwResponse | null>(null);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!recipientPhone || !amountZmw) {
      toast({
        title: "Missing Information",
        description: "Please fill in all required fields.",
        variant: "destructive",
      });
      return;
    }

    const amount = parseFloat(amountZmw);
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

  if (transaction) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">Pay Lightning Invoice</h1>
          <p className="text-gray-600 mt-2">
            Scan the QR code or copy the invoice to complete your transaction
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Transaction Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <Label className="text-gray-500">Amount (ZMW)</Label>
                <p className="font-semibold">{formatZmw(parseFloat(amountZmw))}</p>
              </div>
              <div>
                <Label className="text-gray-500">Amount (Sats)</Label>
                <p className="font-semibold">{formatSats(transaction.amount_sats)}</p>
              </div>
              <div>
                <Label className="text-gray-500">Recipient</Label>
                <p className="font-semibold">{recipientPhone}</p>
              </div>
              <div>
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

      <Card>
        <CardHeader>
          <CardTitle>Transaction Details</CardTitle>
          <CardDescription>
            Enter the recipient's information and amount
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="phone">Recipient Phone Number</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="+260 XXX XXX XXX"
                value={recipientPhone}
                onChange={(e) => setRecipientPhone(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="amount">Amount (ZMW)</Label>
              <Input
                id="amount"
                type="number"
                placeholder="0.00"
                min="1"
                step="0.01"
                value={amountZmw}
                onChange={(e) => setAmountZmw(e.target.value)}
                required
              />
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
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
