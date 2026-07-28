export const CALLBACK_REASONS = [
  "signature",
  "timestamp",
  "malformed",
  "mismatch",
  "conflict",
] as const;
export type CallbackRejectionReason = (typeof CALLBACK_REASONS)[number];

export const OUTBOX_FAILURE_CATEGORIES = [
  "none",
  "provider_request_failed",
  "provider_timeout",
  "provider_unavailable",
  "other_safe_failure",
] as const;
export type OutboxFailureCategory = (typeof OUTBOX_FAILURE_CATEGORIES)[number];

const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

export function registeredRouteLabel(routeTemplate: string | undefined): string {
  if (
    !routeTemplate ||
    routeTemplate.length > 160 ||
    routeTemplate.includes("?") ||
    routeTemplate.includes("#") ||
    uuidPattern.test(routeTemplate)
  ) {
    return "unmatched";
  }
  return routeTemplate;
}

export function methodLabel(method: string): string {
  const normalized = method.toUpperCase();
  return ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"].includes(normalized)
    ? normalized
    : "OTHER";
}

export function responseClass(statusCode: number): string {
  return statusCode >= 100 && statusCode <= 599 ? `${Math.floor(statusCode / 100)}xx` : "unknown";
}

export function safeOutboxFailureCategory(value: string | null): OutboxFailureCategory {
  if (value === null) {
    return "none";
  }
  if (value === "PROVIDER_REQUEST_FAILED") {
    return "provider_request_failed";
  }
  if (value === "PROVIDER_TIMEOUT") {
    return "provider_timeout";
  }
  if (value === "PROVIDER_UNAVAILABLE") {
    return "provider_unavailable";
  }
  return "other_safe_failure";
}
