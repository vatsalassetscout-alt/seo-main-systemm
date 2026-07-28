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

// Weekly work-frequency target implied by each priority tier. X1 is worked
// every day the lineup runs (no-Sunday rule), tapering down to X5 which is
// only picked once a week. Assumption — adjust here if the real cadence differs.
export const PRIORITY_WEEKLY_TARGET: Record<string, number> = {
  X1: 6,
  X2: 4,
  X3: 3,
  X4: 2,
  X5: 1,
};

export const DAILY_LINEUP_CAP_PER_USER = 25;



