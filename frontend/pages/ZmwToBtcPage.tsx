import { useState } from 'react';
import { ArrowRight, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { TransactionStatus } from '../components/TransactionStatus';
import { ExchangeRateDisplay } from '../components/ExchangeRateDisplay';
import { DualCurrencyInput } from '../components/DualCurrencyInput';
import { PhoneInput } from '../components/PhoneInput';
import { FeeBreakdown } from '../components/FeeBreakdown';
import { ConfirmationStep } from '../components/ConfirmationStep';
import backend from '~backend/client';

interface CreateZmwToBtcResponse {
  transaction_id: string;
  amount_sats: number;
  fee_sats: number;
  total_sats: number;
  exchange_rate: number;
  collection_reference: string;
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

export function ZmwToBtcPage() {
  const [currentStep, setCurrentStep] = useState<Step>('form');
  const [senderPhone, setSenderPhone] = useState('');
  const [recipientLightning, setRecipientLightning] = useState('');
  const [zmwAmount, setZmwAmount] = useState('');
  const [btcAmount, setBtcAmount] = useState('');
  const [exchangeRate, setExchangeRate] = useState<number | null>(null);
  const [feeCalculation, setFeeCalculation] = useState<FeeCalculation | null>(null);
  const [loading, setLoading] = useState(false);
  const [transaction, setTransaction] = useState<CreateZmwToBtcResponse | null>(null);
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

  const handleFeeCalculationUpdate = (calculation: FeeCalculation | null) => {
    setFeeCalculation(calculation);
  };

  const validateLightningAddress = (address: string): boolean => {
    // Basic validation for Lightning address or invoice
    if (!address) return false;
    
    // Lightning address format: user@domain.com
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    
    // Lightning invoice format: starts with ln
    const invoiceRegex = /^ln[a-zA-Z0-9]+$/i;
    
    return emailRegex.test(address) || invoiceRegex.test(address);
  };

  const validateForm = (): boolean => {
    const errors: {[key: string]: string} = {};
    
    // Validate sender phone number
    if (!senderPhone) {
      errors.senderPhone = 'Your phone number is required';
    } else {
      const cleaned = senderPhone.replace(/[^\d+]/g, '');
      if (!cleaned.startsWith('+260') || cleaned.length !== 13) {
        errors.senderPhone = 'Please enter a valid Zambian phone number';
      }
    }
    
    // Validate Lightning address
    if (!recipientLightning) {
      errors.lightning = 'Lightning address or invoice is required';
    } else if (!validateLightningAddress(recipientLightning)) {
      errors.lightning = 'Please enter a valid Lightning address (user@domain.com) or invoice';
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
      const response = await backend.exchange.createZmwToBtc({
        amount_zmw: amount,
        sender_phone: senderPhone,
        recipient_info: { lightning_address: recipientLightning },
      });
      
      setTransaction(response);
      setCurrentStep('payment');
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

  const handleBack = () => {
    setCurrentStep('form');
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
    setSenderPhone('');
    setRecipientLightning('');
    setZmwAmount('');
    setBtcAmount('');
    setFeeCalculation(null);
    setFormErrors({});
  };

  // Confirmation Step
  if (currentStep === 'confirm' && feeCalculation) {
    return (
      <ConfirmationStep
        transactionType="zmw_to_btc"
        senderPhone={senderPhone}
        recipientLightning={recipientLightning}
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
    const totalZmw = (transaction.amount_sats + transaction.fee_sats) / 100000000 * transaction.exchange_rate;
    const amountZmw = parseFloat(zmwAmount);
    const feeZmw = totalZmw - amountZmw;
    const amountBtc = transaction.amount_sats / 100000000;

    return (
      <div className="max-w-2xl mx-auto space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">Send Mobile Money</h1>
          <p className="text-gray-600 mt-3">
            Complete the mobile money payment to receive Bitcoin
          </p>
        </div>

        <ExchangeRateDisplay />

        <FeeBreakdown
          amount={amountZmw}
          fee={feeZmw}
          total={totalZmw}
          currency="ZMW"
          exchangeRate={transaction.exchange_rate}
          estimatedDeliveryTime="Bitcoin sent instantly after mobile money confirmation"
        />

        <Card>
          <CardHeader>
            <CardTitle>Transaction Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 gap-6 text-sm">
              <div>
                <Label className="text-gray-500">You'll receive</Label>
                <p className="font-semibold mt-1">{formatBtc(transaction.amount_sats)} BTC</p>
                <p className="text-xs text-gray-500">{formatSats(transaction.amount_sats)} sats</p>
              </div>
              <div>
                <Label className="text-gray-500">Your Phone</Label>
                <p className="font-semibold mt-1">{senderPhone}</p>
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
          <CardContent className="space-y-6">
            <div className="bg-blue-50 p-6 rounded-lg">
              <h3 className="font-semibold text-blue-900 mb-3">Mobile Money Payment</h3>
              <div className="space-y-3 text-sm">
                <p><strong>Reference:</strong> {transaction.collection_reference}</p>
                <p><strong>Total Amount:</strong> {formatZmw(totalZmw)}</p>
                <p className="text-blue-700">
                  You should receive a mobile money prompt on your phone ({senderPhone}) shortly.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <TransactionStatus transactionId={transaction.transaction_id} />

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
        <h1 className="text-3xl font-bold text-gray-900">Kwacha → Bitcoin</h1>
        <p className="text-gray-600 mt-3">
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
          <form onSubmit={handleFormSubmit} className="space-y-6">
            <PhoneInput
              id="sender-phone"
              label="Your Phone Number"
              value={senderPhone}
              onChange={setSenderPhone}
              required
            />

            <div className="space-y-3">
              <Label htmlFor="lightning" className={formErrors.lightning ? "text-red-600" : ""}>
                Recipient Lightning Address
                <span className="text-red-500 ml-1">*</span>
              </Label>
              <div className="relative">
                <Zap className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  id="lightning"
                  type="text"
                  placeholder="user@wallet.com or Lightning invoice"
                  value={recipientLightning}
                  onChange={(e) => {
                    setRecipientLightning(e.target.value);
                    if (formErrors.lightning) {
                      setFormErrors(prev => ({ ...prev, lightning: '' }));
                    }
                  }}
                  className={`pl-10 h-12 ${formErrors.lightning ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''}`}
                  required
                />
              </div>
              {formErrors.lightning && (
                <p className="text-sm text-red-600">{formErrors.lightning}</p>
              )}
            </div>

            <DualCurrencyInput
              exchangeRate={exchangeRate}
              onAmountChange={handleAmountChange}
              onFeeCalculationUpdate={handleFeeCalculationUpdate}
              zmwAmount={zmwAmount}
              btcAmount={btcAmount}
              transactionType="zmw_to_btc"
            />

            <Button 
              type="submit" 
              className="w-full h-12 bg-orange-500 hover:bg-orange-600 text-white font-semibold" 
              disabled={!zmwAmount || !senderPhone || !recipientLightning || !feeCalculation}
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
