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

export const CANONICAL_PROFILES = [
  {
    name: "Vatsal Patel",
    keys: [
      "4001",
      "8888",
      "vatsalpatelwork20@gmail.com",
      "vatsalpatel1720@gmail.com",
      "vatsal.assetscout@gmail.com",
      "vatsal patel",
      "vatsal"
    ]
  },
  {
    name: "Pratap More",
    keys: [
      "1859",
      "9531",
      "pratap more",
      "pratap"
    ]
  },
  {
    name: "Kavita Patel",
    keys: [
      "5595",
      "kavita.assetscout@gmail.com",
      "kavita patel",
      "kavita"
    ]
  },
  {
    name: "Rohan Patel",
    keys: [
      "assetscout007rohan@gmail.com",
      "rohan patel",
      "rohan"
    ]
  },
  {
    name: "Rushikesh Pote",
    keys: [
      "rushikeshpote14@gmail.com",
      "rushikesh pote",
      "rushikesh"
    ]
  }
];

export const getProfileName = (userStr: string, allowedUsers: AppUser[] = []): string => {
  const s = userStr.trim().toLowerCase();
  if (!s) return "";

  // 1. Check hardcoded profiles
  for (const profile of CANONICAL_PROFILES) {
    if (profile.keys.includes(s) || profile.name.toLowerCase() === s) {
      return profile.name;
    }
  }

  // 2. Check allowedUsers list
  for (const u of allowedUsers) {
    const uEmail = u.email.trim().toLowerCase();
    const uName = u.name.trim().toLowerCase();
    if (uEmail === s || uName === s) {
      return u.name;
    }
    const firstName = u.name.split(/\s+/)[0].toLowerCase();
    if (firstName && firstName === s && firstName !== 'user') {
      return u.name;
    }
  }

  // 3. Fallback: if numeric ID, find in allowedUsers
  if (/^\d+$/.test(s)) {
    const found = allowedUsers.find(u => u.email.trim().toLowerCase() === s);
    if (found) return found.name;
  }

  return "";
};

export const getUserIdentifiers = (emailOrId: string, allowedUsers: AppUser[] = []): string[] => {
  if (!emailOrId) return [];
  const val = emailOrId.trim().toLowerCase();
  const profile = getProfileName(val, allowedUsers);
  if (profile) {
    const matchedProfile = CANONICAL_PROFILES.find(p => p.name === profile);
    if (matchedProfile) {
      return matchedProfile.keys;
    }
    return [val, profile.toLowerCase()];
  }
  return [val];
};

export const doesUserMatch = (userA: string, userB: string, allowedUsers: AppUser[] = []): boolean => {
  if (!userA || !userB) return false;
  const a = userA.trim().toLowerCase();
  const b = userB.trim().toLowerCase();
  if (a === b) return true;

  const profileA = getProfileName(a, allowedUsers);
  const profileB = getProfileName(b, allowedUsers);

  if (profileA && profileB && profileA.toLowerCase() === profileB.toLowerCase()) {
    return true;
  }

  return false;
};

