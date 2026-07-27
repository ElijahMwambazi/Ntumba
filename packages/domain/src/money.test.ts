import { describe, expect, it } from "vitest";
import { formatZmwFromMinor, parseZmwToMinor } from "./money.js";

describe("ZMW conversion", () => {
  it("stores Kwacha as integer ngwee", () => {
    expect(parseZmwToMinor("100.25")).toBe(10_025n);
    expect(formatZmwFromMinor(10_025n)).toBe("100.25");
  });

  it("rejects amounts with more than two decimal places", () => {
    expect(() => parseZmwToMinor("1.001")).toThrow("Invalid ZMW amount");
  });
});
