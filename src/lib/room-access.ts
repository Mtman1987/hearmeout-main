export const OWNER_ROLE_ID = '1283213615939194955';

type RoomUser = {
  uid?: string;
  isAdmin?: boolean;
  group?: string;
  roles?: string[];
} | null | undefined;

export function hasOwnerRole(user: RoomUser): boolean {
  return Boolean(
    user
    && (
      user.isAdmin
      || user.group === 'Crew'
      || (Array.isArray(user.roles) && user.roles.includes(OWNER_ROLE_ID))
    )
  );
}

export function canManageRoom(user: RoomUser, ownerId?: string): boolean {
  return Boolean(user && ((ownerId && user.uid === ownerId) || hasOwnerRole(user)));
}
