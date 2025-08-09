import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Toaster } from '@/components/ui/toaster';
import { Header } from './components/Header';
import { HomePage } from './pages/HomePage';
import { BtcToZmwPage } from './pages/BtcToZmwPage';
import { ZmwToBtcPage } from './pages/ZmwToBtcPage';
import { TransactionsPage } from './pages/TransactionsPage';
import { LiquidityPage } from './pages/LiquidityPage';

export default function App() {
  return (
    <Router>
      <div className="min-h-screen bg-gray-50">
        <Header />
        <main className="container mx-auto px-4 py-8">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/btc-to-zmw" element={<BtcToZmwPage />} />
            <Route path="/zmw-to-btc" element={<ZmwToBtcPage />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/liquidity" element={<LiquidityPage />} />
          </Routes>
        </main>
        <Toaster />
      </div>
    </Router>
  );
}
