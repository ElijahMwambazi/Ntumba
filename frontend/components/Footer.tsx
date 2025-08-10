import { Zap, Shield } from 'lucide-react';

export function Footer() {
  return (
    <footer className="bg-white border-t mt-16">
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col items-center space-y-4">
          <div className="flex items-center space-x-6 text-sm text-gray-600">
            <div className="flex items-center space-x-2">
              <Zap className="h-4 w-4 text-orange-500" />
              <span>Powered by Lightning Network</span>
            </div>
            <div className="flex items-center space-x-2">
              <Shield className="h-4 w-4 text-blue-500" />
              <span>Secured by Lipila</span>
            </div>
          </div>
          <div className="text-xs text-gray-500 text-center">
            <p>Fast, secure, and reliable Bitcoin-Kwacha exchange</p>
            <p className="mt-1">© 2024 Ntumba. All rights reserved.</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
