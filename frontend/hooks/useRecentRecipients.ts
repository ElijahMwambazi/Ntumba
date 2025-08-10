import { useState, useEffect } from 'react';

interface RecentRecipient {
  phone: string;
  lastUsed: Date;
}

const STORAGE_KEY = 'ntumba_recent_recipients';
const MAX_RECIPIENTS = 3;

export function useRecentRecipients() {
  const [recentRecipients, setRecentRecipients] = useState<RecentRecipient[]>([]);

  useEffect(() => {
    loadRecentRecipients();
  }, []);

  const loadRecentRecipients = () => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const recipients = JSON.parse(stored).map((r: any) => ({
          ...r,
          lastUsed: new Date(r.lastUsed)
        }));
        setRecentRecipients(recipients);
      }
    } catch (error) {
      console.error('Failed to load recent recipients:', error);
    }
  };

  const addRecentRecipient = (phone: string) => {
    try {
      const existingIndex = recentRecipients.findIndex(r => r.phone === phone);
      let updatedRecipients: RecentRecipient[];

      if (existingIndex >= 0) {
        // Update existing recipient's last used date
        updatedRecipients = [...recentRecipients];
        updatedRecipients[existingIndex].lastUsed = new Date();
      } else {
        // Add new recipient
        const newRecipient: RecentRecipient = {
          phone,
          lastUsed: new Date()
        };
        updatedRecipients = [newRecipient, ...recentRecipients];
      }

      // Sort by last used date (most recent first) and limit to MAX_RECIPIENTS
      updatedRecipients = updatedRecipients
        .sort((a, b) => b.lastUsed.getTime() - a.lastUsed.getTime())
        .slice(0, MAX_RECIPIENTS);

      setRecentRecipients(updatedRecipients);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedRecipients));
    } catch (error) {
      console.error('Failed to save recent recipient:', error);
    }
  };

  const clearRecentRecipients = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      setRecentRecipients([]);
    } catch (error) {
      console.error('Failed to clear recent recipients:', error);
    }
  };

  return {
    recentRecipients,
    addRecentRecipient,
    clearRecentRecipients
  };
}
