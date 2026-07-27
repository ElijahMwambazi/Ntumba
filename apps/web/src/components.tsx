import { Link } from "@tanstack/react-router";
import QRCode from "qrcode";
import { type ReactNode, useEffect, useState } from "react";
import { formatCountdown, isExpired } from "./payment-ui.js";

type IconName =
  | "activity"
  | "bitcoin"
  | "check"
  | "clock"
  | "copy"
  | "home"
  | "info"
  | "mobile"
  | "receipt"
  | "settings"
  | "share"
  | "shield";

export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    activity: <path d="M4 16h3l2-7 3 11 2-8 2 4h4" />,
    bitcoin: (
      <>
        <path d="M9 4v16M14 4v16" />
        <path d="M7 7h8a3 3 0 0 1 0 6H8h8a3 3 0 0 1 0 6H7" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="8" width="11" height="11" rx="2" />
        <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
      </>
    ),
    home: (
      <>
        <path d="m3 11 9-8 9 8" />
        <path d="M5 10v10h14V10M9 20v-6h6v6" />
      </>
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6M12 7h.01" />
      </>
    ),
    mobile: (
      <>
        <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
        <path d="M10 6h4M11 18h2" />
      </>
    ),
    receipt: (
      <>
        <path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z" />
        <path d="M9 8h6M9 12h6" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.5-2.4 1a8 8 0 0 0-1.8-1L14.4 3h-4.8L9.2 6a8 8 0 0 0-1.8 1L5 6 3 9.5 5.1 11a7 7 0 0 0 0 2L3 14.5 5 18l2.4-1a8 8 0 0 0 1.8 1l.4 3h4.8l.4-3a8 8 0 0 0 1.8-1l2.4 1 2-3.5-2.1-1.5a7 7 0 0 0 .1-1Z" />
      </>
    ),
    share: (
      <>
        <circle cx="18" cy="5" r="2.5" />
        <circle cx="6" cy="12" r="2.5" />
        <circle cx="18" cy="19" r="2.5" />
        <path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4" />
      </>
    ),
    shield: <path d="M12 3 5 6v5c0 4.8 2.8 8.2 7 10 4.2-1.8 7-5.2 7-10V6Z" />,
  };

  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width={size}
    >
      {paths[name]}
    </svg>
  );
}

function Brand() {
  return (
    <Link aria-label="Ntumba Get paid" className="brand" to="/">
      <img
        alt=""
        aria-hidden="true"
        className="brand-mark"
        height="34"
        src="/ntumba-logo.png"
        width="34"
      />
      <span>Ntumba</span>
    </Link>
  );
}

export type MerchantDestination = "activity" | "get-paid" | "settings";

export function MerchantShell({
  active,
  children,
  headerAction,
}: {
  active?: MerchantDestination;
  children: ReactNode;
  headerAction?: ReactNode;
}) {
  const navigation = [
    { destination: "get-paid" as const, icon: "home" as const, label: "Get paid", to: "/" },
    {
      destination: "activity" as const,
      icon: "activity" as const,
      label: "Activity",
      to: "/activity",
    },
    {
      destination: "settings" as const,
      icon: "settings" as const,
      label: "Settings",
      to: "/settings",
    },
  ];

  return (
    <div className="app-page">
      <header className="app-header">
        <Brand />
        {headerAction ? <div className="header-action">{headerAction}</div> : null}
      </header>
      <main className="merchant-main">{children}</main>
      <nav aria-label="Merchant" className="bottom-nav">
        <div className="bottom-nav-inner">
          {navigation.map((item) => {
            const selected = item.destination === active;
            return (
              <Link
                aria-current={selected ? "page" : undefined}
                className={`nav-item${selected ? " is-active" : ""}`}
                key={item.destination}
                to={item.to}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
                {selected ? <span className="nav-current">Current</span> : null}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

export function GuestShell({ children }: { children: ReactNode }) {
  return (
    <div className="guest-page">
      <header className="guest-header">
        <Brand />
        <span className="guest-label">Secure payment</span>
      </header>
      <main className="guest-main">{children}</main>
    </div>
  );
}

export function InlineStatus({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "danger" | "neutral" | "success" | "warning";
}) {
  return (
    <div aria-live="polite" className={`inline-status status-${tone}`} role="status">
      {children}
    </div>
  );
}

export function Countdown({ expiresAt, onExpire }: { expiresAt: string; onExpire?: () => void }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (isExpired(expiresAt, now)) {
      onExpire?.();
    }
  }, [expiresAt, now, onExpire]);

  return (
    <span className="countdown">
      <Icon name="clock" size={18} />
      {isExpired(expiresAt, now) ? "Expired" : `${formatCountdown(expiresAt, now)} remaining`}
    </span>
  );
}

export function PaymentQr({ value }: { value: string }) {
  const [source, setSource] = useState<string>();

  useEffect(() => {
    let current = true;
    void QRCode.toDataURL(value, {
      color: { dark: "#071A12", light: "#FFFFFF" },
      errorCorrectionLevel: "M",
      margin: 2,
      width: 300,
    }).then((result) => {
      if (current) setSource(result);
    });
    return () => {
      current = false;
    };
  }, [value]);

  return source ? (
    <img alt="QR code for the payment link" className="payment-qr" src={source} />
  ) : (
    <div aria-live="polite" className="payment-qr qr-loading">
      Preparing QR…
    </div>
  );
}
