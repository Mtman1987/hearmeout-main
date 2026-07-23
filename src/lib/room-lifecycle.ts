export const ROOM_LIFETIME_HOURS = 6;
export const ROOM_LIFETIME_MS = ROOM_LIFETIME_HOURS * 60 * 60 * 1000;

export function roomExpiryFrom(now = Date.now()) {
  return new Date(now + ROOM_LIFETIME_MS).toISOString();
}

export function effectiveRoomExpiry(expiresAt?: string, createdAt?: string) {
  const storedExpiry = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  const createdTime = createdAt ? Date.parse(createdAt) : Number.NaN;
  const lifecycleExpiry = Number.isFinite(createdTime) ? createdTime + ROOM_LIFETIME_MS : Number.NaN;

  if (Number.isFinite(storedExpiry) && Number.isFinite(lifecycleExpiry)) {
    return Math.min(storedExpiry, lifecycleExpiry);
  }
  if (Number.isFinite(storedExpiry)) return storedExpiry;
  if (Number.isFinite(lifecycleExpiry)) return lifecycleExpiry;
  return null;
}
