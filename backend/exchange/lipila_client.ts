import { secret } from "encore.dev/config";

const lilipaApiKey = secret("LilipaApiKey");
const lilipaBaseUrl = secret("LilipaBaseUrl");

export class LilipaClient {
  private async makeRequest(endpoint: string, options: RequestInit = {}) {
    const response = await fetch(`${lilipaBaseUrl()}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${lilipaApiKey()}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`Lilipa API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async sendPayout(amount: number, recipient: string, reference: string) {
    return this.makeRequest('/transactions/payout', {
      method: 'POST',
      body: JSON.stringify({
        amount,
        recipient,
        reference,
        currency: 'ZMW',
      }),
    });
  }

  async collectDeposit(amount: number, sender: string, reference: string) {
    return this.makeRequest('/transactions/deposit', {
      method: 'POST',
      body: JSON.stringify({
        amount,
        sender,
        reference,
        currency: 'ZMW',
      }),
    });
  }

  async getTransaction(transactionId: string) {
    return this.makeRequest(`/transactions/${transactionId}`);
  }
}

export const lilipaClient = new LilipaClient();
