import { secret } from "encore.dev/config";

const voltageApiKey = secret("VoltageApiKey");
const voltageBaseUrl = secret("VoltageBaseUrl");

export class VoltageClient {
  private async makeRequest(endpoint: string, options: RequestInit = {}) {
    const response = await fetch(`${voltageBaseUrl()}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${voltageApiKey()}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`Voltage API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async createInvoice(amountSats: number, description: string) {
    return this.makeRequest('/invoices', {
      method: 'POST',
      body: JSON.stringify({
        amount: amountSats,
        description,
        expiry: 3600, // 1 hour
      }),
    });
  }

  async getInvoice(invoiceId: string) {
    return this.makeRequest(`/invoices/${invoiceId}`);
  }

  async payInvoice(paymentRequest: string) {
    return this.makeRequest('/payments', {
      method: 'POST',
      body: JSON.stringify({
        payment_request: paymentRequest,
      }),
    });
  }

  async getPayment(paymentHash: string) {
    return this.makeRequest(`/payments/${paymentHash}`);
  }
}

export const voltageClient = new VoltageClient();
