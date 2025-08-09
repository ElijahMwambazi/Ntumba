import { useEffect, useState } from 'react';
import { RefreshCw, TrendingUp, TrendingDown } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import backend from '~backend/client';

interface ExchangeRateDisplayProps {
  onRateUpdate?: (rate: number) => void;
}

export function ExchangeRateDisplay({ onRateUpdate }: ExchangeRateDisplayProps) {
  const [rate, setRate] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [trend, setTrend] = useState<'up' | 'down' | 'neutral'>('neutral');

  const fetchRate = async () => {
    try {
      const response = await backend.exchange.getExchangeRate();
      const newRate = response.btc_zmw_rate;
      
      if (rate !== null) {
        setTrend(newRate > rate ? 'up' : newRate < rate ? 'down' : 'neutral');
      }
      
      setRate(newRate);
      setLastUpdated(new Date(response.timestamp));
      onRateUpdate?.(newRate);
    } catch (error) {
      console.error('Failed to fetch exchange rate:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRate();

    // Auto-refresh every 45 seconds
    const interval = setInterval(fetchRate, 45000);
    return () => clearInterval(interval);
  }, []);

  const formatRate = (rate: number) => {
    return new Intl.NumberFormat('en-ZM', {
      style: 'currency',
      currency: 'ZMW',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(rate);
  };

  const getTrendIcon = () => {
    switch (trend) {
      case 'up':
        return <TrendingUp className="h-4 w-4 text-green-500" />;
      case 'down':
        return <TrendingDown className="h-4 w-4 text-red-500" />;
      default:
        return null;
    }
  };

  const getTrendColor = () => {
    switch (trend) {
      case 'up':
        return 'text-green-600';
      case 'down':
        return 'text-red-600';
      default:
        return 'text-gray-900';
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="animate-pulse">
            <div className="h-6 bg-gray-200 rounded w-48 mx-auto"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="text-sm text-gray-500">1 BTC =</span>
            <span className={`text-lg font-bold ${getTrendColor()}`}>
              {rate ? formatRate(rate) : 'Loading...'}
            </span>
            {getTrendIcon()}
          </div>
          
          <div className="flex items-center space-x-2">
            {lastUpdated && (
              <span className="text-xs text-gray-400">
                {lastUpdated.toLocaleTimeString()}
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={fetchRate}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
