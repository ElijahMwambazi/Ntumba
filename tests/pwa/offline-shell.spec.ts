import { expect, test } from "@playwright/test";

test("installs the public shell and uses the privacy-safe fallback offline", async ({
  context,
  page,
}) => {
  await page.goto("/");

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(manifestHref).toBe("/manifest.webmanifest");
  const manifest = await page.evaluate(async () => {
    const response = await fetch("/manifest.webmanifest");
    return response.json();
  });
  expect(manifest).toMatchObject({
    name: "Ntumba",
    display: "standalone",
    start_url: "/",
  });

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), {
          once: true,
        });
      });
    }
  });

  const cachedUrls = await page.evaluate(async () => {
    const keys = await caches.keys();
    const requests = await Promise.all(keys.map(async (key) => (await caches.open(key)).keys()));
    return requests.flat().map((request) => request.url);
  });
  expect(cachedUrls.map((url) => new URL(url).pathname).sort()).toEqual(
    [
      "/icons/apple-touch-icon.png",
      "/icons/ntumba-192.png",
      "/icons/ntumba-maskable-512.png",
      "/manifest.webmanifest",
      "/ntumba-logo.png",
      "/offline.css",
      "/offline.html",
    ].sort(),
  );

  await context.setOffline(true);
  await page.goto("/activity");
  await expect(page.getByRole("heading", { name: "You’re offline" })).toBeVisible();
  await expect(page.getByText(/fresh provider confirmation/)).toBeVisible();
});
