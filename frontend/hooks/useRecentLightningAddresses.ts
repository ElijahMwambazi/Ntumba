import { useState, useEffect } from 'react';

interface RecentLightningAddress {
  address: string;
  lastUsed: Date;
}

const STORAGE_KEY = 'ntumba_recent_lightning_addresses';
const MAX_ADDRESSES = 3;

export function useRecentLightningAddresses() {
  const [recentAddresses, setRecentAddresses] = useState<RecentLightningAddress[]>([]);

  useEffect(() => {
    loadRecentAddresses();
  }, []);

  const loadRecentAddresses = () => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const addresses = JSON.parse(stored).map((a: any) => ({
          ...a,
          lastUsed: new Date(a.lastUsed)
        }));
        setRecentAddresses(addresses);
      }
    } catch (error) {
      console.error('Failed to load recent Lightning addresses:', error);
    }
  };

  const addRecentAddress = (address: string) => {
    try {
      const existingIndex = recentAddresses.findIndex(a => a.address === address);
      let updatedAddresses: RecentLightningAddress[];

      if (existingIndex >= 0) {
        // Update existing address's last used date
        updatedAddresses = [...recentAddresses];
        updatedAddresses[existingIndex].lastUsed = new Date();
      } else {
        // Add new address
        const newAddress: RecentLightningAddress = {
          address,
          lastUsed: new Date()
        };
        updatedAddresses = [newAddress, ...recentAddresses];
      }

      // Sort by last used date (most recent first) and limit to MAX_ADDRESSES
      updatedAddresses = updatedAddresses
        .sort((a, b) => b.lastUsed.getTime() - a.lastUsed.getTime())
        .slice(0, MAX_ADDRESSES);

      setRecentAddresses(updatedAddresses);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedAddresses));
    } catch (error) {
      console.error('Failed to save recent Lightning address:', error);
    }
  };

  const clearRecentAddresses = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      setRecentAddresses([]);
    } catch (error) {
      console.error('Failed to clear recent Lightning addresses:', error);
    }
  };

  return {
    recentAddresses,
    addRecentAddress,
    clearRecentAddresses
  };
}
