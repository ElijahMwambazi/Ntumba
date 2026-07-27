import type {
  Asset,
  CreatePaymentIntentRequest,
  MobileMoneyNetwork,
  PayerMethod,
  PaymentDirection,
  PublicRequestOption,
  SettlementDestination,
} from "@ntumba/contracts";
import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useEffect, useState } from "react";
import { createPaymentIntent, createPublicRequest, createQuote } from "../api.js";
import { Icon, InlineStatus, MerchantShell } from "../components.js";
import { merchantLocalStore } from "../local-storage.js";
import { maskDestination, payerMethodsFor } from "../payment-ui.js";

const networks: { label: string; value: MobileMoneyNetwork }[] = [
  { label: "MTN Money", value: "mtn" },
  { label: "Airtel Money", value: "airtel" },
  { label: "Zamtel Money", value: "zamtel" },
];

export function MerchantPage() {
  const navigate = useNavigate();
  const [amountZmw, setAmountZmw] = useState("");
  const [receiveAsset, setReceiveAsset] = useState<Asset>("ZMW");
  const [network, setNetwork] = useState<MobileMoneyNetwork>("mtn");
  const [phone, setPhone] = useState("");
  const [lightningDestination, setLightningDestination] = useState("");
  const [lightningDestinationType, setLightningDestinationType] = useState<
    "lightning_address" | "lightning_invoice"
  >("lightning_address");
  const [reference, setReference] = useState("");
  const [showReference, setShowReference] = useState(false);
  const [merchantLabel, setMerchantLabel] = useState("");
  const [storageWarning, setStorageWarning] = useState(!merchantLocalStore.available);
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    void merchantLocalStore.load().then(({ preferences }) => {
      setMerchantLabel(preferences.displayName ?? "");
      setReceiveAsset(preferences.preferredSettlementAsset ?? "ZMW");
      setNetwork(preferences.mobileMoneyDestination?.network ?? "mtn");
      setPhone(preferences.mobileMoneyDestination?.phone ?? "");
      setLightningDestination(preferences.lightningDestination ?? "");
      setLightningDestinationType(preferences.lightningDestinationType ?? "lightning_address");
      if (!merchantLocalStore.available) setStorageWarning(true);
    });
  }, []);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const createRequest = useMutation({
    mutationFn: async () => {
      if (!navigator.onLine) {
        throw new Error("You are offline. Reconnect before creating a request.");
      }

      const destination: SettlementDestination =
        receiveAsset === "ZMW"
          ? { network, phone, type: "mobile_money" }
          : lightningDestinationType === "lightning_invoice"
            ? { invoice: lightningDestination, type: "lightning_invoice" }
            : { address: lightningDestination, type: "lightning_address" };

      async function createOption(
        direction: PaymentDirection,
        payerMethod: PayerMethod,
      ): Promise<PublicRequestOption> {
        const quote = await createQuote({ amountZmw, direction });
        const base = {
          idempotencyKey: crypto.randomUUID(),
          quoteId: quote.quoteId,
        };
        let input: CreatePaymentIntentRequest;
        if (direction === "btc_to_zmw" && destination.type === "mobile_money") {
          input = { ...base, destination, direction };
        } else if (direction === "btc_to_btc" && destination.type !== "mobile_money") {
          input = { ...base, destination, direction };
        } else if (direction === "zmw_to_btc" && destination.type !== "mobile_money") {
          input = { ...base, destination, direction };
        } else {
          throw new Error("The destination does not support this payment option.");
        }
        return { intent: await createPaymentIntent(input), payerMethod };
      }

      const options =
        receiveAsset === "ZMW"
          ? [await createOption("btc_to_zmw", "BTC")]
          : await Promise.all([
              createOption("btc_to_btc", "BTC"),
              createOption("zmw_to_btc", "ZMW"),
            ]);
      const publicRequest = await createPublicRequest({
        amountZmw,
        idempotencyKey: crypto.randomUUID(),
        ...(merchantLabel ? { merchantLabel } : {}),
        options,
        receiveAsset,
        ...(reference.trim() ? { reference: reference.trim() } : {}),
      });
      return { destination, publicRequest };
    },
    onSuccess: async ({ destination, publicRequest }) => {
      const localId = crypto.randomUUID();
      const shareUrl = `${window.location.origin}/pay/${publicRequest.publicId}`;
      await merchantLocalStore.update((current) => ({
        ...current,
        requests: [
          {
            amountZmw: publicRequest.amountZmw,
            createdAt: publicRequest.createdAt,
            expiresAt: publicRequest.expiresAt,
            localId,
            maskedDestination: maskDestination(destination),
            payerMethods: payerMethodsFor(publicRequest.receiveAsset),
            publicId: publicRequest.publicId,
            receiveAsset: publicRequest.receiveAsset,
            ...(publicRequest.reference ? { reference: publicRequest.reference } : {}),
            shareUrl,
            status: "created" as const,
          },
          ...current.requests,
        ].slice(0, 100),
      }));
      if (!merchantLocalStore.available) setStorageWarning(true);
      await navigate({ to: "/requests/$localId", params: { localId } });
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    createRequest.mutate();
  }

  const receivesBitcoin = receiveAsset === "BTC";
  const destinationReady = receivesBitcoin ? lightningDestination.trim() : phone.trim();
  const canSubmit = Boolean(amountZmw && destinationReady && online && !createRequest.isPending);

  return (
    <MerchantShell
      active="get-paid"
      headerAction={
        <Link className="header-link" to="/activity">
          Activity
        </Link>
      }
    >
      <div className="task-layout">
        <section>
          <p className="eyebrow">Private on this device</p>
          <h1 className="page-title">Get paid</h1>
          <p className="page-subtitle">
            Choose what you want to receive. Your customer chooses how to pay.
          </p>

          {!online ? (
            <div className="form-card">
              <InlineStatus tone="warning">
                <Icon name="info" />
                You are offline. Your saved details remain available, but requests need a
                connection.
              </InlineStatus>
            </div>
          ) : null}
          {storageWarning ? (
            <div className="form-card">
              <InlineStatus tone="warning">
                <Icon name="shield" />
                Device storage is unavailable. New details will last only for this session.
              </InlineStatus>
            </div>
          ) : null}

          <form className="surface-card form-card form-stack" onSubmit={submit}>
            <div className="field-group">
              <label className="field-label" htmlFor="amount">
                Amount
              </label>
              <div className="amount-control">
                <span aria-hidden="true" className="amount-prefix">
                  K
                </span>
                <input
                  autoComplete="off"
                  className="amount-input"
                  id="amount"
                  inputMode="decimal"
                  onChange={(event) => setAmountZmw(event.target.value)}
                  placeholder="0.00"
                  required
                  value={amountZmw}
                />
              </div>
            </div>

            <fieldset className="field-group">
              <legend className="field-legend">Receive in</legend>
              <div className="segmented">
                <button
                  aria-pressed={receiveAsset === "ZMW"}
                  className={`segment-card${receiveAsset === "ZMW" ? " is-selected" : ""}`}
                  onClick={() => setReceiveAsset("ZMW")}
                  type="button"
                >
                  <span className="segment-icon">
                    <Icon name="mobile" />
                  </span>
                  <span className="segment-copy">
                    <strong>Mobile Money</strong>
                    <small>ZMW</small>
                  </span>
                  {receiveAsset === "ZMW" ? (
                    <span className="selection-check">
                      <Icon name="check" size={15} />
                    </span>
                  ) : null}
                </button>
                <button
                  aria-pressed={receiveAsset === "BTC"}
                  className={`segment-card${receiveAsset === "BTC" ? " is-selected" : ""}`}
                  onClick={() => setReceiveAsset("BTC")}
                  type="button"
                >
                  <span className="segment-icon bitcoin-accent">
                    <Icon name="bitcoin" />
                  </span>
                  <span className="segment-copy">
                    <strong>Bitcoin</strong>
                    <small>BTC</small>
                  </span>
                  {receiveAsset === "BTC" ? (
                    <span className="selection-check">
                      <Icon name="check" size={15} />
                    </span>
                  ) : null}
                </button>
              </div>
            </fieldset>

            {receivesBitcoin ? (
              <fieldset className="field-group">
                <legend className="field-legend">Bitcoin destination</legend>
                <div className="segmented">
                  {(["lightning_address", "lightning_invoice"] as const).map((type) => (
                    <button
                      aria-pressed={lightningDestinationType === type}
                      className={`segment-card${
                        lightningDestinationType === type ? " is-selected" : ""
                      }`}
                      key={type}
                      onClick={() => setLightningDestinationType(type)}
                      type="button"
                    >
                      <span className="segment-copy">
                        <strong>
                          {type === "lightning_address" ? "Lightning address" : "Invoice"}
                        </strong>
                        <small>
                          {type === "lightning_address" ? "name@wallet.com" : "One-time invoice"}
                        </small>
                      </span>
                      {lightningDestinationType === type ? (
                        <span className="selection-check">
                          <Icon name="check" size={15} />
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
                <label className="field-label" htmlFor="bitcoin-destination">
                  {lightningDestinationType === "lightning_address"
                    ? "Lightning address"
                    : "Lightning invoice"}
                </label>
                {lightningDestinationType === "lightning_address" ? (
                  <input
                    className="field"
                    id="bitcoin-destination"
                    onChange={(event) => setLightningDestination(event.target.value)}
                    placeholder="shop@wallet.com"
                    required
                    value={lightningDestination}
                  />
                ) : (
                  <textarea
                    className="field"
                    id="bitcoin-destination"
                    onChange={(event) => setLightningDestination(event.target.value)}
                    placeholder="Paste an invoice beginning with lnbc or lntb"
                    required
                    rows={4}
                    value={lightningDestination}
                  />
                )}
                <p className="field-help">
                  Payment goes to this external wallet. Ntumba does not hold it.
                </p>
              </fieldset>
            ) : (
              <fieldset className="field-group">
                <legend className="field-legend">Mobile Money destination</legend>
                <div className="two-fields">
                  <label className="field-group" htmlFor="network">
                    <span className="field-label">Network</span>
                    <select
                      className="field"
                      id="network"
                      onChange={(event) => setNetwork(event.target.value as MobileMoneyNetwork)}
                      value={network}
                    >
                      {networks.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field-group" htmlFor="phone">
                    <span className="field-label">Mobile number</span>
                    <input
                      className="field"
                      id="phone"
                      inputMode="tel"
                      onChange={(event) => setPhone(event.target.value)}
                      placeholder="097 123 4567"
                      required
                      value={phone}
                    />
                  </label>
                </div>
              </fieldset>
            )}

            {showReference ? (
              <div className="field-group">
                <label className="field-label" htmlFor="reference">
                  Reference <span className="field-help">(optional)</span>
                </label>
                <input
                  className="field"
                  id="reference"
                  maxLength={120}
                  onChange={(event) => setReference(event.target.value)}
                  placeholder="Table 4 or Invoice 102"
                  value={reference}
                />
              </div>
            ) : (
              <button className="text-button" onClick={() => setShowReference(true)} type="button">
                <span aria-hidden="true">＋</span>
                Add reference
              </button>
            )}

            <button className="primary-button full-width" disabled={!canSubmit} type="submit">
              {createRequest.isPending ? "Creating request…" : "Create request"}
            </button>

            {createRequest.isError ? (
              <InlineStatus tone="danger">
                <Icon name="info" />
                {createRequest.error.message.includes("unavailable")
                  ? "Payment services are unavailable right now. Try again shortly."
                  : createRequest.error.message}
              </InlineStatus>
            ) : null}

            <p className="privacy-note">
              <Icon name="shield" size={18} />
              No account · Saved only on this device
            </p>

            <details className="how-it-works">
              <summary>How Ntumba works</summary>
              <p>
                Your customer pays your external wallet directly or uses an external provider that
                pays you. Ntumba coordinates the request and never holds the funds.
              </p>
            </details>
          </form>
        </section>

        <aside className="surface-card support-panel">
          <h2>Three quick decisions</h2>
          <ul>
            <li>Enter the amount in Kwacha.</li>
            <li>Choose Mobile Money or Bitcoin.</li>
            <li>Confirm where you want to receive it.</li>
          </ul>
          <p>
            Set your business name and remembered destinations in Settings. Your customer chooses
            the payment method at checkout.
          </p>
        </aside>
      </div>
    </MerchantShell>
  );
}
