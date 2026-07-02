import { AppUser } from '../types';

const USER_NAMES_DICT: Record<string, string> = {
  "vatsalpatelwork20@gmail.com": "Vatsal Patel",
  "vatsalpatel1720@gmail.com": "Vatsal Patel",
  "vatsal.assetscout@gmail.com": "Vatsal Patel",
  "rushikeshpote14@gmail.com": "Rushikesh Pote",
  "kavita.assetscout@gmail.com": "Kavita Patel",
  "assetscout007rohan@gmail.com": "Rohan Patel",
  "admin": "Admin"
};

/**
 * Dynamically register names from fetched Google Sheets projects
 */
export const registerNamesFromProjects = (projects: any[]): void => {
  if (!projects || !Array.isArray(projects)) return;
  projects.forEach((p) => {
    if (p.userId && p.users && p.users.length > 0) {
      const uId = String(p.userId).trim().toLowerCase();
      const rawUser = p.users[0];
      if (rawUser && rawUser.trim()) {
        const trimmedUser = rawUser.trim();
        let formattedName = trimmedUser;
        // Format if it's all lowercase or simple
        if (trimmedUser === trimmedUser.toLowerCase()) {
          formattedName = trimmedUser
            .split(' ')
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');
        }
        USER_NAMES_DICT[uId] = formattedName;
      }
    }
  });
};

export const isUserAdmin = (email: string | null | undefined, adminEmails: string[] = []): boolean => {
  if (!email) return false;
  const emailLower = email.trim().toLowerCase();
  if (emailLower === '8888' || emailLower === 'admin' || emailLower.includes("admin")) return true;
  if (adminEmails && adminEmails.some(a => a.trim().toLowerCase() === emailLower)) return true;
  const hardcodedAdmins = ['vatsalpatelwork20@gmail.com', 'assetscout007rohan@gmail.com'];
  if (hardcodedAdmins.some((a) => a.trim().toLowerCase() === emailLower)) return true;
  return false;
};

/**
 * Resolves a user ID or email address to a formatted display name.
 */
export const getUserDisplayName = (email: string | null | undefined, allowedUsers: AppUser[] = [], adminEmails: string[] = []): string => {
  if (!email) return '';
  const val = email.trim().toLowerCase();

  if (isUserAdmin(val, adminEmails)) {
    return 'Admin';
  }

  if (USER_NAMES_DICT[val]) {
    return USER_NAMES_DICT[val];
  }

  // Also check email prefix
  const prefix = val.split('@')[0];
  if (USER_NAMES_DICT[prefix]) {
    return USER_NAMES_DICT[prefix];
  }

  // Smart partial name matching for USER_NAMES_DICT (e.g. "rushikesh" maps to "Rushikesh Pote")
  const dictKeys = Object.keys(USER_NAMES_DICT);
  const foundPartialKey = dictKeys.find(k => k === val || k.split(' ').includes(val));
  if (foundPartialKey) {
    return USER_NAMES_DICT[foundPartialKey];
  }

  // Find in allowedUsers by email/id
  const matched = allowedUsers.find((u) => u.email.trim().toLowerCase() === val);
  if (matched && matched.name && matched.name.trim() && !/^User\s+\d+$/i.test(matched.name.trim())) {
    return matched.name;
  }

  // Find in allowedUsers by name
  const matchedByName = allowedUsers.find((u) => u.name.trim().toLowerCase() === val);
  if (matchedByName && matchedByName.name && matchedByName.name.trim()) {
    return matchedByName.name;
  }

  // Check if purely numeric
  if (/^\d+$/.test(val)) {
    if (val === '8888') return 'Admin';
    if (matched && matched.name && matched.name.trim()) {
      return matched.name;
    }
    return `User ${val}`;
  }

  // Fallback: format prefix of email
  const formatted = prefix
    .split(/[\._\-]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
  return formatted;
};

export const getUserIdentifiers = (emailOrId: string, allowedUsers: AppUser[] = []): string[] => {
  if (!emailOrId) return [];
  const val = emailOrId.trim().toLowerCase();
  const ids = [val];

  // Also check USER_NAMES_DICT
  if (USER_NAMES_DICT[val]) {
    ids.push(USER_NAMES_DICT[val].toLowerCase().trim());
    const parts = USER_NAMES_DICT[val].toLowerCase().trim().split(/\s+/);
    ids.push(...parts);
  }

  // Check in allowedUsers
  allowedUsers.forEach(u => {
    if (u.email.trim().toLowerCase() === val || u.name.trim().toLowerCase() === val) {
      ids.push(u.email.trim().toLowerCase());
      ids.push(u.name.trim().toLowerCase());
      const parts = u.name.trim().toLowerCase().split(/\s+/);
      ids.push(...parts);
    }
  });

  // Inverse check: check if val matches any USER_NAMES_DICT value
  Object.entries(USER_NAMES_DICT).forEach(([k, name]) => {
    const nLower = name.toLowerCase().trim();
    if (nLower === val || nLower.includes(val) || val.includes(nLower)) {
      ids.push(k);
      ids.push(nLower);
      const parts = nLower.split(/\s+/);
      ids.push(...parts);
    }
  });

  return Array.from(new Set(ids));
};

export const doesUserMatch = (userA: string, userB: string, allowedUsers: AppUser[] = []): boolean => {
  if (!userA || !userB) return false;
  const a = userA.trim().toLowerCase();
  const b = userB.trim().toLowerCase();
  if (a === b) return true;

  const idsA = getUserIdentifiers(a, allowedUsers);
  const idsB = getUserIdentifiers(b, allowedUsers);

  if (idsA.some(id => idsB.includes(id))) return true;

  const nameA = getUserDisplayName(a, allowedUsers).toLowerCase().trim();
  const nameB = getUserDisplayName(b, allowedUsers).toLowerCase().trim();
  if (nameA && nameB && nameA === nameB && nameA !== 'admin' && !nameA.startsWith('user ')) return true;

  if (a === nameB || b === nameA) return true;

  // Partial substring matches
  if (nameA.includes(nameB) || nameB.includes(nameA)) return true;

  return false;
};

