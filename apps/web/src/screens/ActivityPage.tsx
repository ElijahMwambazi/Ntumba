import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Icon, MerchantShell } from "../components.js";
import {
  LOCAL_STORAGE_SCHEMA_VERSION,
  type MerchantLocalData,
  merchantLocalStore,
} from "../local-storage.js";
import { isExpired, plainStatus } from "../payment-ui.js";

const emptyData: MerchantLocalData = {
  preferences: {},
  receipts: [],
  requests: [],
  schemaVersion: LOCAL_STORAGE_SCHEMA_VERSION,
};

export function ActivityPage() {
  const [data, setData] = useState<MerchantLocalData>(emptyData);

  useEffect(() => {
    void merchantLocalStore.load().then(setData);
  }, []);

  return (
    <MerchantShell active="activity">
      <section>
        <p className="eyebrow">Private on this device</p>
        <h1 className="page-title">Activity</h1>
        <p className="page-subtitle">Requests and receipts saved in this browser.</p>

        {data.requests.length === 0 && data.receipts.length === 0 ? (
          <div className="surface-card empty-state">
            <span className="empty-icon">
              <Icon name="receipt" size={28} />
            </span>
            <h2>No requests yet</h2>
            <p>Requests and receipts created on this device will appear here.</p>
            <Link className="primary-button" to="/">
              Create request
            </Link>
          </div>
        ) : (
          <div className="activity-list">
            {data.requests.map((request) => {
              const presentation = isExpired(request.expiresAt)
                ? plainStatus.expired
                : plainStatus[request.status];
              return (
                <Link
                  className="activity-card"
                  key={request.localId}
                  params={{ localId: request.localId }}
                  to="/requests/$localId"
                >
                  <div className="activity-card-top">
                    <div>
                      <div className="activity-amount">K{request.amountZmw}</div>
                      <div className="activity-meta">
                        <span>
                          {request.receiveAsset === "ZMW" ? "Mobile Money · ZMW" : "Bitcoin · BTC"}
                        </span>
                      </div>
                    </div>
                    <span className="status-chip">
                      <Icon name={presentation.tone === "success" ? "check" : "clock"} size={15} />
                      {presentation.label}
                    </span>
                  </div>
                  {request.reference ? <strong>{request.reference}</strong> : null}
                  <div className="activity-meta">
                    <span>Created {new Date(request.createdAt).toLocaleString()}</span>
                    <span>
                      {isExpired(request.expiresAt)
                        ? "Expired"
                        : `Expires ${new Date(request.expiresAt).toLocaleTimeString()}`}
                    </span>
                  </div>
                </Link>
              );
            })}

            {data.receipts.map((receipt) => (
              <div className="activity-card" key={receipt.id}>
                <div className="activity-card-top">
                  <div>
                    <div className="activity-amount">K{receipt.amountZmw}</div>
                    <div className="activity-meta">
                      <span>{receipt.receiveAsset === "ZMW" ? "Mobile Money" : "Bitcoin"}</span>
                    </div>
                  </div>
                  <span className="status-chip">
                    <Icon
                      name={receipt.verification === "provider_confirmed" ? "check" : "info"}
                      size={15}
                    />
                    {receipt.verification === "provider_confirmed"
                      ? "Payment received"
                      : "Payment unverified"}
                  </span>
                </div>
                {receipt.reference ? <strong>{receipt.reference}</strong> : null}
                <div className="activity-meta">
                  <span>{new Date(receipt.createdAt).toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </MerchantShell>
  );
}
