import { useState, useEffect } from 'react';
import { Zap, AlertCircle, Clock, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface LightningAddressInputProps {
  id: string;
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  className?: string;
  recentAddresses?: string[];
  onSelectRecent?: (address: string) => void;
}

export function LightningAddressInput({ 
  id, 
  label, 
  placeholder = "user@wallet.com or Lightning invoice", 
  value, 
  onChange, 
  required = false,
  className = "",
  recentAddresses = [],
  onSelectRecent
}: LightningAddressInputProps) {
  const [error, setError] = useState<string>("");
  const [touched, setTouched] = useState(false);
  const [showRecent, setShowRecent] = useState(false);

  const validateLightningAddress = (address: string): string => {
    if (!address && required) {
      return "Lightning address or invoice is required";
    }
    
    if (!address) {
      return "";
    }
    
    // Lightning address format: user@domain.com
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    
    // Lightning invoice format: starts with ln
    const invoiceRegex = /^ln[a-zA-Z0-9]+$/i;
    
    if (!emailRegex.test(address) && !invoiceRegex.test(address)) {
      return "Please enter a valid Lightning address (user@domain.com) or invoice";
    }
    
    return "";
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    onChange(newValue);
    
    if (touched) {
      setError(validateLightningAddress(newValue));
    }
  };

  const handleBlur = () => {
    setTouched(true);
    setError(validateLightningAddress(value));
    setShowRecent(false);
  };

  const handleFocus = () => {
    if (recentAddresses.length > 0 && !value) {
      setShowRecent(true);
    }
  };

  const handleSelectRecent = (address: string) => {
    onChange(address);
    setShowRecent(false);
    onSelectRecent?.(address);
    if (touched) {
      setError(validateLightningAddress(address));
    }
  };

  const formatDisplayAddress = (address: string) => {
    // Truncate long Lightning invoices for display
    if (address.startsWith('ln') && address.length > 30) {
      return `${address.slice(0, 15)}...${address.slice(-10)}`;
    }
    return address;
  };

  const getAddressType = (address: string) => {
    if (address.includes('@')) {
      return 'Lightning Address';
    } else if (address.startsWith('ln')) {
      return 'Invoice';
    }
    return 'Address';
  };

  useEffect(() => {
    if (touched) {
      setError(validateLightningAddress(value));
    }
  }, [value, touched, required]);

  return (
    <div className="space-y-3 relative">
      <Label htmlFor={id} className={error ? "text-red-600" : ""}>
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </Label>
      <div className="relative">
        <Zap className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          id={id}
          type="text"
          placeholder={placeholder}
          value={value}
          onChange={handleChange}
          onBlur={handleBlur}
          onFocus={handleFocus}
          className={`pl-10 h-12 ${error ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''} ${className}`}
          required={required}
        />
        {error && (
          <AlertCircle className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-red-500" />
        )}
        {recentAddresses.length > 0 && !value && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowRecent(!showRecent)}
            className="absolute right-3 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
          >
            <Clock className="h-3 w-3 text-gray-400" />
          </Button>
        )}
      </div>
      
      {showRecent && recentAddresses.length > 0 && (
        <Card className="absolute top-full left-0 right-0 z-10 mt-1">
          <CardContent className="p-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500 font-medium">Recent Addresses</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowRecent(false)}
                className="h-4 w-4 p-0"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
            <div className="space-y-1">
              {recentAddresses.map((address, index) => (
                <Button
                  key={index}
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleSelectRecent(address)}
                  className="w-full justify-start h-auto px-2 py-2 text-sm"
                >
                  <div className="flex flex-col items-start w-full">
                    <div className="flex items-center">
                      <Zap className="h-3 w-3 mr-2 text-gray-400" />
                      <span className="font-mono text-xs">{formatDisplayAddress(address)}</span>
                    </div>
                    <span className="text-xs text-gray-500 ml-5">{getAddressType(address)}</span>
                  </div>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
      
      {error && (
        <p className="text-sm text-red-600 flex items-center">
          <AlertCircle className="h-3 w-3 mr-1" />
          {error}
        </p>
      )}
    </div>
  );
}
