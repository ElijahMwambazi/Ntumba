import { Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Countdown, Icon, InlineStatus, MerchantShell, PaymentQr } from "../components.js";
import { type LocalPaymentRequest, merchantLocalStore } from "../local-storage.js";
import { canNativeShare, nativeShare } from "../share.js";

export function SharePage() {
  const { localId } = useParams({ from: "/requests/$localId" });
  const [request, setRequest] = useState<LocalPaymentRequest>();
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ message: string; tone: "danger" | "success" }>();

  useEffect(() => {
    void merchantLocalStore.load().then((data) => {
      setRequest(data.requests.find((item) => item.localId === localId));
      setLoading(false);
    });
  }, [localId]);

  async function copyLink() {
    if (!request) return;
    try {
      await navigator.clipboard.writeText(request.shareUrl);
      setFeedback({ message: "Payment link copied.", tone: "success" });
    } catch {
      setFeedback({
        message: "Could not copy the link. Select and copy it below.",
        tone: "danger",
      });
    }
  }

  async function share() {
    if (!request) return;
    try {
      const result = await nativeShare(navigator, {
        text: `Payment request for K${request.amountZmw}`,
        title: "Ntumba payment request",
        url: request.shareUrl,
      });
      if (result === "unavailable") {
        await copyLink();
        setFeedback({ message: "Sharing is unavailable. Payment link copied.", tone: "success" });
      } else {
        setFeedback({ message: "Share sheet opened.", tone: "success" });
      }
    } catch {
      setFeedback({ message: "Sharing was cancelled or unavailable.", tone: "danger" });
    }
  }

  if (loading) {
    return (
      <MerchantShell>
        <div aria-label="Loading request" className="skeleton" role="status" />
      </MerchantShell>
    );
  }

  if (!request) {
    return (
      <MerchantShell>
        <section className="surface-card empty-state">
          <span className="empty-icon">
            <Icon name="receipt" />
          </span>
          <h1 className="section-heading">Request not found</h1>
          <p>This request is not stored on this device.</p>
          <Link className="primary-button" to="/">
            Create request
          </Link>
        </section>
      </MerchantShell>
    );
  }

  return (
    <MerchantShell>
      <section>
        <p className="eyebrow">Ready to share</p>
        <h1 className="page-title">Payment request created</h1>

        <div className="surface-card summary-card">
          <div className="amount-display">K{request.amountZmw}</div>
          <p className="page-subtitle">
            You will receive {request.receiveAsset === "ZMW" ? "Mobile Money" : "Bitcoin"}
          </p>
          <Countdown expiresAt={request.expiresAt} />
          <div className="summary-meta">
            <div className="summary-row">
              <span>Destination</span>
              <strong>{request.maskedDestination}</strong>
            </div>
            {request.reference ? (
              <div className="summary-row">
                <span>Reference</span>
                <strong>{request.reference}</strong>
              </div>
            ) : null}
          </div>
          <PaymentQr value={request.shareUrl} />
          <div className="button-stack">
            <button className="primary-button" onClick={share} type="button">
              <Icon name="share" />
              Share request
            </button>
            <button className="secondary-button" onClick={copyLink} type="button">
              <Icon name="copy" />
              Copy link
            </button>
          </div>
          {!canNativeShare(navigator) ? (
            <p className="field-help">
              Native sharing is unavailable. Share request will copy the link.
            </p>
          ) : null}
          {feedback ? <InlineStatus tone={feedback.tone}>{feedback.message}</InlineStatus> : null}
          <label className="field-group" htmlFor="share-url">
            <span className="field-label">Payment link</span>
            <input className="field" id="share-url" readOnly value={request.shareUrl} />
          </label>
        </div>

        <div className="button-stack form-card">
          <Link className="secondary-button" to="/">
            Create another request
          </Link>
          <Link className="text-button" to="/pay/$publicId" params={{ publicId: request.publicId }}>
            Preview customer checkout
          </Link>
        </div>
      </section>
    </MerchantShell>
  );
}
