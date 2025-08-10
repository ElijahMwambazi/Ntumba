import { useState, useEffect } from 'react';
import { Phone, AlertCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface PhoneInputProps {
  id: string;
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  className?: string;
}

export function PhoneInput({ 
  id, 
  label, 
  placeholder = "+260 XXX XXX XXX", 
  value, 
  onChange, 
  required = false,
  className = ""
}: PhoneInputProps) {
  const [error, setError] = useState<string>("");
  const [touched, setTouched] = useState(false);

  const formatPhoneNumber = (input: string): string => {
    // Remove all non-digit characters except +
    const cleaned = input.replace(/[^\d+]/g, '');
    
    // Ensure it starts with +260
    let formatted = cleaned;
    if (!formatted.startsWith('+260')) {
      if (formatted.startsWith('260')) {
        formatted = '+' + formatted;
      } else if (formatted.startsWith('0')) {
        formatted = '+260' + formatted.slice(1);
      } else if (formatted.match(/^\d/)) {
        formatted = '+260' + formatted;
      } else if (formatted === '+') {
        formatted = '+260';
      } else {
        formatted = '+260';
      }
    }

    // Format as +260 XXX XXX XXX
    if (formatted.length > 4) {
      const countryCode = formatted.slice(0, 4); // +260
      const remaining = formatted.slice(4);
      
      if (remaining.length <= 3) {
        formatted = `${countryCode} ${remaining}`;
      } else if (remaining.length <= 6) {
        formatted = `${countryCode} ${remaining.slice(0, 3)} ${remaining.slice(3)}`;
      } else {
        formatted = `${countryCode} ${remaining.slice(0, 3)} ${remaining.slice(3, 6)} ${remaining.slice(6, 9)}`;
      }
    }

    return formatted;
  };

  const validatePhoneNumber = (phone: string): string => {
    if (!phone && required) {
      return "Phone number is required";
    }
    
    if (!phone) {
      return "";
    }

    // Remove formatting for validation
    const cleaned = phone.replace(/[^\d+]/g, '');
    
    if (!cleaned.startsWith('+260')) {
      return "Phone number must start with +260";
    }
    
    if (cleaned.length !== 13) { // +260 + 9 digits
      return "Phone number must be 9 digits after +260";
    }
    
    return "";
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhoneNumber(e.target.value);
    onChange(formatted);
    
    if (touched) {
      setError(validatePhoneNumber(formatted));
    }
  };

  const handleBlur = () => {
    setTouched(true);
    setError(validatePhoneNumber(value));
  };

  useEffect(() => {
    if (touched) {
      setError(validatePhoneNumber(value));
    }
  }, [value, touched, required]);

  return (
    <div className="space-y-3">
      <Label htmlFor={id} className={error ? "text-red-600" : ""}>
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </Label>
      <div className="relative">
        <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          id={id}
          type="tel"
          placeholder={placeholder}
          value={value}
          onChange={handleChange}
          onBlur={handleBlur}
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
