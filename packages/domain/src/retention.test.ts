import { describe, expect, it } from "vitest";
import { createRetentionWindow, isPurgeDue } from "./retention.js";

describe("payment retention", () => {
  it("schedules purge after expiry plus the configured retention", () => {
    const now = new Date("2026-07-27T10:00:00.000Z");
    const window = createRetentionWindow(now, 60, 3_600);

    expect(window.expiresAt.toISOString()).toBe("2026-07-27T10:01:00.000Z");
    expect(window.purgeAt.toISOString()).toBe("2026-07-27T11:01:00.000Z");
    expect(isPurgeDue(window.purgeAt, new Date("2026-07-27T11:01:00.000Z"))).toBe(true);
  });
});
