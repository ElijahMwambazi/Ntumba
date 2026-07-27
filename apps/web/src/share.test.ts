import { describe, expect, it, vi } from "vitest";
import { canNativeShare, nativeShare } from "./share.js";

describe("native sharing", () => {
  it("uses Web Share when available", async () => {
    const share = vi.fn(async () => undefined);
    expect(canNativeShare({ share })).toBe(true);
    await expect(nativeShare({ share }, { url: "https://example.test/pay/id" })).resolves.toBe(
      "shared",
    );
  });

  it("returns a copy-link fallback when Web Share is unavailable", async () => {
    expect(canNativeShare({})).toBe(false);
    await expect(nativeShare({}, { url: "https://example.test/pay/id" })).resolves.toBe(
      "unavailable",
    );
  });
});
