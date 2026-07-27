const ZMW_SCALE = 100n;

export function parseZmwToMinor(value: string): bigint {
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error("Invalid ZMW amount.");
  }

  const [whole = "0", fraction = ""] = normalized.split(".");
  return BigInt(whole) * ZMW_SCALE + BigInt(fraction.padEnd(2, "0"));
}

export function formatZmwFromMinor(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const whole = absolute / ZMW_SCALE;
  const fraction = (absolute % ZMW_SCALE).toString().padStart(2, "0");
  return `${sign}${whole}.${fraction}`;
}

export function ceilDivide(dividend: bigint, divisor: bigint): bigint {
  if (dividend < 0n || divisor <= 0n) {
    throw new Error("ceilDivide accepts a non-negative dividend and positive divisor.");
  }

  return dividend === 0n ? 0n : (dividend + divisor - 1n) / divisor;
}
