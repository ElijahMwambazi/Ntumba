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
import { FeeBreakdown } from '../components/FeeBreakdown';
import { ConfirmationStep } from '../components/ConfirmationStep';
import { QuickFillCard } from '../components/QuickFillCard';
import { useRecentRecipients } from '../hooks/useRecentRecipients';
import { useRecentTransactions } from '../hooks/useRecentTransactions';
import backend from '~backend/client';

interface CreateBtcToZmwResponse {
  transaction_id: string;
  lightning_invoice: string;
  amount_sats: number;
  fee_sats: number;
  total_sats: number;
  exchange_rate: number;
  expires_at: string;
}

interface FeeCalculation {
  amount_zmw: number;
  amount_sats: number;
  fee_zmw: number;
  fee_sats: number;
  total_zmw: number;
  total_sats: number;
  fee_percentage: number;
  exchange_rate: number;
  estimated_delivery_time: string;
}

type Step = 'form' | 'confirm' | 'payment';

export function BtcToZmwPage() {
  const [currentStep, setCurrentStep] = useState<Step>('form');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [zmwAmount, setZmwAmount] = useState('');
  const [btcAmount, setBtcAmount] = useState('');
  const [exchangeRate, setExchangeRate] = useState<number | null>(null);
  const [feeCalculation, setFeeCalculation] = useState<FeeCalculation | null>(null);
  const [loading, setLoading] = useState(false);
  const [transaction, setTransaction] = useState<CreateBtcToZmwResponse | null>(null);
  const [formErrors, setFormErrors] = useState<{[key: string]: string}>({});
  const { toast } = useToast();
  const { recentRecipients, addRecentRecipient } = useRecentRecipients();
  const { 
    recentTransactions, 
    addRecentTransaction, 
    clearRecentTransactions,
    getTransactionsForType 
  } = useRecentTransactions();

  const btcToZmwTransactions = getTransactionsForType('btc_to_zmw');

  const handleAmountChange = (zmw: number, btc: number) => {
    setZmwAmount(zmw > 0 ? zmw.toString() : '');
    setBtcAmount(btc > 0 ? btc.toString() : '');
    
    // Clear amount error when user starts typing
    if (formErrors.amount) {
      setFormErrors(prev => ({ ...prev, amount: '' }));
    }
  };

  const handleFeeCalculationUpdate = (calculation: FeeCalculation | null) => {
    setFeeCalculation(calculation);
  };

  const handleQuickFill = (recentTransaction: any) => {
    setRecipientPhone(recentTransaction.recipient_phone || '');
    setZmwAmount(recentTransaction.amount_zmw.toString());
    
    // Calculate BTC amount based on current exchange rate
    if (exchangeRate) {
      const btc = recentTransaction.amount_zmw / exchangeRate;
      setBtcAmount(btc.toString());
    }

    toast({
      title: "Form filled",
      description: "Transaction details have been filled from your recent history.",
    });
  };

  const handleClearHistory = () => {
    clearRecentTransactions();
    toast({
      title: "History cleared",
      description: "All recent transactions have been removed.",
    });
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

    // Validate fee calculation exists
    if (!feeCalculation) {
      errors.fees = 'Please wait for fee calculation to complete';
    }
    
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      toast({
        title: "Please fix the errors",
        description: "Check the form for validation errors.",
        variant: "destructive",
      });
      return;
    }

    setCurrentStep('confirm');
  };

  const handleConfirm = async () => {
    if (!feeCalculation) {
      toast({
        title: "Error",
        description: "Fee calculation is missing. Please go back and try again.",
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
      setCurrentStep('payment');
      
      // Save recipient to recent list
      addRecentRecipient(recipientPhone);
      
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

  const handleBack = () => {
    setCurrentStep('form');
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

  const formatBtc = (sats: number) => {
    return (sats / 100000000).toFixed(8);
  };

  const resetForm = () => {
    setCurrentStep('form');
    setTransaction(null);
    setRecipientPhone('');
    setZmwAmount('');
    setBtcAmount('');
    setFeeCalculation(null);
    setFormErrors({});
  };

  // Handle successful transaction completion
  const handleTransactionComplete = (completedTransaction: any) => {
    if (completedTransaction.status === 'completed' && exchangeRate) {
      addRecentTransaction({
        id: completedTransaction.id,
        type: 'btc_to_zmw',
        amount_zmw: parseFloat(zmwAmount),
        recipient_phone: recipientPhone,
        exchange_rate: exchangeRate
      });
    }
  };

  // Confirmation Step
  if (currentStep === 'confirm' && feeCalculation) {
    return (
      <ConfirmationStep
        transactionType="btc_to_zmw"
        recipientPhone={recipientPhone}
        zmwAmount={zmwAmount}
        btcAmount={btcAmount}
        feeCalculation={feeCalculation}
        onBack={handleBack}
        onConfirm={handleConfirm}
        loading={loading}
      />
    );
  }

  // Payment Step
  if (currentStep === 'payment' && transaction) {
    const totalBtc = transaction.total_sats / 100000000;
    const amountBtc = transaction.amount_sats / 100000000;
    const feeBtc = transaction.fee_sats / 100000000;

    return (
      <div className="max-w-2xl mx-auto space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">Pay Lightning Invoice</h1>
          <p className="text-gray-600 mt-3">
            Scan the QR code or copy the invoice to complete your transaction
          </p>
        </div>

        <ExchangeRateDisplay />

        <FeeBreakdown
          amount={amountBtc}
          fee={feeBtc}
          total={totalBtc}
          currency="BTC"
          exchangeRate={transaction.exchange_rate}
          estimatedDeliveryTime="Funds arrive within 5-10 minutes after Lightning payment"
        />

        <Card>
          <CardHeader>
            <CardTitle>Transaction Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 gap-6 text-sm">
              <div>
                <Label className="text-gray-500">Recipient gets</Label>
                <p className="font-semibold mt-1">{formatZmw(parseFloat(zmwAmount))}</p>
              </div>
              <div>
                <Label className="text-gray-500">Recipient</Label>
                <p className="font-semibold mt-1">{recipientPhone}</p>
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
          <CardContent className="space-y-6">
            <QRCodeDisplay value={transaction.lightning_invoice} />
            
            <div className="space-y-3">
              <Label>Invoice</Label>
              <div className="flex space-x-2">
                <Input
                  value={transaction.lightning_invoice}
                  readOnly
                  className="font-mono text-xs"
                />
                <Button variant="outline" size="sm" onClick={copyInvoice} className="min-w-[44px] h-10">
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="text-sm text-gray-500">
              Expires: {new Date(transaction.expires_at).toLocaleString()}
            </div>
          </CardContent>
        </Card>

        <TransactionStatus 
          transactionId={transaction.transaction_id}
          exchangeRate={transaction.exchange_rate}
          recipientInfo={{ phone: recipientPhone }}
          onTransactionUpdate={handleTransactionComplete}
        />

        <div className="text-center">
          <Button variant="outline" onClick={resetForm} className="h-12 px-8">
            Create New Transaction
          </Button>
        </div>
      </div>
    );
  }

  // Form Step
  return (
    <div className="max-w-md mx-auto space-y-8">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-900">Bitcoin → Kwacha</h1>
        <p className="text-gray-600 mt-3">
          Send Bitcoin and recipient gets Kwacha via mobile money
        </p>
      </div>

      <ExchangeRateDisplay onRateUpdate={setExchangeRate} />

      {btcToZmwTransactions.length > 0 && (
        <QuickFillCard
          transactions={btcToZmwTransactions}
          onQuickFill={handleQuickFill}
          onClearHistory={handleClearHistory}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Transaction Details</CardTitle>
          <CardDescription>
            Enter the recipient's information and amount
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleFormSubmit} className="space-y-6">
            <PhoneInput
              id="phone"
              label="Recipient Phone Number"
              value={recipientPhone}
              onChange={setRecipientPhone}
              required
              recentNumbers={recentRecipients.map(r => r.phone)}
              onSelectRecent={setRecipientPhone}
            />

            <DualCurrencyInput
              exchangeRate={exchangeRate}
              onAmountChange={handleAmountChange}
              onFeeCalculationUpdate={handleFeeCalculationUpdate}
              zmwAmount={zmwAmount}
              btcAmount={btcAmount}
              transactionType="btc_to_zmw"
            />

            <Button 
              type="submit" 
              className="w-full h-12 bg-orange-500 hover:bg-orange-600 text-white font-semibold" 
              disabled={!zmwAmount || !recipientPhone || !feeCalculation}
            >
              Review Transaction
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
