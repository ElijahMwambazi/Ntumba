import { useState, useEffect } from 'react';
import { DollarSign, Bitcoin, AlertCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface CurrencyInputProps {
  id: string;
  label: string;
  currency: 'ZMW' | 'BTC';
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  className?: string;
  min?: number;
  step?: string;
}

export function CurrencyInput({ 
  id, 
  label, 
  currency,
  placeholder, 
  value, 
  onChange, 
  required = false,
  className = "",
  min = 0,
  step = "0.01"
}: CurrencyInputProps) {
  const [error, setError] = useState<string>("");
  const [touched, setTouched] = useState(false);

  const validateAmount = (amount: string): string => {
    if (!amount && required) {
      return "Amount is required";
    }
    
    if (!amount) {
      return "";
    }

    const num = parseFloat(amount);
    
    if (isNaN(num)) {
      return "Please enter a valid number";
    }
    
    if (num <= 0) {
      return "Amount must be greater than 0";
    }
    
    if (currency === 'ZMW' && num < 1) {
      return "Minimum amount is 1 ZMW";
    }
    
    if (currency === 'BTC' && num < 0.00000001) {
      return "Minimum amount is 0.00000001 BTC";
    }
    
    return "";
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    onChange(newValue);
    
    if (touched) {
      setError(validateAmount(newValue));
    }
  };

  const handleBlur = () => {
    setTouched(true);
    setError(validateAmount(value));
  };

  useEffect(() => {
    if (touched) {
      setError(validateAmount(value));
    }
  }, [value, touched, required, currency]);

  const getCurrencyIcon = () => {
    switch (currency) {
      case 'ZMW':
        return <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />;
      case 'BTC':
        return <Bitcoin className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />;
      default:
        return null;
    }
  };

  const getPlaceholder = () => {
    if (placeholder) return placeholder;
    return currency === 'BTC' ? '0.00000000' : '0.00';
  };

  const getStep = () => {
    return currency === 'BTC' ? '0.00000001' : step;
  };

  return (
    <div className="space-y-3">
      <Label htmlFor={id} className={error ? "text-red-600" : ""}>
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </Label>
      <div className="relative">
        {getCurrencyIcon()}
        <Input
          id={id}
          type="number"
          placeholder={getPlaceholder()}
          value={value}
          onChange={handleChange}
          onBlur={handleBlur}
          min={min}
          step={getStep()}
          className={`pl-10 h-12 ${error ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''} ${className}`}
          required={required}
        />
        {error && (
          <AlertCircle className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-red-500" />
        )}
      </div>
      {error && (
        <p className="text-sm text-red-600 flex items-center">
          <AlertCircle className="h-3 w-3 mr-1" />
          {error}
        </p>
      )}
    </div>
  );
}
