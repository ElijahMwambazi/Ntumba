import { Link } from 'react-router-dom';
import { ArrowRight, Bitcoin, Smartphone, TrendingUp, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ExchangeRateCard } from '../components/ExchangeRateCard';

export function HomePage() {
  return (
    <div className="space-y-12">
      {/* Hero Section */}
      <div className="text-center space-y-6">
        <h1 className="text-4xl md:text-6xl font-bold text-gray-900">
          Bitcoin to Kwacha
          <span className="block text-orange-500">Exchange</span>
        </h1>
        <p className="text-xl text-gray-600 max-w-2xl mx-auto">
          Instantly convert between Bitcoin and Zambian Kwacha using Lightning Network 
          and mobile money integration.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Button size="lg" asChild>
            <Link to="/btc-to-zmw" className="flex items-center space-x-2">
              <span>Send Bitcoin → Get Kwacha</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link to="/zmw-to-btc" className="flex items-center space-x-2">
              <span>Send Kwacha → Get Bitcoin</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>

      {/* Exchange Rate */}
      <div className="flex justify-center">
        <ExchangeRateCard />
      </div>

      {/* Features */}
      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader>
            <Bitcoin className="h-8 w-8 text-orange-500 mb-2" />
            <CardTitle>Lightning Fast</CardTitle>
            <CardDescription>
              Powered by Lightning Network for instant Bitcoin transactions
            </CardDescription>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <Smartphone className="h-8 w-8 text-blue-500 mb-2" />
            <CardTitle>Mobile Money</CardTitle>
            <CardDescription>
              Direct integration with Zambian mobile money providers
            </CardDescription>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <TrendingUp className="h-8 w-8 text-green-500 mb-2" />
            <CardTitle>Real-time Rates</CardTitle>
            <CardDescription>
              Live exchange rates updated every few minutes
            </CardDescription>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <Shield className="h-8 w-8 text-purple-500 mb-2" />
            <CardTitle>Secure</CardTitle>
            <CardDescription>
              Enterprise-grade security for all transactions
            </CardDescription>
          </CardHeader>
        </Card>
      </div>

      {/* How it Works */}
      <div className="space-y-8">
        <h2 className="text-3xl font-bold text-center text-gray-900">How It Works</h2>
        
        <div className="grid md:grid-cols-2 gap-8">
          {/* BTC to ZMW */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Bitcoin className="h-5 w-5 text-orange-500" />
                <span>Bitcoin → Kwacha</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-start space-x-3">
                  <div className="w-6 h-6 bg-orange-500 text-white rounded-full flex items-center justify-center text-sm font-bold">1</div>
                  <p className="text-sm">Enter recipient's phone number and ZMW amount</p>
                </div>
                <div className="flex items-start space-x-3">
                  <div className="w-6 h-6 bg-orange-500 text-white rounded-full flex items-center justify-center text-sm font-bold">2</div>
                  <p className="text-sm">Pay the Lightning invoice with your Bitcoin wallet</p>
                </div>
                <div className="flex items-start space-x-3">
                  <div className="w-6 h-6 bg-orange-500 text-white rounded-full flex items-center justify-center text-sm font-bold">3</div>
                  <p className="text-sm">Recipient receives Kwacha instantly via mobile money</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ZMW to BTC */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Smartphone className="h-5 w-5 text-blue-500" />
                <span>Kwacha → Bitcoin</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-start space-x-3">
                  <div className="w-6 h-6 bg-blue-500 text-white rounded-full flex items-center justify-center text-sm font-bold">1</div>
                  <p className="text-sm">Enter Lightning address and ZMW amount to send</p>
                </div>
                <div className="flex items-start space-x-3">
                  <div className="w-6 h-6 bg-blue-500 text-white rounded-full flex items-center justify-center text-sm font-bold">2</div>
                  <p className="text-sm">Send Kwacha from your mobile money account</p>
                </div>
                <div className="flex items-start space-x-3">
                  <div className="w-6 h-6 bg-blue-500 text-white rounded-full flex items-center justify-center text-sm font-bold">3</div>
                  <p className="text-sm">Recipient receives Bitcoin via Lightning Network</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
