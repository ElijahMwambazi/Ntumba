import type { Asset, MobileMoneyNetwork } from "@ntumba/contracts";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Icon, InlineStatus, MerchantShell } from "../components.js";
import { type MerchantPreferences, merchantLocalStore } from "../local-storage.js";

export function SettingsPage() {
  const navigate = useNavigate();
  const dialog = useRef<HTMLDialogElement>(null);
  const [displayName, setDisplayName] = useState("");
  const [preferredAsset, setPreferredAsset] = useState<Asset>("ZMW");
  const [network, setNetwork] = useState<MobileMoneyNetwork>("mtn");
  const [phone, setPhone] = useState("");
  const [lightningDestination, setLightningDestination] = useState("");
  const [lightningDestinationType, setLightningDestinationType] = useState<
    "lightning_address" | "lightning_invoice"
  >("lightning_address");
  const [feedback, setFeedback] = useState("");
  const [storageAvailable, setStorageAvailable] = useState(merchantLocalStore.available);

  useEffect(() => {
    void merchantLocalStore.load().then(({ preferences }) => {
      setDisplayName(preferences.displayName ?? "");
      setPreferredAsset(preferences.preferredSettlementAsset ?? "ZMW");
      setNetwork(preferences.mobileMoneyDestination?.network ?? "mtn");
      setPhone(preferences.mobileMoneyDestination?.phone ?? "");
      setLightningDestination(preferences.lightningDestination ?? "");
      setLightningDestinationType(preferences.lightningDestinationType ?? "lightning_address");
      setStorageAvailable(merchantLocalStore.available);
    });
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const preferences: MerchantPreferences = {
      ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
      ...(lightningDestination.trim()
        ? {
            lightningDestination: lightningDestination.trim(),
            lightningDestinationType,
          }
        : {}),
      ...(phone.trim() ? { mobileMoneyDestination: { network, phone: phone.trim() } } : {}),
      preferredSettlementAsset: preferredAsset,
    };
    await merchantLocalStore.update((current) => ({ ...current, preferences }));
    setStorageAvailable(merchantLocalStore.available);
    setFeedback("Settings saved on this device.");
  }

  async function clearData() {
    await merchantLocalStore.clear();
    dialog.current?.close();
    await navigate({ to: "/" });
  }

  return (
    <MerchantShell active="settings">
      <section>
        <p className="eyebrow">Private on this device</p>
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">
          Optional details that make creating requests faster. Nothing is synchronized.
        </p>

        <form className="settings-section" onSubmit={save}>
          <div className="surface-card settings-card">
            <h2 className="section-heading">This device</h2>
            <label className="field-group" htmlFor="display-name">
              <span className="field-label">Business display name</span>
              <input
                className="field"
                id="display-name"
                maxLength={80}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Shown to customers at checkout"
                value={displayName}
              />
              <span className="field-help">Optional and stored only in this browser.</span>
            </label>

            <fieldset className="field-group">
              <legend className="field-legend">Preferred settlement</legend>
              <div className="segmented">
                {(["ZMW", "BTC"] as const).map((asset) => (
                  <button
                    aria-pressed={preferredAsset === asset}
                    className={`segment-card${preferredAsset === asset ? " is-selected" : ""}`}
                    key={asset}
                    onClick={() => setPreferredAsset(asset)}
                    type="button"
                  >
                    <span className={`segment-icon${asset === "BTC" ? " bitcoin-accent" : ""}`}>
                      <Icon name={asset === "BTC" ? "bitcoin" : "mobile"} />
                    </span>
                    <span className="segment-copy">
                      <strong>{asset === "BTC" ? "Bitcoin" : "Mobile Money"}</strong>
                      <small>{asset}</small>
                    </span>
                    {preferredAsset === asset ? (
                      <span className="selection-check">
                        <Icon name="check" size={15} />
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>

          <div className="surface-card settings-card">
            <h2 className="section-heading">Remembered destinations</h2>
            <p className="field-help">
              Optional. These values never leave this device until you create a request.
            </p>
            <fieldset className="field-group">
              <legend className="field-legend">Mobile Money</legend>
              <div className="two-fields">
                <label className="field-group" htmlFor="settings-network">
                  <span className="field-label">Network</span>
                  <select
                    className="field"
                    id="settings-network"
                    onChange={(event) => setNetwork(event.target.value as MobileMoneyNetwork)}
                    value={network}
                  >
                    <option value="mtn">MTN Money</option>
                    <option value="airtel">Airtel Money</option>
                    <option value="zamtel">Zamtel Money</option>
                  </select>
                </label>
                <label className="field-group" htmlFor="settings-phone">
                  <span className="field-label">Mobile number</span>
                  <input
                    className="field"
                    id="settings-phone"
                    inputMode="tel"
                    onChange={(event) => setPhone(event.target.value)}
                    placeholder="Optional"
                    value={phone}
                  />
                </label>
              </div>
            </fieldset>

            <fieldset className="field-group">
              <legend className="field-legend">Bitcoin</legend>
              <select
                aria-label="Bitcoin destination type"
                className="field"
                onChange={(event) =>
                  setLightningDestinationType(
                    event.target.value as "lightning_address" | "lightning_invoice",
                  )
                }
                value={lightningDestinationType}
              >
                <option value="lightning_address">Lightning address</option>
                <option value="lightning_invoice">Invoice</option>
              </select>
              <textarea
                aria-label="Remembered Bitcoin destination"
                className="field"
                onChange={(event) => setLightningDestination(event.target.value)}
                placeholder="Optional Lightning address or invoice"
                rows={lightningDestinationType === "lightning_invoice" ? 4 : 2}
                value={lightningDestination}
              />
            </fieldset>

            <button className="primary-button full-width" type="submit">
              Save settings
            </button>
            {feedback ? <InlineStatus tone="success">{feedback}</InlineStatus> : null}
          </div>
        </form>

        <div className="surface-card settings-card form-card">
          <h2 className="section-heading">Storage</h2>
          <div className="storage-status">
            <Icon name={storageAvailable ? "check" : "info"} />
            <span>
              {storageAvailable
                ? "Local device storage is available."
                : "Session-only storage fallback is active."}
            </span>
          </div>
          <p className="field-help">
            Clearing browser data or losing this device removes settings, requests and receipts.
          </p>
        </div>

        <div className="surface-card settings-card danger-zone form-card">
          <h2 className="section-heading">Clear local data</h2>
          <p className="field-help">
            Removes Ntumba preferences, requests and receipts from this device only.
          </p>
          <button
            className="danger-button"
            onClick={() => dialog.current?.showModal()}
            type="button"
          >
            Clear local data
          </button>
        </div>

        <dialog aria-labelledby="clear-title" className="dialog-backdrop" ref={dialog}>
          <div className="dialog-content">
            <h2 id="clear-title">Clear everything on this device?</h2>
            <p>
              This removes your saved destinations, preferences, requests and local receipts. Ntumba
              will not claim or attempt any server-side deletion.
            </p>
            <div className="dialog-actions">
              <button className="danger-button" onClick={clearData} type="button">
                Yes, clear local data
              </button>
              <button
                className="secondary-button"
                onClick={() => dialog.current?.close()}
                type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        </dialog>
      </section>
    </MerchantShell>
  );
}
