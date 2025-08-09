import { useEffect, useState } from 'react';
import { Droplets, TrendingUp, TrendingDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import backend from '~backend/client';

interface LiquidityPool {
  currency: string;
  balance: number;
  reserved: number;
  available: number;
}

export function LiquidityPage() {
  const [pools, setPools] = useState<LiquidityPool[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLiquidityStatus();
    
    // Refresh every 30 seconds
    const interval = setInterval(fetchLiquidityStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchLiquidityStatus = async () => {
    try {
      const response = await backend.exchange.getLiquidityStatus();
      setPools(response.pools);
    } catch (error) {
      console.error('Failed to fetch liquidity status:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatAmount = (amount: number, currency: string) => {
    if (currency === 'ZMW') {
      return new Intl.NumberFormat('en-ZM', {
        style: 'currency',
        currency: 'ZMW',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(amount);
    } else {
      return `${amount.toFixed(8)} BTC`;
    }
  };

  const getUtilizationPercentage = (reserved: number, balance: number) => {
    if (balance === 0) return 0;
    return (reserved / balance) * 100;
  };

  const getUtilizationColor = (percentage: number) => {
    if (percentage < 50) return 'bg-green-500';
    if (percentage < 80) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-gray-900">Liquidity Status</h1>
        <div className="animate-pulse space-y-4">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-48 bg-gray-200 rounded-lg"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900">Liquidity Status</h1>
        <div className="flex items-center space-x-2 text-sm text-gray-500">
          <Droplets className="h-4 w-4" />
          <span>Last updated: {new Date().toLocaleTimeString()}</span>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {pools.map((pool) => {
          const utilizationPercentage = getUtilizationPercentage(pool.reserved, pool.balance);
          
          return (
            <Card key={pool.currency}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Droplets className="h-5 w-5 text-blue-500" />
                    <span>{pool.currency} Pool</span>
                  </div>
                  <div className={`px-2 py-1 rounded text-xs font-medium ${
                    pool.available > pool.balance * 0.2 
                      ? 'bg-green-100 text-green-800' 
                      : 'bg-red-100 text-red-800'
                  }`}>
                    {pool.available > pool.balance * 0.2 ? 'Healthy' : 'Low'}
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Balance Overview */}
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <div className="text-2xl font-bold text-gray-900">
                      {formatAmount(pool.balance, pool.currency)}
                    </div>
                    <div className="text-sm text-gray-500">Total Balance</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-yellow-600">
                      {formatAmount(pool.reserved, pool.currency)}
                    </div>
                    <div className="text-sm text-gray-500">Reserved</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-green-600">
                      {formatAmount(pool.available, pool.currency)}
                    </div>
                    <div className="text-sm text-gray-500">Available</div>
                  </div>
                </div>

                {/* Utilization Bar */}
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Utilization</span>
                    <span>{utilizationPercentage.toFixed(1)}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all duration-300 ${getUtilizationColor(utilizationPercentage)}`}
                      style={{ width: `${Math.min(utilizationPercentage, 100)}%` }}
                    ></div>
                  </div>
                </div>

                {/* Status Indicators */}
                <div className="flex justify-between text-sm">
                  <div className="flex items-center space-x-1">
                    {pool.available > pool.balance * 0.5 ? (
                      <TrendingUp className="h-4 w-4 text-green-500" />
                    ) : (
                      <TrendingDown className="h-4 w-4 text-red-500" />
                    )}
                    <span className={pool.available > pool.balance * 0.5 ? 'text-green-600' : 'text-red-600'}>
                      {pool.available > pool.balance * 0.5 ? 'Good liquidity' : 'Low liquidity'}
                    </span>
                  </div>
                  <span className="text-gray-500">
                    {((pool.available / pool.balance) * 100).toFixed(1)}% available
                  </span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Rebalancing Recommendations */}
      <Card>
        <CardHeader>
          <CardTitle>Rebalancing Recommendations</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {pools.map((pool) => {
              const availablePercentage = (pool.available / pool.balance) * 100;
              
              if (availablePercentage < 20) {
                return (
                  <div key={pool.currency} className="flex items-center space-x-3 p-3 bg-red-50 rounded-lg">
                    <TrendingDown className="h-5 w-5 text-red-500" />
                    <div>
                      <div className="font-medium text-red-900">
                        {pool.currency} pool needs rebalancing
                      </div>
                      <div className="text-sm text-red-700">
                        Only {availablePercentage.toFixed(1)}% liquidity available. 
                        Consider {pool.currency === 'BTC' ? 'buying more BTC' : 'adding more ZMW'}.
                      </div>
                    </div>
                  </div>
                );
              }
              
              return null;
            }).filter(Boolean)}
            
            {pools.every(pool => (pool.available / pool.balance) * 100 >= 20) && (
              <div className="flex items-center space-x-3 p-3 bg-green-50 rounded-lg">
                <TrendingUp className="h-5 w-5 text-green-500" />
                <div>
                  <div className="font-medium text-green-900">All pools healthy</div>
                  <div className="text-sm text-green-700">
                    Liquidity levels are sufficient for normal operations.
                  </div>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
