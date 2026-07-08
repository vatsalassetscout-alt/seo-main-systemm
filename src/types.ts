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
}

export interface ProjectLocation {
  projectId: string;
  north: string;
  west: string;
}


