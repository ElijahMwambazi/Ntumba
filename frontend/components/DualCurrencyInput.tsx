import { useState, useEffect } from 'react';
import { ArrowUpDown, Calculator } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CurrencyInput } from './CurrencyInput';
import { FeeBreakdown } from './FeeBreakdown';
import backend from '~backend/client';

interface DualCurrencyInputProps {
  exchangeRate: number | null;
  onAmountChange: (zmwAmount: number, btcAmount: number) => void;
  onFeeCalculationUpdate?: (calculation: FeeCalculation | null) => void;
  zmwAmount: string;
  btcAmount: string;
  transactionType: 'btc_to_zmw' | 'zmw_to_btc';
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

export function DualCurrencyInput({ 
  exchangeRate, 
  onAmountChange, 
  onFeeCalculationUpdate,
  zmwAmount, 
  btcAmount,
  transactionType
}: DualCurrencyInputProps) {
  const [activeField, setActiveField] = useState<'zmw' | 'btc'>('zmw');
  const [localZmwAmount, setLocalZmwAmount] = useState(zmwAmount);
  const [localBtcAmount, setLocalBtcAmount] = useState(btcAmount);
  const [feeCalculation, setFeeCalculation] = useState<FeeCalculation | null>(null);
  const [calculatingFees, setCalculatingFees] = useState(false);

  useEffect(() => {
    setLocalZmwAmount(zmwAmount);
    setLocalBtcAmount(btcAmount);
  }, [zmwAmount, btcAmount]);

  const convertZmwToBtc = (zmw: number): number => {
    if (!exchangeRate || zmw <= 0) return 0;
    return zmw / exchangeRate;
  };

  const convertBtcToZmw = (btc: number): number => {
    if (!exchangeRate || btc <= 0) return 0;
    return btc * exchangeRate;
  };

  const calculateFees = async (amountZmw: number) => {
    if (amountZmw <= 0) {
      setFeeCalculation(null);
      onFeeCalculationUpdate?.(null);
      return;
    }

    setCalculatingFees(true);
    try {
      const response = await backend.exchange.calculateFees({
        amount_zmw: amountZmw,
        transaction_type: transactionType,
      });
      setFeeCalculation(response);
      onFeeCalculationUpdate?.(response);
    } catch (error) {
      console.error('Failed to calculate fees:', error);
      setFeeCalculation(null);
      onFeeCalculationUpdate?.(null);
    } finally {
      setCalculatingFees(false);
    }
  };

  const handleZmwChange = (value: string) => {
    setLocalZmwAmount(value);
    setActiveField('zmw');
    
    const zmw = parseFloat(value) || 0;
    const btc = convertZmwToBtc(zmw);
    
    setLocalBtcAmount(btc > 0 ? btc.toFixed(8) : '');
    onAmountChange(zmw, btc);

    // Calculate fees with debouncing
    if (zmw > 0) {
      const timeoutId = setTimeout(() => calculateFees(zmw), 500);
      return () => clearTimeout(timeoutId);
    } else {
      setFeeCalculation(null);
      onFeeCalculationUpdate?.(null);
    }
  };

  const handleBtcChange = (value: string) => {
    setLocalBtcAmount(value);
    setActiveField('btc');
    
    const btc = parseFloat(value) || 0;
    const zmw = convertBtcToZmw(btc);
    
    setLocalZmwAmount(zmw > 0 ? zmw.toFixed(2) : '');
    onAmountChange(zmw, btc);

    // Calculate fees with debouncing
    if (zmw > 0) {
      const timeoutId = setTimeout(() => calculateFees(zmw), 500);
      return () => clearTimeout(timeoutId);
    } else {
      setFeeCalculation(null);
      onFeeCalculationUpdate?.(null);
    }
  };

  const swapFields = () => {
    setActiveField(activeField === 'zmw' ? 'btc' : 'zmw');
  };

  const formatBtcDisplay = (btc: string) => {
    const num = parseFloat(btc);
    if (isNaN(num) || num === 0) return '';
    return num.toFixed(8);
  };

  const formatZmwDisplay = (zmw: string) => {
    const num = parseFloat(zmw);
    if (isNaN(num) || num === 0) return '';
    return num.toFixed(2);
  };

  return (
    <div className="space-y-4">
      <div className="relative">
        <div className="space-y-2">
          <CurrencyInput
            id="zmw-amount"
            label="Amount (ZMW)"
            currency="ZMW"
            value={localZmwAmount}
            onChange={handleZmwChange}
            className={activeField === 'zmw' ? 'ring-2 ring-blue-500' : ''}
            required
          />
          {activeField === 'zmw' && (
            <div className="text-xs text-blue-600 font-medium">Active field</div>
          )}
        </div>

        <div className="flex justify-center my-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={swapFields}
            className="rounded-full p-2"
          >
            <ArrowUpDown className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-2">
          <CurrencyInput
            id="btc-amount"
            label="Amount (BTC)"
            currency="BTC"
            value={localBtcAmount}
            onChange={handleBtcChange}
            className={activeField === 'btc' ? 'ring-2 ring-blue-500' : ''}
            step="0.00000001"
          />
          {activeField === 'btc' && (
            <div className="text-xs text-blue-600 font-medium">Active field</div>
          )}
        </div>
      </div>

      {exchangeRate && (localZmwAmount || localBtcAmount) && !feeCalculation && (
        <div className="text-sm text-gray-600 bg-gray-50 p-3 rounded-lg">
          <div className="flex justify-between">
            <span>Exchange Rate:</span>
            <span>1 BTC = {new Intl.NumberFormat('en-ZM', {
              style: 'currency',
              currency: 'ZMW',
              minimumFractionDigits: 0,
            }).format(exchangeRate)}</span>
          </div>
          {localZmwAmount && parseFloat(localZmwAmount) > 0 && (
            <div className="flex justify-between mt-1">
              <span>You're sending:</span>
              <span className="font-medium">
                {formatZmwDisplay(localZmwAmount)} ZMW ≈ {formatBtcDisplay(localBtcAmount)} BTC
              </span>
            </div>
          )}
        </div>
      )}

      {calculatingFees && (
        <div className="flex items-center justify-center p-4 bg-gray-50 rounded-lg">
          <Calculator className="h-4 w-4 animate-pulse mr-2" />
          <span className="text-sm text-gray-600">Calculating fees...</span>
        </div>
      )}

      {feeCalculation && (
        <FeeBreakdown
          amount={feeCalculation.amount_zmw}
          fee={feeCalculation.fee_zmw}
          total={feeCalculation.total_zmw}
          currency="ZMW"
          exchangeRate={feeCalculation.exchange_rate}
          feePercentage={feeCalculation.fee_percentage}
          estimatedDeliveryTime={feeCalculation.estimated_delivery_time}
        />
      )}
    </div>
  );
}
