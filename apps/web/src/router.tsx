import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { ActivityPage } from "./screens/ActivityPage.js";
import { CheckoutPage } from "./screens/CheckoutPage.js";
import { MerchantPage } from "./screens/MerchantPage.js";
import { SettingsPage } from "./screens/SettingsPage.js";
import { SharePage } from "./screens/SharePage.js";

function RouteScrollReset() {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return null;
}

function RootLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <>
      <RouteScrollReset key={pathname} />
      <Outlet />
    </>
  );
}

const rootRoute = createRootRoute({ component: RootLayout });
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: MerchantPage,
});
const activityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/activity",
  component: ActivityPage,
});
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});
const shareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/requests/$localId",
  component: SharePage,
});
const checkoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/pay/$publicId",
  component: CheckoutPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  activityRoute,
  settingsRoute,
  shareRoute,
  checkoutRoute,
]);
export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
