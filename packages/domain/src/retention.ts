export interface RetentionWindow {
  expiresAt: Date;
  purgeAt: Date;
}

export function createRetentionWindow(
  now: Date,
  ttlSeconds: number,
  retentionSeconds: number,
): RetentionWindow {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error("TTL must be a positive integer.");
  }
  if (!Number.isInteger(retentionSeconds) || retentionSeconds < 0) {
    throw new Error("Retention must be a non-negative integer.");
  }

  const expiresAt = new Date(now.getTime() + ttlSeconds * 1_000);
  return {
    expiresAt,
    purgeAt: new Date(expiresAt.getTime() + retentionSeconds * 1_000),
  };
}

export function isPurgeDue(purgeAt: Date, now: Date): boolean {
  return purgeAt.getTime() <= now.getTime();
}
