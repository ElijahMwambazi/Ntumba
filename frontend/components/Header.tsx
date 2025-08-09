import { Link, useLocation } from 'react-router-dom';
import { Bitcoin, ArrowLeftRight, History, Droplets } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function Header() {
  const location = useLocation();

  const isActive = (path: string) => location.pathname === path;

  return (
    <header className="bg-white shadow-sm border-b">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <Link to="/" className="flex items-center space-x-2">
            <Bitcoin className="h-8 w-8 text-orange-500" />
            <span className="text-xl font-bold text-gray-900">BTC ⇄ ZMW</span>
          </Link>

          <nav className="flex items-center space-x-4">
            <Button
              variant={isActive('/') ? 'default' : 'ghost'}
              asChild
            >
              <Link to="/">Home</Link>
            </Button>
            
            <Button
              variant={isActive('/btc-to-zmw') ? 'default' : 'ghost'}
              asChild
            >
              <Link to="/btc-to-zmw" className="flex items-center space-x-2">
                <ArrowLeftRight className="h-4 w-4" />
                <span>BTC → ZMW</span>
              </Link>
            </Button>

            <Button
              variant={isActive('/zmw-to-btc') ? 'default' : 'ghost'}
              asChild
            >
              <Link to="/zmw-to-btc" className="flex items-center space-x-2">
                <ArrowLeftRight className="h-4 w-4 rotate-180" />
                <span>ZMW → BTC</span>
              </Link>
            </Button>

            <Button
              variant={isActive('/transactions') ? 'default' : 'ghost'}
              asChild
            >
              <Link to="/transactions" className="flex items-center space-x-2">
                <History className="h-4 w-4" />
                <span>Transactions</span>
              </Link>
            </Button>

            <Button
              variant={isActive('/liquidity') ? 'default' : 'ghost'}
              asChild
            >
              <Link to="/liquidity" className="flex items-center space-x-2">
                <Droplets className="h-4 w-4" />
                <span>Liquidity</span>
              </Link>
            </Button>
          </nav>
        </div>
      </div>
    </header>
  );
}
