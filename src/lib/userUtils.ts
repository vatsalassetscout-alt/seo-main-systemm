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
 */
export const registerNamesFromProjects = (projects: any[]): void => {
  if (!projects || !Array.isArray(projects)) return;
  projects.forEach((p) => {
    if (p.userId && p.users && p.users.length > 0) {
      const uId = String(p.userId).trim();
      const rawName = p.users[0];
      if (rawName && rawName.trim()) {
        USER_NAMES_DICT[uId] = rawName.trim();
      }
    }
  });
};

/**
 * Checks if a given userId is the admin.
 */
export const isUserAdmin = (userId: string | null | undefined): boolean => {
  if (!userId) return false;
  return String(userId).trim() === ADMIN_USER_ID;
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
 * Compares two userId values (or a userId and a name) for equality.
 */
export const doesUserMatch = (userA: string, userB: string): boolean => {
  if (!userA || !userB) return false;
  return userA.trim().toLowerCase() === userB.trim().toLowerCase();
};
