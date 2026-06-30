import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

// Fallback file paths identical to server.ts
const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT);
const DB_DIR = isServerless ? "/tmp" : path.join(process.cwd(), "data");

const PROJECTS_FALLBACK_FILE = path.join(DB_DIR, "projects_fallback.json");
const SUBMISSIONS_FALLBACK_FILE = path.join(DB_DIR, "submissions_fallback.json");
const ALERTS_FALLBACK_FILE = path.join(DB_DIR, "alerts_fallback.json");
const ACTIVITIES_FALLBACK_FILE = path.join(DB_DIR, "activities_fallback.json");
const RANKINGS_FALLBACK_FILE = path.join(DB_DIR, "rankings_fallback.json");

let supabaseClient: any = null;

// Initialize Supabase Client lazily to prevent startup crashes
export function getSupabase(): any {
  if (!supabaseClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_KEY;
    if (url && key && url.trim() && key.trim()) {
      try {
        supabaseClient = createClient(url, key);
        console.log("Supabase Client initialized successfully.");
      } catch (err) {
        console.error("Failed to initialize Supabase client:", err);
      }
    }
  }
  return supabaseClient;
}

// Check if Supabase connection is active and configured
export function isSupabaseConfigured(): boolean {
  return !!getSupabase();
}

// Check which tables exist in Supabase
export async function checkSupabaseTablesStatus(): Promise<{ configured: boolean; ok: boolean; error: string; missingTables: string[] }> {
  const sb = getSupabase();
  if (!sb) {
    return { configured: false, ok: false, error: "Supabase not configured in settings variables.", missingTables: [] };
  }

  const tables = ["projects", "submissions", "alerts", "activities", "rankings"];
  const missing: string[] = [];

  for (const table of tables) {
    try {
      const { error } = await sb.from(table).select("id").limit(1);
      if (error) {
        const errMsg = error.message || "";
        if (errMsg.includes("Could not find the table") || error.code === "42P01" || errMsg.includes("does not exist")) {
          missing.push(table);
        }
      }
    } catch (err: any) {
      missing.push(table);
    }
  }

  if (missing.length > 0) {
    return {
      configured: true,
      ok: false,
      error: `Missing table(s): ${missing.join(", ")}. Run the SQL schema to initialize.`,
      missingTables: missing
    };
  }

  return { configured: true, ok: true, error: "All tables connected and verified successfully!", missingTables: [] };
}

/**
 * SQL Schema script to print in logs or admin dashboard for user convenience.
 */
export const SUPABASE_SQL_SCHEMA = `
-- Supabase Table Schema for SEO Data Tracking System

-- 1. Projects Table
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT,
  domain TEXT,
  location TEXT,
  region TEXT,
  users JSONB DEFAULT '[]'::jsonb,
  user_id TEXT,
  priority TEXT,
  frequency TEXT,
  keywords JSONB DEFAULT '[]'::jsonb,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- 2. DSR Submissions Table
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  user_email TEXT NOT NULL,
  works JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- 3. Alerts / Announcements Table
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  user_email TEXT,
  project_name TEXT,
  project_domain TEXT,
  message TEXT,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
  admin_email TEXT
);

-- 4. Activities Table
CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
  user_email TEXT,
  event_type TEXT,
  details TEXT,
  platform TEXT DEFAULT 'Web App'
);

-- 5. Rankings Table
CREATE TABLE IF NOT EXISTS rankings (
  id TEXT PRIMARY KEY, -- e.g. "latest" or date
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);
`;

// Helper to safely write fallback file
function saveLocalFallback(filePath: string, data: any) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error(`Failed to write local fallback file at ${filePath}:`, err);
  }
}

// Helper to read fallback file
function readLocalFallback(filePath: string, defaultVal: any = []): any {
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
      return defaultVal;
    }
  }
  return defaultVal;
}

// =========================================================================
// PROJECTS DB INTERACTION
// =========================================================================

export async function getProjectsDb(): Promise<any[]> {
  const sb = getSupabase();
  if (sb) {
    try {
      const { data, error } = await sb
        .from("projects")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        console.warn("Supabase query error for projects, falling back to local files:", error.message);
      } else if (data) {
        // Map snake_case to camelCase structure for Frontend
        const mapped = data.map((p: any) => ({
          id: p.id,
          name: p.name,
          code: p.code,
          domain: p.domain,
          location: p.location,
          region: p.region,
          users: p.users || [],
          userId: p.user_id,
          priority: p.priority,
          frequency: p.frequency,
          keywords: p.keywords || [],
          description: p.description || ""
        }));
        // Update local fallback with current state for high availability
        saveLocalFallback(PROJECTS_FALLBACK_FILE, mapped);
        return mapped;
      }
    } catch (err) {
      console.error("Supabase exception for getProjectsDb:", err);
    }
  }
  return readLocalFallback(PROJECTS_FALLBACK_FILE, []);
}

export async function saveProjectsBulkDb(projects: any[]): Promise<boolean> {
  // Always update local fallback first
  saveLocalFallback(PROJECTS_FALLBACK_FILE, projects);

  const sb = getSupabase();
  if (sb) {
    try {
      const rows = projects.map(p => ({
        id: p.id,
        name: p.name,
        code: p.code,
        domain: p.domain,
        location: p.location,
        region: p.region,
        users: p.users || [],
        user_id: p.userId,
        priority: p.priority || "",
        frequency: p.frequency || "",
        keywords: p.keywords || [],
        description: p.description || ""
      }));

      // Perform upsert
      const { error } = await sb
        .from("projects")
        .upsert(rows, { onConflict: "id" });

      if (error) {
        console.warn("Supabase upsert bulk projects failed:", error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.error("Supabase bulk projects upsert exception:", err);
    }
  }
  return false;
}

export async function saveProjectDb(project: any): Promise<boolean> {
  // Update local file first
  const list = readLocalFallback(PROJECTS_FALLBACK_FILE, []);
  const idx = list.findIndex((p: any) => p.id === project.id);
  if (idx !== -1) {
    list[idx] = project;
  } else {
    list.push(project);
  }
  saveLocalFallback(PROJECTS_FALLBACK_FILE, list);

  const sb = getSupabase();
  if (sb) {
    try {
      const row = {
        id: project.id,
        name: project.name,
        code: project.code,
        domain: project.domain,
        location: project.location,
        region: project.region,
        users: project.users || [],
        user_id: project.userId,
        priority: project.priority || "",
        frequency: project.frequency || "",
        keywords: project.keywords || [],
        description: project.description || ""
      };

      const { error } = await sb
        .from("projects")
        .upsert(row, { onConflict: "id" });

      if (error) {
        console.warn("Supabase upsert single project failed:", error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.error("Supabase project upsert exception:", err);
    }
  }
  return false;
}

export async function deleteProjectDb(projectId: string): Promise<boolean> {
  const list = readLocalFallback(PROJECTS_FALLBACK_FILE, []);
  const filtered = list.filter((p: any) => p.id !== projectId);
  saveLocalFallback(PROJECTS_FALLBACK_FILE, filtered);

  const sb = getSupabase();
  if (sb) {
    try {
      const { error } = await sb
        .from("projects")
        .delete()
        .eq("id", projectId);

      if (error) {
        console.warn("Supabase delete project failed:", error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.error("Supabase project delete exception:", err);
    }
  }
  return false;
}

// =========================================================================
// SUBMISSIONS / DSR DB INTERACTION
// =========================================================================

export async function getSubmissionsDb(): Promise<any[]> {
  const sb = getSupabase();
  if (sb) {
    try {
      const { data, error } = await sb
        .from("submissions")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        console.warn("Supabase query error for submissions:", error.message);
      } else if (data) {
        const mapped = data.map((s: any) => ({
          id: s.id,
          date: s.date,
          userEmail: s.user_email,
          works: s.works || [],
          createdAt: s.created_at
        }));
        saveLocalFallback(SUBMISSIONS_FALLBACK_FILE, mapped);
        return mapped;
      }
    } catch (err) {
      console.error("Supabase submissions read exception:", err);
    }
  }
  return readLocalFallback(SUBMISSIONS_FALLBACK_FILE, []);
}

export async function saveSubmissionsBulkDb(submissions: any[]): Promise<boolean> {
  saveLocalFallback(SUBMISSIONS_FALLBACK_FILE, submissions);

  const sb = getSupabase();
  if (sb) {
    try {
      const rows = submissions.map(s => ({
        id: s.id,
        date: s.date,
        user_email: s.userEmail,
        works: s.works || [],
        created_at: s.createdAt
      }));

      const { error } = await sb
        .from("submissions")
        .upsert(rows, { onConflict: "id" });

      if (error) {
        console.warn("Supabase bulk submissions upsert failed:", error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.error("Supabase bulk submissions upsert exception:", err);
    }
  }
  return false;
}

export async function appendSubmissionDb(entry: any): Promise<boolean> {
  const list = readLocalFallback(SUBMISSIONS_FALLBACK_FILE, []);
  list.unshift(entry);
  saveLocalFallback(SUBMISSIONS_FALLBACK_FILE, list);

  const sb = getSupabase();
  if (sb) {
    try {
      const row = {
        id: entry.id,
        date: entry.date,
        user_email: entry.userEmail,
        works: entry.works || [],
        created_at: entry.createdAt
      };

      const { error } = await sb
        .from("submissions")
        .insert(row);

      if (error) {
        console.warn("Supabase append submission failed:", error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.error("Supabase append submission exception:", err);
    }
  }
  return false;
}

export async function clearSubmissionsDb(): Promise<boolean> {
  saveLocalFallback(SUBMISSIONS_FALLBACK_FILE, []);

  const sb = getSupabase();
  if (sb) {
    try {
      const { error } = await sb
        .from("submissions")
        .delete()
        .neq("id", "force_delete_all_placeholder_non_existent"); // clears everything

      if (error) {
        console.warn("Supabase clear submissions failed:", error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.error("Supabase clear submissions exception:", err);
    }
  }
  return false;
}

// =========================================================================
// ALERTS DB INTERACTION
// =========================================================================

export async function getAlertsDb(): Promise<any[]> {
  const sb = getSupabase();
  if (sb) {
    try {
      const { data, error } = await sb
        .from("alerts")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        console.warn("Supabase alerts get failed:", error.message);
      } else if (data) {
        const mapped = data.map((a: any) => ({
          id: a.id,
          userEmail: a.user_email,
          projectName: a.project_name,
          projectDomain: a.project_domain,
          message: a.message,
          read: a.read,
          createdAt: a.created_at,
          adminEmail: a.admin_email
        }));
        saveLocalFallback(ALERTS_FALLBACK_FILE, mapped);
        return mapped;
      }
    } catch (err) {
      console.error("Supabase alerts fetch exception:", err);
    }
  }
  return readLocalFallback(ALERTS_FALLBACK_FILE, []);
}

export async function saveAlertDb(alert: any): Promise<boolean> {
  const list = readLocalFallback(ALERTS_FALLBACK_FILE, []);
  list.unshift(alert);
  saveLocalFallback(ALERTS_FALLBACK_FILE, list);

  const sb = getSupabase();
  if (sb) {
    try {
      const row = {
        id: alert.id,
        user_email: alert.userEmail,
        project_name: alert.projectName,
        project_domain: alert.projectDomain,
        message: alert.message,
        read: alert.read || false,
        created_at: alert.createdAt || new Date().toISOString(),
        admin_email: alert.adminEmail
      };

      const { error } = await sb
        .from("alerts")
        .insert(row);

      if (error) {
        console.warn("Supabase insert alert failed:", error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.error("Supabase insert alert exception:", err);
    }
  }
  return false;
}

export async function saveAlertsBulkDb(alerts: any[]): Promise<boolean> {
  saveLocalFallback(ALERTS_FALLBACK_FILE, alerts);

  const sb = getSupabase();
  if (sb) {
    try {
      const rows = alerts.map(alert => ({
        id: alert.id,
        user_email: alert.userEmail,
        project_name: alert.projectName,
        project_domain: alert.projectDomain,
        message: alert.message,
        read: alert.read || false,
        created_at: alert.createdAt || new Date().toISOString(),
        admin_email: alert.adminEmail
      }));

      const { error } = await sb
        .from("alerts")
        .upsert(rows, { onConflict: "id" });

      if (error) {
        console.warn("Supabase bulk alerts upsert failed:", error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.error("Supabase bulk alerts upsert exception:", err);
    }
  }
  return false;
}

export async function deleteAlertDb(alertId: string): Promise<boolean> {
  const list = readLocalFallback(ALERTS_FALLBACK_FILE, []);
  const filtered = list.filter((a: any) => a.id !== alertId);
  saveLocalFallback(ALERTS_FALLBACK_FILE, filtered);

  const sb = getSupabase();
  if (sb) {
    try {
      const { error } = await sb
        .from("alerts")
        .delete()
        .eq("id", alertId);

      if (error) {
        console.warn("Supabase delete alert failed:", error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.error("Supabase delete alert exception:", err);
    }
  }
  return false;
}

// =========================================================================
// ACTIVITIES DB INTERACTION
// =========================================================================

export async function getActivitiesDb(): Promise<any[]> {
  const sb = getSupabase();
  if (sb) {
    try {
      const { data, error } = await sb
        .from("activities")
        .select("*")
        .order("timestamp", { ascending: false })
        .limit(1000);

      if (error) {
        console.warn("Supabase get activities failed:", error.message);
      } else if (data) {
        const mapped = data.map((a: any) => ({
          id: a.id,
          timestamp: a.timestamp,
          userEmail: a.user_email,
          eventType: a.event_type,
          details: a.details,
          platform: a.platform
        }));
        saveLocalFallback(ACTIVITIES_FALLBACK_FILE, mapped);
        return mapped;
      }
    } catch (err) {
      console.error("Supabase activities fetch exception:", err);
    }
  }
  return readLocalFallback(ACTIVITIES_FALLBACK_FILE, []);
}

export async function logActivityDb(activity: any): Promise<boolean> {
  const list = readLocalFallback(ACTIVITIES_FALLBACK_FILE, []);
  list.unshift(activity);
  if (list.length > 1000) {
    list.splice(1000);
  }
  saveLocalFallback(ACTIVITIES_FALLBACK_FILE, list);

  const sb = getSupabase();
  if (sb) {
    try {
      const row = {
        id: activity.id,
        timestamp: activity.timestamp,
        user_email: activity.userEmail,
        event_type: activity.eventType,
        details: activity.details,
        platform: activity.platform || "Web App"
      };

      const { error } = await sb
        .from("activities")
        .insert(row);

      if (error) {
        console.warn("Supabase insert activity failed:", error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.error("Supabase insert activity exception:", err);
    }
  }
  return false;
}

export async function clearActivitiesDb(): Promise<boolean> {
  saveLocalFallback(ACTIVITIES_FALLBACK_FILE, []);

  const sb = getSupabase();
  if (sb) {
    try {
      const { error } = await sb
        .from("activities")
        .delete()
        .neq("id", "force_clear_non_existent");

      if (error) {
        console.warn("Supabase clear activities failed:", error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.error("Supabase clear activities exception:", err);
    }
  }
  return false;
}

// =========================================================================
// RANKINGS DB INTERACTION
// =========================================================================

export async function getRankingsDb(): Promise<any> {
  const sb = getSupabase();
  if (sb) {
    try {
      const { data, error } = await sb
        .from("rankings")
        .select("*")
        .eq("id", "latest")
        .single();

      if (error) {
        if (error.code !== "PGRST116") { // single query no record is okay
          console.warn("Supabase get rankings failed:", error.message);
        }
      } else if (data) {
        saveLocalFallback(RANKINGS_FALLBACK_FILE, data.data || {});
        return data.data || {};
      }
    } catch (err) {
      console.error("Supabase rankings fetch exception:", err);
    }
  }
  return readLocalFallback(RANKINGS_FALLBACK_FILE, {});
}

export async function saveRankingsDb(rankingsData: any): Promise<boolean> {
  saveLocalFallback(RANKINGS_FALLBACK_FILE, rankingsData);

  const sb = getSupabase();
  if (sb) {
    try {
      const row = {
        id: "latest",
        data: rankingsData,
        created_at: new Date().toISOString()
      };

      const { error } = await sb
        .from("rankings")
        .upsert(row, { onConflict: "id" });

      if (error) {
        console.warn("Supabase upsert rankings failed:", error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.error("Supabase upsert rankings exception:", err);
    }
  }
  return false;
}

export async function clearRankingsDb(): Promise<boolean> {
  saveLocalFallback(RANKINGS_FALLBACK_FILE, {});

  const sb = getSupabase();
  if (sb) {
    try {
      const { error } = await sb
        .from("rankings")
        .delete()
        .eq("id", "latest");

      if (error) {
        console.warn("Supabase clear rankings failed:", error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.error("Supabase clear rankings exception:", err);
    }
  }
  return false;
}
