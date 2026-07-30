import type {
  CreatePaymentIntentRequest,
  CreatePublicRequestPaymentIntent,
  CreatePublicRequestQuote,
  CreatePublicRequestRequest,
  CreateQuoteRequest,
  CreateQuoteResponse,
  PaymentIntentResponse,
  PaymentIntentStatusResponse,
  PublicPaymentRequest,
} from "@ntumba/contracts";

interface ApiErrorBody {
  error?: {
    message?: string;
  };
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(body.error?.message ?? "The request could not be completed.");
  }
  return response.json() as Promise<T>;
}

export function createQuote(input: CreateQuoteRequest): Promise<CreateQuoteResponse> {
  return requestJson("/api/v1/quotes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function createPaymentIntent(
  input: CreatePaymentIntentRequest,
): Promise<PaymentIntentResponse> {
  return requestJson("/api/v1/payment-intents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function getPaymentIntent(id: string): Promise<PaymentIntentStatusResponse> {
  return requestJson(`/api/v1/payment-intents/${encodeURIComponent(id)}`);
}

export function createPublicRequest(
  input: CreatePublicRequestRequest,
): Promise<PublicPaymentRequest> {
  return requestJson("/api/v1/public-requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function getPublicRequest(publicId: string): Promise<PublicPaymentRequest> {
  return requestJson(`/api/v1/public-requests/${encodeURIComponent(publicId)}`);
}

export function createPublicRequestQuote(
  publicId: string,
  input: CreatePublicRequestQuote,
): Promise<CreateQuoteResponse> {
  return requestJson(`/api/v1/public-requests/${encodeURIComponent(publicId)}/quotes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function createPublicRequestPaymentIntent(
  publicId: string,
  input: CreatePublicRequestPaymentIntent,
): Promise<PaymentIntentResponse> {
  return requestJson(`/api/v1/public-requests/${encodeURIComponent(publicId)}/payment-intents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}
