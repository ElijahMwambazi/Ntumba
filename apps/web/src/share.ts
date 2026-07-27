export interface ShareNavigator {
  share?: (data: ShareData) => Promise<void>;
}

export function canNativeShare(navigatorLike: ShareNavigator): boolean {
  return typeof navigatorLike.share === "function";
}

export async function nativeShare(
  navigatorLike: ShareNavigator,
  data: ShareData,
): Promise<"shared" | "unavailable"> {
  if (!navigatorLike.share) {
    return "unavailable";
  }
  await navigatorLike.share(data);
  return "shared";
}
