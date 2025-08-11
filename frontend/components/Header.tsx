import { Link, useLocation } from 'react-router-dom';
import { Bitcoin, ArrowLeftRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function Header() {
  const location = useLocation();

  const isActive = (path: string) => location.pathname === path;

  return (
    <header className="bg-white shadow-sm border-b fixed top-0 left-0 right-0 z-50">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <Link to="/btc-to-zmw" className="flex items-center space-x-2">
            <Bitcoin className="h-8 w-8 text-orange-500" />
            <span className="text-xl font-bold text-gray-900">Ntumba</span>
          </Link>

          <nav className="flex items-center space-x-2">
            <Button
              variant={isActive('/btc-to-zmw') ? 'default' : 'ghost'}
              asChild
              className={isActive('/btc-to-zmw') ? 'bg-orange-500 hover:bg-orange-600' : ''}
            >
              <Link to="/btc-to-zmw" className="flex items-center space-x-2">
                <ArrowLeftRight className="h-4 w-4" />
                <span>BTC → ZMW</span>
              </Link>
            </Button>

            <Button
              variant={isActive('/zmw-to-btc') ? 'default' : 'ghost'}
              asChild
              className={isActive('/zmw-to-btc') ? 'bg-orange-500 hover:bg-orange-600' : ''}
            >
              <Link to="/zmw-to-btc" className="flex items-center space-x-2">
                <ArrowLeftRight className="h-4 w-4 rotate-180" />
                <span>ZMW → BTC</span>
              </Link>
            </Button>
          </nav>
        </div>
      </div>
    </header>
  );
}
