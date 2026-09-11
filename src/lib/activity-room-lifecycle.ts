import { effectiveRoomExpiry, roomExpiryFrom } from './room-lifecycle';

// Give legacy rooms a one-time lifetime when no creation date was stored.
// Repeated reads and launches must never move an existing expiry forward.
export function normalizeActivityRoomLifecycle<T extends { createdAt?: string; expiresAt?: string; systemRoom?: boolean }>(room: T, now = Date.now()) {
  const createdAt = room.createdAt && Number.isFinite(Date.parse(room.createdAt))
    ? room.createdAt
    : new Date(now).toISOString();
  const expiry = effectiveRoomExpiry(room.expiresAt, createdAt);
  return {
    ...room,
    createdAt,
    expiresAt: expiry !== null ? new Date(expiry).toISOString() : roomExpiryFrom(now),
    systemRoom: false,
  };
}
