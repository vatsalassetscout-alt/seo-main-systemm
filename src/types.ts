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
  /** Max number of this tier's projects that may land in ONE day's lineup
   *  for a single user, even if more are technically "owed" work. */
  dailyCap: number;
}

// X1: 4x/week · X2: 3x/week · X3: 2x/week · X4: 1x/week · X5: 1x/month.
// Daily caps sum to 25 (5+6+6+5+3) so the per-tier caps alone are enough to
// keep any single user's day within the hard DAILY_LINEUP_CAP_PER_USER
// limit below, while still leaving room for every tier to appear.
export const PRIORITY_RULES: Record<string, PriorityRule> = {
  X1: { target: 4, period: 'week', dailyCap: 5 },
  X2: { target: 3, period: 'week', dailyCap: 6 },
  X3: { target: 2, period: 'week', dailyCap: 6 },
  X4: { target: 1, period: 'week', dailyCap: 5 },
  X5: { target: 1, period: 'month', dailyCap: 3 },
};

// Kept for anything that only needs "how many times per week" as a single
// number (used for tie-break sorting — higher tiers sort first). For X5
// (a monthly cadence) this is an approximate weekly-equivalent weight, not
// a real target — always read PRIORITY_RULES for the actual scheduling
// target/period/cap.
export const PRIORITY_WEEKLY_TARGET: Record<string, number> = {
  X1: PRIORITY_RULES.X1.target,
  X2: PRIORITY_RULES.X2.target,
  X3: PRIORITY_RULES.X3.target,
  X4: PRIORITY_RULES.X4.target,
  X5: 0.25, // ~1x per 4-week month, expressed as a weekly-equivalent for sorting only
};

// Hard ceiling — no single user's lineup for a single day may ever exceed
// this many projects, no matter how many are "owed" work. Combined with the
// per-tier dailyCap values above, real-world days should land comfortably
// in the 20-25 range rather than always hitting a fixed number.
export const DAILY_LINEUP_CAP_PER_USER = 25;
