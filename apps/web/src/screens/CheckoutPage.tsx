import type { PayerMethod, PaymentIntentResponse, PublicRequestOption } from "@ntumba/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useState } from "react";
import { createPublicRequestPaymentIntent, getPaymentIntent, getPublicRequest } from "../api.js";
import { Countdown, GuestShell, Icon, InlineStatus } from "../components.js";
import { isExpired, plainStatus } from "../payment-ui.js";

export function CheckoutPage() {
  const { publicId } = useParams({ from: "/pay/$publicId" });
  const [selectedMethod, setSelectedMethod] = useState<PayerMethod>();
  const [selectedOption, setSelectedOption] = useState<PublicRequestOption>();
  const [intent, setIntent] = useState<PaymentIntentResponse>();
  const [intentIdempotencyKey, setIntentIdempotencyKey] = useState(() => crypto.randomUUID());
  const [started, setStarted] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectionError, setSelectionError] = useState("");
  const [expired, setExpired] = useState(false);

  const paymentRequest = useQuery({
    queryKey: ["public-request", publicId],
    queryFn: () => getPublicRequest(publicId),
    retry: false,
  });
  const paymentStatus = useQuery({
    enabled: started && Boolean(intent),
    queryKey: ["payment-intent", intent?.paymentIntentId],
    queryFn: () => getPaymentIntent(intent?.paymentIntentId ?? ""),
    refetchInterval: 5_000,
    retry: false,
  });
  const startPayment = useMutation({
    mutationFn: (option: PublicRequestOption) =>
      createPublicRequestPaymentIntent(publicId, {
        idempotencyKey: intentIdempotencyKey,
        payerMethod: option.payerMethod,
      }),
    onError: (error) => {
      setSelectionError(
        error instanceof Error ? error.message : "This payment request is unavailable.",
      );
    },
    onSuccess: (created) => {
      setIntent(created);
      setStarted(true);
    },
  });

  async function selectMethod(method: PayerMethod) {
    setSelectionError("");
    setStarted(false);
    setIntent(undefined);
    setIntentIdempotencyKey(crypto.randomUUID());
    setSelectedMethod(method);
    const refreshed = await paymentRequest.refetch();
    const option = refreshed.data?.options.find((item) => item.payerMethod === method);
    if (!option) {
      setSelectionError("This payment method is not available right now.");
      setSelectedOption(undefined);
      return;
    }
    if (isExpired(option.quote.expiresAt)) {
      setExpired(true);
    }
    setSelectedOption(option);
  }

  async function copyInvoice() {
    if (intent?.checkout.type !== "direct_lightning") return;
    try {
      await navigator.clipboard.writeText(intent.checkout.paymentRequest);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const status = paymentStatus.data?.status ?? intent?.status;
  const statusPresentation = status ? plainStatus[status] : undefined;
  const checkout = intent?.checkout;

  return (
    <GuestShell>
      {paymentRequest.isPending ? (
        <section aria-label="Loading payment request" className="surface-card form-stack">
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton" />
        </section>
      ) : paymentRequest.isError || !paymentRequest.data ? (
        <section className="surface-card empty-state">
          <span className="empty-icon">
            <Icon name="info" />
          </span>
          <h1 className="section-heading">Payment request unavailable</h1>
          <p>
            It may have expired, or your connection may be offline. Ask the merchant for a new
            request.
          </p>
        </section>
      ) : (
        <section>
          <p className="eyebrow">Payment request</p>
          <h1 className="page-title">Payment request</h1>

          <div className="surface-card summary-card">
            <span className="field-help">Amount</span>
            <div className="amount-display">K{paymentRequest.data.amountZmw}</div>
            <p className="page-subtitle">
              Merchant receives{" "}
              {paymentRequest.data.receiveAsset === "ZMW" ? "Mobile Money" : "Bitcoin"}
            </p>
            <Countdown
              expiresAt={paymentRequest.data.expiresAt}
              onExpire={() => setExpired(true)}
            />
          </div>

          <div className="surface-card form-card">
            <h2 className="section-heading">Choose how to pay</h2>
            <div className="method-grid">
              {paymentRequest.data.options.map((option) => {
                const selected = selectedMethod === option.payerMethod;
                return (
                  <button
                    aria-pressed={selected}
                    className={`method-card${selected ? " is-selected" : ""}`}
                    key={option.payerMethod}
                    onClick={() => selectMethod(option.payerMethod)}
                    type="button"
                  >
                    <span
                      className={`method-icon${
                        option.payerMethod === "BTC" ? " bitcoin-accent" : ""
                      }`}
                    >
                      <Icon name={option.payerMethod === "BTC" ? "bitcoin" : "mobile"} />
                    </span>
                    <span className="method-copy">
                      <strong>{option.payerMethod === "BTC" ? "Bitcoin" : "Mobile Money"}</strong>
                      <small>
                        {option.payerMethod === "BTC"
                          ? "Pay from a Lightning wallet"
                          : "Pay in Kwacha"}
                      </small>
                    </span>
                    {selected ? (
                      <span className="selection-check">
                        <Icon name="check" size={15} />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            {paymentRequest.isFetching && selectedMethod ? (
              <InlineStatus>
                <Icon name="clock" />
                Getting your quote…
              </InlineStatus>
            ) : null}
            {selectionError ? <InlineStatus tone="danger">{selectionError}</InlineStatus> : null}
          </div>

          {selectedOption ? (
            <div className="surface-card quote-card">
              <h2 className="section-heading">Your quote</h2>
              <div className="quote-amounts">
                <div className="quote-amount">
                  <span>You pay</span>
                  <strong>{selectedOption.quote.payerSends.display}</strong>
                </div>
                <div className="quote-amount">
                  <span>Merchant receives</span>
                  <strong>{selectedOption.quote.merchantReceives.display}</strong>
                </div>
              </div>
              <div className="quote-details">
                <span>Rate: {selectedOption.quote.exchangeRate}</span>
                <span>Fee: K{selectedOption.quote.feeZmw}</span>
                <Countdown
                  expiresAt={selectedOption.quote.expiresAt}
                  onExpire={() => setExpired(true)}
                />
              </div>
              <InlineStatus>
                <Icon name="shield" />
                {checkout?.type === "direct_lightning"
                  ? "Bitcoin goes directly to the merchant’s external wallet."
                  : "This simulated conversion uses Ntumba-operated source and payout liquidity."}
              </InlineStatus>

              {!started ? (
                <button
                  className="primary-button full-width"
                  disabled={expired || startPayment.isPending}
                  onClick={() => startPayment.mutate(selectedOption)}
                  type="button"
                >
                  {startPayment.isPending
                    ? "Preparing payment…"
                    : expired
                      ? "Quote expired"
                      : selectedOption.payerMethod === "BTC"
                        ? checkout?.type === "direct_lightning"
                          ? "Show Bitcoin invoice"
                          : "Continue with Bitcoin"
                        : "Continue with Mobile Money"}
                </button>
              ) : (
                <div className="form-stack">
                  {statusPresentation ? (
                    <InlineStatus tone={statusPresentation.tone}>
                      <Icon name={statusPresentation.tone === "success" ? "check" : "clock"} />
                      <span>
                        <strong>{statusPresentation.label}</strong>
                        <br />
                        {statusPresentation.detail}
                      </span>
                    </InlineStatus>
                  ) : null}

                  {checkout?.type === "direct_lightning" ? (
                    <>
                      <p className="field-help">
                        This merchant-owned invoice has not been confirmed as paid.
                      </p>
                      <div className="invoice-box">{checkout.paymentRequest}</div>
                      <button className="secondary-button" onClick={copyInvoice} type="button">
                        <Icon name="copy" />
                        {copied ? "Invoice copied" : "Copy Bitcoin invoice"}
                      </button>
                    </>
                  ) : (
                    <>
                      <p>{checkout?.instructions}</p>
                      <InlineStatus tone="warning">
                        Development-only fake payment. No real funds will move.
                      </InlineStatus>
                    </>
                  )}
                </div>
              )}

              {expired ? (
                <InlineStatus tone="warning">
                  <Icon name="clock" />
                  This quote has expired. Ask the merchant for a new payment request.
                </InlineStatus>
              ) : null}
            </div>
          ) : null}

          <p className="privacy-note">
            <Icon name="shield" size={18} />
            No customer account · Ntumba never holds the payment
          </p>
        </section>
      )}
    </GuestShell>
  );
}
