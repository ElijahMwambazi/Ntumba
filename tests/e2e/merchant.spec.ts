import { expect, type Page, test } from "@playwright/test";

const publicId = "6e2c0b48-4db7-4608-b744-58aecfa5fa34";
const quoteIds = {
  btc_to_btc: "5fe17c50-13d4-4bc4-936f-f80156fa6444",
  btc_to_zmw: "4dcc07fe-06bf-4bbd-86f3-16feaa4f7f50",
  zmw_to_btc: "8d23ce94-38d0-4f51-8f23-640a71ac578c",
};
const intentIds = {
  btc_to_btc: "ac791f8b-0fe0-4724-aea8-ce0ea006cffc",
  btc_to_zmw: "64f86ea3-1c26-4341-93ab-e5767607c8db",
  zmw_to_btc: "59bd6c76-cbbb-405f-8765-a61abb9a71d9",
};

function expiresIn(minutes: number) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function quote(direction: keyof typeof quoteIds, amountZmw: string, expired = false) {
  const expiry = expired ? new Date(Date.now() - 1_000).toISOString() : expiresIn(10);
  if (direction === "btc_to_zmw") {
    return {
      amountZmw,
      direction,
      exchangeRate: "1 BTC = K1800000.00",
      expiresAt: expiry,
      feeZmw: "5.00",
      merchantReceives: { amount: amountZmw, asset: "ZMW", display: `K${amountZmw}` },
      payerSends: { amount: "5834", asset: "BTC", display: "5,834 sats" },
      quoteId: quoteIds[direction],
    };
  }
  if (direction === "btc_to_btc") {
    return {
      amountZmw,
      direction,
      exchangeRate: "1 BTC = K1800000.00",
      expiresAt: expiry,
      feeZmw: "0.00",
      merchantReceives: { amount: "5556", asset: "BTC", display: "5,556 sats" },
      payerSends: { amount: "5556", asset: "BTC", display: "5,556 sats" },
      quoteId: quoteIds[direction],
    };
  }
  return {
    amountZmw,
    direction,
    exchangeRate: "1 BTC = K1800000.00",
    expiresAt: expiry,
    feeZmw: "5.00",
    merchantReceives: { amount: "5555", asset: "BTC", display: "5,555 sats" },
    payerSends: { amount: "105.00", asset: "ZMW", display: "K105.00" },
    quoteId: quoteIds[direction],
  };
}

async function mockPayments(page: Page, options: { expired?: boolean } = {}) {
  let published: Record<string, unknown> | undefined;

  await page.route("**/api/v1/quotes", async (route) => {
    const body = route.request().postDataJSON() as {
      amountZmw: string;
      direction: keyof typeof quoteIds;
    };
    await route.fulfill({ json: quote(body.direction, body.amountZmw, options.expired) });
  });

  await page.route("**/api/v1/payment-intents", async (route) => {
    const body = route.request().postDataJSON() as {
      direction: keyof typeof intentIds;
    };
    const quoted = quote(body.direction, "125.00", options.expired);
    const direct = body.direction === "btc_to_btc";
    await route.fulfill({
      json: {
        checkout: direct
          ? {
              merchantOwned: true,
              paymentRequest: "lntb10n1merchantownedinvoice000000",
              type: "direct_lightning",
              verification: "unverified",
            }
          : {
              checkoutUrl: "https://provider.invalid/checkout/fake",
              instructions:
                body.direction === "zmw_to_btc"
                  ? "Approve the Mobile Money request from the external payment partner."
                  : "Pay the external payment partner’s Lightning invoice.",
              providerReference: `fake-${body.direction}`,
              type: "provider",
            },
        direction: body.direction,
        expiresAt: quoted.expiresAt,
        paymentIntentId: intentIds[body.direction],
        quote: quoted,
        status: direct ? "direct_payment_pending" : "provider_collecting",
      },
    });
  });

  await page.route("**/api/v1/public-requests", async (route) => {
    const body = route.request().postDataJSON() as {
      amountZmw: string;
      merchantLabel?: string;
      options: unknown[];
      receiveAsset: "BTC" | "ZMW";
      reference?: string;
    };
    published = {
      amountZmw: body.amountZmw,
      createdAt: new Date().toISOString(),
      developmentOnly: true,
      expiresAt: options.expired ? new Date(Date.now() - 1_000).toISOString() : expiresIn(10),
      merchantLabel: body.merchantLabel ?? null,
      options: body.options,
      publicId,
      receiveAsset: body.receiveAsset,
      reference: body.reference ?? null,
    };
    await route.fulfill({ json: published, status: 201 });
  });

  await page.route(`**/api/v1/public-requests/${publicId}`, async (route) => {
    if (!published) {
      const directQuote = quote("btc_to_btc", "125.00", options.expired);
      published = {
        amountZmw: "125.00",
        createdAt: new Date().toISOString(),
        developmentOnly: true,
        expiresAt: directQuote.expiresAt,
        merchantLabel: "Lusaka Market",
        options: [
          {
            intent: {
              checkout: {
                merchantOwned: true,
                paymentRequest: "lntb10n1merchantownedinvoice000000",
                type: "direct_lightning",
                verification: "unverified",
              },
              direction: "btc_to_btc",
              expiresAt: directQuote.expiresAt,
              paymentIntentId: intentIds.btc_to_btc,
              quote: directQuote,
              status: "direct_payment_pending",
            },
            payerMethod: "BTC",
          },
          {
            intent: {
              checkout: {
                checkoutUrl: "https://provider.invalid/checkout/fake",
                instructions: "Approve the Mobile Money request from the external payment partner.",
                providerReference: "fake-zmw-to-btc",
                type: "provider",
              },
              direction: "zmw_to_btc",
              expiresAt: directQuote.expiresAt,
              paymentIntentId: intentIds.zmw_to_btc,
              quote: quote("zmw_to_btc", "125.00", options.expired),
              status: "provider_collecting",
            },
            payerMethod: "ZMW",
          },
        ],
        publicId,
        receiveAsset: "BTC",
        reference: "Table 4",
      };
    }
    await route.fulfill({ json: published });
  });

  await page.route("**/api/v1/payment-intents/*", async (route) => {
    const isDirect = route.request().url().includes(intentIds.btc_to_btc);
    await route.fulfill({
      json: {
        direction: isDirect ? "btc_to_btc" : "zmw_to_btc",
        expiresAt: expiresIn(10),
        failureCode: null,
        paymentIntentId: isDirect ? intentIds.btc_to_btc : intentIds.zmw_to_btc,
        status: isDirect ? "direct_payment_pending" : "provider_collecting",
        updatedAt: new Date().toISOString(),
      },
    });
  });
}

test.describe("mobile merchant and payer journey", () => {
  test.beforeEach(async ({ browserName: _browserName }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "mobile-only journey");
  });

  test("merchant creates, shares and sees an opaque request while customer chooses payment", async ({
    context,
    page,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: "http://127.0.0.1:5173",
    });
    await mockPayments(page);
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Get paid" })).toBeVisible();
    await expect(page.getByText("Payer sends")).toHaveCount(0);
    await expect(page.getByLabel("Reference")).toHaveCount(0);
    await page.screenshot({
      path: "artifacts/ui-review/mobile-get-paid-390x844.png",
    });

    const mobileLayout = await page.locator(".task-layout").evaluate((layout) => {
      const bounds = layout.getBoundingClientRect();
      return {
        left: bounds.left,
        right: window.innerWidth - bounds.right,
      };
    });
    expect(Math.abs(mobileLayout.left - mobileLayout.right)).toBeLessThanOrEqual(1);

    const navShell = await page.locator(".bottom-nav-inner").evaluate((navigation) => {
      const styles = getComputedStyle(navigation);
      return {
        borderTopLeftRadius: styles.borderTopLeftRadius,
        borderTopRightRadius: styles.borderTopRightRadius,
      };
    });
    expect(navShell).toEqual({
      borderTopLeftRadius: "20px",
      borderTopRightRadius: "20px",
    });

    const activeNavRadius = await page
      .getByRole("navigation", { name: "Merchant" })
      .getByRole("link", { name: /Get paid/ })
      .evaluate((navigation) => getComputedStyle(navigation).borderTopLeftRadius);
    expect(activeNavRadius).toBe("19px");

    await page.getByRole("button", { name: /Bitcoin BTC/ }).click();
    await expect(page.getByText("Bitcoin destination", { exact: true })).toBeVisible();
    await page.getByLabel("Amount").fill("125.00");
    await page.getByLabel("Lightning address", { exact: true }).fill("market@wallet.example");
    await page.getByRole("button", { name: "Add reference" }).click();
    await page.getByLabel("Reference").fill("Table 4");
    await page.getByRole("button", { name: "Create request" }).click();

    await expect(page).toHaveURL(/\/requests\//);
    await expect(page.getByRole("heading", { name: "Payment request created" })).toBeVisible();
    await expect(page.getByText("ma•••@wallet.example")).toBeVisible();
    await expect(page.getByLabel("Payment link")).not.toHaveValue(/#/);
    await page.screenshot({
      path: "artifacts/ui-review/mobile-share-390x844.png",
    });

    await page.getByRole("button", { name: "Copy link" }).click();
    await expect(page.getByText("Payment link copied.")).toBeVisible();
    await page.getByRole("link", { name: "Preview customer checkout" }).click();

    await expect(page).toHaveURL(`/pay/${publicId}`);
    await expect(page.getByRole("navigation", { name: "Merchant" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Choose how to pay" })).toBeVisible();
    await page.screenshot({
      path: "artifacts/ui-review/mobile-checkout-390x844.png",
    });
    await page.getByRole("button", { name: /Mobile Money Pay in Kwacha/ }).click();
    await expect(page.getByRole("heading", { name: "Your quote" })).toBeVisible();
    await page.getByRole("button", { name: "Continue with Mobile Money" }).click();
    await expect(page.getByText("Waiting for payment", { exact: true })).toBeVisible();
    await expect(page.getByText("Development-only fake payment")).toBeVisible();

    await page.goto("/activity");
    await expect(page.getByText("K125.00")).toBeVisible();
    await expect(page.getByText("Table 4")).toBeVisible();
    await page.screenshot({
      path: "artifacts/ui-review/mobile-activity-390x844.png",
    });

    const navBoxes = await page
      .getByRole("navigation", { name: "Merchant" })
      .getByRole("link")
      .evaluateAll((links) => links.map((link) => link.getBoundingClientRect().height));
    expect(navBoxes.every((height) => height >= 48)).toBe(true);
  });

  test("progressive form, local settings and clear-data confirmation work", async ({ page }) => {
    await mockPayments(page);
    await page.goto("/");
    await expect(page.getByLabel("Reference")).toHaveCount(0);
    await page.getByRole("button", { name: "Add reference" }).click();
    await expect(page.getByLabel("Reference")).toBeVisible();
    await page.getByRole("button", { name: /Bitcoin BTC/ }).click();
    await expect(page.getByText("Payer sends")).toHaveCount(0);

    await page.goto("/settings");
    await page.getByLabel("Business display name").fill("Lusaka Market");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Settings saved on this device.")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Business display name")).toHaveValue("Lusaka Market");

    await page.getByRole("button", { name: "Clear local data" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText(/removes your saved destinations/i)).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await page.getByRole("button", { name: "Clear local data" }).click();
    await page.getByRole("button", { name: "Yes, clear local data" }).click();
    await expect(page).toHaveURL("/");
    await page.goto("/activity");
    await expect(page.getByRole("heading", { name: "No requests yet" })).toBeVisible();
  });

  test("shows quote expiry and direct Bitcoin as unverified", async ({ page }) => {
    await mockPayments(page, { expired: true });
    await page.goto(`/pay/${publicId}`);
    await page.getByRole("button", { name: /Bitcoin Pay from a Lightning wallet/ }).click();
    await expect(page.getByRole("button", { name: "Quote expired" })).toBeDisabled();
    await expect(page.getByText(/ask the merchant for a new payment request/i)).toBeVisible();
  });

  test("reports session-only storage when IndexedDB is unavailable", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "indexedDB", { configurable: true, value: undefined });
    });
    await page.goto("/");
    await expect(page.getByText(/device storage is unavailable/i)).toBeVisible();
    await page.goto("/settings");
    await expect(page.getByText(/session-only storage fallback/i)).toBeVisible();
  });
});

test.describe("desktop layout", () => {
  test.beforeEach(async ({ browserName: _browserName }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "desktop-only review");
  });

  test("keeps the Get paid task dominant on desktop", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Get paid" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create request" })).toBeVisible();
    await expect(page.getByText("Three quick decisions")).toBeVisible();

    const desktopLayout = await page.locator(".task-layout").evaluate((layout) => {
      const bounds = layout.getBoundingClientRect();
      return {
        left: bounds.left,
        right: window.innerWidth - bounds.right,
      };
    });
    expect(Math.abs(desktopLayout.left - desktopLayout.right)).toBeLessThanOrEqual(1);

    await page.screenshot({
      path: "artifacts/ui-review/desktop-get-paid-1440x900.png",
    });
  });
});
