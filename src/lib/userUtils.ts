import { AppUser } from '../types';

/**
 * The one and only admin userId in the system.
 * Replace this if your actual admin ID is different.
 */
const ADMIN_USER_ID = "8888";

/**
 * userId -> display name map. This is populated ONLY from the Sheet at
 * runtime, via registerNamesFromProjects() below. No hardcoded names.
 */
const USER_NAMES_DICT: Record<string, string> = {};

/**
 * Auto-registers names from fetched project data if a new userId
 * shows up with a name attached (e.g. from Project.users[]).
 * Call this once after fetching your projects list.
 *
 * Sheet data always wins over the static fallback dict above —
 * this keeps every screen showing the name currently set in the Sheet.
 *
 * IMPORTANT: projects only ever store the numeric userId now (never a
 * name) — `users[0]` here will normally just be the same digits as
 * `userId`. Registering that as if it were a "name" would incorrectly
 * out-rank the real name an admin set in Settings → User Control (this
 * dict is checked before the allowedUsers list in getUserDisplayName
 * below), which is exactly the bug that made IDs show up as literal text
 * instead of a person's name. So a purely-numeric `users[0]` is skipped —
 * only an actual non-numeric name string gets registered here.
 */
export const registerNamesFromProjects = (projects: any[]): void => {
  if (!projects || !Array.isArray(projects)) return;
  projects.forEach((p) => {
    if (p.userId && p.users && p.users.length > 0) {
      const uId = String(p.userId).trim();
      const rawName = p.users[0];
      const trimmed = rawName && String(rawName).trim();
      if (trimmed && !/^\d+$/.test(trimmed)) {
        USER_NAMES_DICT[uId] = trimmed;
      }
    }
  });
};

/**
 * Checks if a given userId is an admin — the single hardcoded admin ID
 * always counts, PLUS any ID/email present in the optional `adminEmails`
 * list (the app's actually-configured admin accounts, which several call
 * sites already pass in). Previously this second argument was silently
 * ignored (plain JS lets you call a 1-arg function with 2 args without
 * erroring), so configured admins who aren't the hardcoded "8888" ID were
 * never excluded from "all users" lists on the admin side — they showed up
 * mixed in alongside real team members. Both checks are case-insensitive.
 */
export const isUserAdmin = (
  userId: string | null | undefined,
  adminEmails: string[] = []
): boolean => {
  if (!userId) return false;
  const id = String(userId).trim();
  if (id === ADMIN_USER_ID) return true;
  const idLower = id.toLowerCase();
  return adminEmails.some((a) => String(a || '').trim().toLowerCase() === idLower);
};

/**
 * Resolves a userId to a display name.
 * Checks admin first, then the static/auto-registered dict,
 * then the allowedUsers list, falls back to "User {id}" if nothing matches.
 */
export const getUserDisplayName = (
  userId: string | null | undefined,
  allowedUsers: AppUser[] = []
): string => {
  if (!userId) return '';
  const id = String(userId).trim();

  if (isUserAdmin(id)) {
    return 'Admin';
  }

  if (USER_NAMES_DICT[id]) {
    return USER_NAMES_DICT[id];
  }

  const matched = allowedUsers.find(
    (u) => u.email.trim() === id || u.name.trim().toLowerCase() === id.toLowerCase()
  );
  if (matched) return matched.name;

  return `User ${id}`;
};

/**
 * Compares two identifiers (userId, or userId vs a name string from the
 * Sheet) for equality. Falls back to resolving both through the Sheet-driven
 * display-name lookup, so "4001" and "Vatsal Patel" are recognized as the
 * same person even if the Sheet stores names in some places and IDs in others.
 *
 * IMPORTANT: the name-based fallback below is ONLY safe when at least one of
 * the two values being compared is NOT itself a real, registered user ID
 * (i.e. it's a raw name typed into the Sheet's "Users" column instead of an
 * ID). If BOTH values are real, distinct, registered IDs, they must never be
 * treated as "the same person" just because they happen to resolve to the
 * same display name — two different real accounts can legitimately share an
 * identical name (e.g. two team members both named "Kavita Mishra"), and
 * matching on name in that case was silently merging/duplicating their
 * projects and pending stats across each other's user IDs on the admin side.
 */
export const doesUserMatch = (
  userA: string,
  userB: string,
  allowedUsers: AppUser[] = []
): boolean => {
  if (!userA || !userB) return false;
  const a = userA.trim().toLowerCase();
  const b = userB.trim().toLowerCase();
  if (a === b) return true;

  const aIsKnownId = allowedUsers.some((u) => u.email.trim().toLowerCase() === a);
  const bIsKnownId = allowedUsers.some((u) => u.email.trim().toLowerCase() === b);
  if (aIsKnownId && bIsKnownId) return false; // two distinct real IDs — must match on ID only

  const nameA = getUserDisplayName(a, allowedUsers).toLowerCase();
  const nameB = getUserDisplayName(b, allowedUsers).toLowerCase();
  if (nameA && nameB && nameA === nameB) return true;

  return false;
};

/**
 * Comparator for sorting user/project rows by their numeric user ID (e.g.
 * "7412"). Purely-numeric IDs sort in ascending numeric order (so "9" comes
 * before "10"); anything non-numeric falls back to plain string sorting and
 * is pushed after the numeric IDs. Used everywhere the admin side needs to
 * list users/projects "user ID number se hi" (in numeric-ID order) instead
 * of alphabetically by display name.
 */
export const numericIdCompare = (idA: string | null | undefined, idB: string | null | undefined): number => {
  const a = String(idA || '').trim();
  const b = String(idB || '').trim();
  const numA = Number(a);
  const numB = Number(b);
  const aIsNum = a !== '' && !Number.isNaN(numA);
  const bIsNum = b !== '' && !Number.isNaN(numB);
  if (aIsNum && bIsNum) return numA - numB;
  if (aIsNum && !bIsNum) return -1;
  if (!aIsNum && bIsNum) return 1;
  return a.localeCompare(b);
};
