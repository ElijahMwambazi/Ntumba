import type {
  CreateQuoteResponse,
  PayerMethod,
  PaymentIntentResponse,
  PublicRequestOption,
} from "@ntumba/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useState } from "react";
import {
  createPublicRequestPaymentIntent,
  createPublicRequestQuote,
  getPaymentIntent,
  getPublicRequest,
} from "../api.js";
import { Countdown, GuestShell, Icon, InlineStatus } from "../components.js";
import { plainStatus } from "../payment-ui.js";

export function CheckoutPage() {
  const { publicId } = useParams({ from: "/pay/$publicId" });
  const [selectedMethod, setSelectedMethod] = useState<PayerMethod>();
  const [selectedOption, setSelectedOption] = useState<PublicRequestOption>();
  const [quote, setQuote] = useState<CreateQuoteResponse>();
  const [intent, setIntent] = useState<PaymentIntentResponse>();
  const [intentIdempotencyKey, setIntentIdempotencyKey] = useState(() => crypto.randomUUID());
  const [started, setStarted] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectionError, setSelectionError] = useState("");
  const [quoteExpired, setQuoteExpired] = useState(false);
  const [requestExpired, setRequestExpired] = useState(false);

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
    mutationFn: (selection: { option: PublicRequestOption; quoteId: string }) =>
      createPublicRequestPaymentIntent(publicId, {
        idempotencyKey: intentIdempotencyKey,
        payerMethod: selection.option.payerMethod,
        quoteId: selection.quoteId,
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
  const requestQuote = useMutation({
    mutationFn: (selection: { idempotencyKey: string; payerMethod: PayerMethod }) =>
      createPublicRequestQuote(publicId, selection),
    onError: (error) => {
      setSelectionError(
        error instanceof Error ? error.message : "A fresh quote is unavailable right now.",
      );
    },
    onSuccess: (created) => {
      setQuote(created);
      setQuoteExpired(false);
    },
  });

  function selectMethod(method: PayerMethod) {
    setSelectionError("");
    setStarted(false);
    setIntent(undefined);
    setIntentIdempotencyKey(crypto.randomUUID());
    setQuote(undefined);
    setQuoteExpired(false);
    setSelectedMethod(method);
    const option = paymentRequest.data?.options.find((item) => item.payerMethod === method);
    if (!option) {
      setSelectionError("This payment method is not available right now.");
      setSelectedOption(undefined);
      return;
    }
    setSelectedOption(option);
    const idempotencyKey = crypto.randomUUID();
    requestQuote.mutate({ idempotencyKey, payerMethod: method });
  }

  function refreshQuote() {
    if (!selectedMethod) return;
    setSelectionError("");
    setQuote(undefined);
    setQuoteExpired(false);
    setIntentIdempotencyKey(crypto.randomUUID());
    const idempotencyKey = crypto.randomUUID();
    requestQuote.mutate({ idempotencyKey, payerMethod: selectedMethod });
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
              onExpire={() => setRequestExpired(true)}
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
            {requestQuote.isPending && selectedMethod ? (
              <InlineStatus>
                <Icon name="clock" />
                Getting your quote…
              </InlineStatus>
            ) : null}
            {selectionError ? <InlineStatus tone="danger">{selectionError}</InlineStatus> : null}
          </div>

          {selectedOption && quote ? (
            <div className="surface-card quote-card">
              <h2 className="section-heading">Your quote</h2>
              <div className="quote-amounts">
                <div className="quote-amount">
                  <span>You pay</span>
                  <strong>{quote.payerSends.display}</strong>
                </div>
                <div className="quote-amount">
                  <span>Merchant receives</span>
                  <strong>{quote.merchantReceives.display}</strong>
                </div>
              </div>
              <div className="quote-details">
                <span>Rate: {quote.exchangeRate}</span>
                <span>Fee: K{quote.feeZmw}</span>
                <Countdown expiresAt={quote.expiresAt} onExpire={() => setQuoteExpired(true)} />
              </div>
              <InlineStatus>
                <Icon name="shield" />
                {selectedOption.direction === "btc_to_btc"
                  ? "Bitcoin goes directly to the merchant’s external wallet."
                  : "This simulated conversion uses Ntumba-operated source and payout liquidity."}
              </InlineStatus>

              {!started ? (
                <button
                  className="primary-button full-width"
                  disabled={quoteExpired || requestExpired || startPayment.isPending}
                  onClick={() =>
                    startPayment.mutate({ option: selectedOption, quoteId: quote.quoteId })
                  }
                  type="button"
                >
                  {startPayment.isPending
                    ? "Preparing payment…"
                    : quoteExpired
                      ? "Quote expired"
                      : selectedOption.payerMethod === "BTC"
                        ? selectedOption.direction === "btc_to_btc"
                          ? "Confirm and show Bitcoin invoice"
                          : "Confirm and continue with Bitcoin"
                        : "Confirm and continue with Mobile Money"}
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

              {quoteExpired ? (
                <InlineStatus tone="warning">
                  <Icon name="clock" />
                  <span>This quote has expired. Refresh it while the request remains open.</span>
                  <button
                    className="text-button"
                    disabled={requestQuote.isPending || requestExpired}
                    onClick={refreshQuote}
                    type="button"
                  >
                    Refresh quote
                  </button>
                </InlineStatus>
              ) : null}
            </div>
          ) : null}

          <p className="privacy-note">
            <Icon name="shield" size={18} />
            No customer account · Destination details are not shown
          </p>
        </section>
      )}
    </GuestShell>
  );
}
