export interface Project {
  id: string;
  name: string;
  code: string;
  description?: string;
  domain?: string;
  frequency?: string;
  location?: string;
  region?: string;
  users?: string[];
  userId?: string;
  priority?: string; // e.g. "P1", "P2", "P3"
  keywords?: string[]; // Array of strings (up to 8 keywords per project)
}

export interface ProjectWork {
  id: string;
  projectId: string;
  projectName: string;
  listingCount: number; // Listing submissions count
  blogCount: number; // Blog submissions count
  forumCount?: number; // Forum submissions count
  pdfCount: number; // PDF submissions count
  imageCount: number; // Image submissions count
  videoPptCount?: number; // Video / PPT submissions count
  profileCount?: number; // Profile submissions count
  linkCount?: number; // Link submissions count
  blog?: string; // Legacy blog section details
  pdfName?: string; // Legacy PDF File name
  pdfSize?: string; // Legacy PDF File size
  imageUri?: string; // Legacy Base64 image preview URL
  imageName?: string; // Legacy Image file name
  customValues: Record<string, any>; // id -> value, can also store selectedKeywords dynamic list
  workStatus?: 'worked' | 'not_worked' | ''; // Whether work was actually done on the selected domain
  workTypes?: string[]; // e.g. ["seo_backlink", "content_update"]
  contentUpdates?: string[]; // e.g. ["meta_title_desc", "keyword_update", "section_update", "restructure"]
  selectedKeywords?: string[]; // Array of project keyword selections
  workSummary?: string; // Work Type note / summary
  extraWorkNote?: string; // Free-text note for "Extra / New Work Done" work type
}

export interface CustomSubmissionType {
  id: string;
  name: string;
  code: string;
  placeholder?: string;
}

export interface DSREntry {
  id: string;
  date: string; // YYYY-MM-DD
  userEmail: string;
  works: ProjectWork[]; // Supports adding "new entry for new project work" dynamically
  createdAt: string;
  status?: 'Pending' | 'Approved' | 'Needs Revision';
}

export interface AppUser {
  email: string;
  name: string;
  lastLoggedIn?: string;
  paused?: boolean; // when true, Task Lineup generation skips this user
}

export interface ProjectLocation {
  projectId: string;
  north: string;
  west: string;
}

// A single project assigned to a user for a given calendar day by the
// Task Lineup auto-assignment engine.
export interface TaskAssignment {
  id: string;
  date: string; // YYYY-MM-DD
  projectId: string;
  projectName: string;
  userEmail: string;
  priority: string; // X1-X5 at the time of assignment
  status: 'Pending' | 'Done';
  createdAt: string;
}

// =========================================================================
// TASK LINEUP FREQUENCY RULES
// =========================================================================
// Every project's priority tier (X1-X5) implies how many times a week (or,
// for X5, a month) it should show up in a user's lineup. The generator uses
// this — plus a per-tier "how many of this tier per day" cap — to spread
// each user's projects out sensibly instead of dumping every eligible
// project into one day.
//
// Nothing here is a fixed "X projects every day" rule — a user with only 6
// total projects will simply get fewer lineup entries than a user with 80.
// These numbers only control (a) how often each project should recur and
// (b) the upper bound per tier / per day so no single tier crowds out the
// rest and no single day gets overloaded.

export type FrequencyPeriod = 'week' | 'month';

interface PriorityRule {
  /** How many times this tier's projects should be worked... */
  target: number;
  /** ...per this period. 'week' = Mon-Sat (Sunday is always a rest day). */
  period: FrequencyPeriod;
  /** Which daily-cap "bucket" (see PRIORITY_GROUP_DAILY_CAP) this tier's
   *  picks count against. Tiers can share a bucket — X4 and X5 share one
   *  combined cap instead of each getting its own. */
  group: string;
}

// X1: 4x/week · X2: 3x/week · X3: 2x/week · X4: 1x/week · X5: 1x/month.
export const PRIORITY_RULES: Record<string, PriorityRule> = {
  X1: { target: 4, period: 'week', group: 'X1' },
  X2: { target: 3, period: 'week', group: 'X2' },
  X3: { target: 2, period: 'week', group: 'X3' },
  X4: { target: 1, period: 'week', group: 'X4_X5' },
  X5: { target: 1, period: 'month', group: 'X4_X5' },
};

// Max number of picks from each tier that may land in ONE day's lineup,
// applied BEFORE the shared group cap below. Each tier gets exactly its
// real target as a daily ceiling (X1: 4x/week, X2: 3x/week, X3: 2x/week),
// and X4/X5 (which share one combined bucket) are weighted 3/3 so the
// monthly-cadence X5 tier still gets steady daily throughput and can
// realistically clear every project at least once a month, without
// crowding out X4's own weekly quota — see PRIORITY_GROUP_DAILY_CAP for
// how this adds up to the overall per-user daily ceiling.
export const PRIORITY_TIER_DAILY_CAP: Record<string, number> = {
  X1: 4,
  X2: 3,
  X3: 2,
  X4: 3,
  X5: 3,
};

export const PRIORITY_GROUP_DAILY_CAP: Record<string, number> = {
  X1: 4,
  X2: 3,
  X3: 2,
  X4_X5: 6,
};

export const PRIORITY_WEEKLY_TARGET: Record<string, number> = {
  X1: PRIORITY_RULES.X1.target,
  X2: PRIORITY_RULES.X2.target,
  X3: PRIORITY_RULES.X3.target,
  X4: PRIORITY_RULES.X4.target,
  X5: 0.25, // ~1x per 4-week month, expressed as a weekly-equivalent for sorting only
};

// Hard ceiling — no single user's lineup for a single day may ever exceed
// this many projects, no matter how many are "owed" work. Built directly
// from the PRIORITY_GROUP_DAILY_CAP buckets above (4+3+2+6=15) — a user
// with fewer eligible projects just gets fewer entries. NOTE: carried-over
// ("Yesterday Pending") items are always preserved even past this cap (see
// selectDailyCandidates in supabaseServer.ts) so genuinely un-submitted
// work is never silently dropped — but every *newly picked* lineup will
// respect this 15/day max.
export const DAILY_LINEUP_CAP_PER_USER = 15;
