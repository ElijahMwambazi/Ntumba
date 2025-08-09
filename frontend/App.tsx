import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from '@/components/ui/toaster';
import { Header } from './components/Header';
import { BtcToZmwPage } from './pages/BtcToZmwPage';
import { ZmwToBtcPage } from './pages/ZmwToBtcPage';

export default function App() {
  return (
    <Router>
      <div className="min-h-screen bg-gray-50">
        <Header />
        <main className="container mx-auto px-4 py-8">
          <Routes>
            <Route path="/" element={<Navigate to="/btc-to-zmw" replace />} />
            <Route path="/btc-to-zmw" element={<BtcToZmwPage />} />
            <Route path="/zmw-to-btc" element={<ZmwToBtcPage />} />
          </Routes>
        </main>
        <Toaster />
      </div>
    </Router>
  );
}
