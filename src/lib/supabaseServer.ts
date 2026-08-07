import { createClient } from "@supabase/supabase-js";
import { PRIORITY_WEEKLY_TARGET, PRIORITY_RULES, PRIORITY_TIER_DAILY_CAP, PRIORITY_GROUP_DAILY_CAP, DAILY_LINEUP_CAP_PER_USER } from "../types";

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

  const tables = ["projects", "submissions", "alerts", "activities", "rankings", "manual_rankings", "task_assignments", "lineup_engine"];
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
  admin_email TEXT,
  alert_type TEXT,
  project_id TEXT,
  date TEXT
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

-- 6. Manual Rankings Table (user-filled "Update Ranking" grid)
CREATE TABLE IF NOT EXISTS manual_rankings (
  id TEXT PRIMARY KEY, -- always "latest"
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- 7. Dedicated Users table (source of truth for the admin Users dropdown,
--    and now also for the Task Lineup per-user pause switch)
CREATE TABLE IF NOT EXISTS app_users (
  user_id TEXT PRIMARY KEY,
  name TEXT,
  paused BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS paused BOOLEAN DEFAULT false;

-- 8. Task Lineup Assignments Table
-- One row per (date, user, project) that the auto-assignment engine picked
-- for that user to work on that day. status flips to 'Done' the moment a
-- matching Work Log submission comes in for that project/user/date.
CREATE TABLE IF NOT EXISTS task_assignments (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  project_id TEXT NOT NULL,
  project_name TEXT,
  user_email TEXT NOT NULL,
  priority TEXT,
  status TEXT DEFAULT 'Pending',
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_task_assignments_date ON task_assignments (date);
CREATE INDEX IF NOT EXISTS idx_task_assignments_user ON task_assignments (user_email);

-- 9. Task Lineup Engine State (single row) — lets the auto-assignment cycle
-- run forever once started, instead of needing a manual click every day.
-- "active" flips on the first time an admin hits Start Cycle and stays on
-- permanently; "paused" is the separate long-vacation switch admins can
-- flip any time without losing the "active" (ever-started) state.
CREATE TABLE IF NOT EXISTS lineup_engine (
  id TEXT PRIMARY KEY, -- always "singleton"
  active BOOLEAN DEFAULT false,
  paused BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- Row Level Security (RLS) Setup
-- Disable RLS to allow direct database sync from the web client safely:
ALTER TABLE projects DISABLE ROW LEVEL SECURITY;
ALTER TABLE submissions DISABLE ROW LEVEL SECURITY;
ALTER TABLE alerts DISABLE ROW LEVEL SECURITY;
ALTER TABLE activities DISABLE ROW LEVEL SECURITY;
ALTER TABLE rankings DISABLE ROW LEVEL SECURITY;
ALTER TABLE manual_rankings DISABLE ROW LEVEL SECURITY;
ALTER TABLE app_users DISABLE ROW LEVEL SECURITY;
ALTER TABLE task_assignments DISABLE ROW LEVEL SECURITY;
ALTER TABLE lineup_engine DISABLE ROW LEVEL SECURITY;

-- If you prefer keeping RLS enabled on your database, run the following commands to allow full public access instead:
-- CREATE POLICY "Allow public read-write for projects" ON projects FOR ALL USING (true) WITH CHECK (true);
-- CREATE POLICY "Allow public read-write for submissions" ON submissions FOR ALL USING (true) WITH CHECK (true);
-- CREATE POLICY "Allow public read-write for alerts" ON alerts FOR ALL USING (true) WITH CHECK (true);
-- CREATE POLICY "Allow public read-write for activities" ON activities FOR ALL USING (true) WITH CHECK (true);
-- CREATE POLICY "Allow public read-write for rankings" ON rankings FOR ALL USING (true) WITH CHECK (true);
`;

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
        console.warn("Supabase query error for projects:", error.message);
      } else if (data) {
        // Map snake_case to camelCase structure for Frontend
        return data.map((p: any) => ({
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
      }
    } catch (err) {
      console.error("Supabase exception for getProjectsDb:", err);
    }
  }
  return [];
}

export async function saveProjectsBulkDb(projects: any[]): Promise<boolean> {
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

// ---- Dedicated Users table (clean source of truth for the admin Users dropdown) ----
// This is intentionally separate from projects.users / projects.user_id /
// submissions.user_email, which are NOT used to build the dropdown anymore.

export async function getUsersDb(): Promise<{ email: string; name: string }[]> {
  const sb = getSupabase();
  if (sb) {
    try {
      const { data, error } = await sb
        .from("app_users")
        .select("*")
        .order("name", { ascending: true });

      if (error) {
        console.warn("Supabase query error for app_users:", error.message);
      } else if (data) {
        return data.map((u: any) => ({ email: u.user_id, name: u.name, paused: !!u.paused }));
      }
    } catch (err) {
      console.error("Supabase exception for getUsersDb:", err);
    }
  }
  return [];
}

export async function setUserPausedDb(userId: string, paused: boolean): Promise<boolean> {
  const sb = getSupabase();
  if (sb) {
    try {
      // .eq() is case-sensitive. userId here is already lowercased by the
      // caller, but saveUserDb historically stored whatever case an admin
      // typed — so a row saved as "Name@Gmail.com" would never match this
      // lowercase .eq(), the update would affect 0 rows, Supabase would
      // return no error either way, and this function would report success
      // even though nothing was actually written. Using ilike() makes the
      // match case-insensitive so existing rows aren't silently skipped,
      // and .select() lets us see how many rows were actually touched so we
      // can tell a real failure apart from a false "success".
      const { data, error } = await sb
        .from("app_users")
        .update({ paused })
        .ilike("user_id", userId)
        .select("user_id");

      if (error) {
        console.warn("Supabase set user paused failed:", error.message);
        return false;
      }
      if (!data || data.length === 0) {
        console.warn(`Supabase set user paused matched no rows for user_id="${userId}" — user record may be missing.`);
        return false;
      }
      return true;
    } catch (err) {
      console.error("Supabase set user paused exception:", err);
    }
  }
  return false;
}

export async function saveUserDb(userId: string, name: string): Promise<boolean> {
  const sb = getSupabase();
  if (sb) {
    try {
      // Normalize to lowercase on write so every future lookup (pause
      // toggle, assignment matching, etc.) can rely on a consistent case
      // instead of needing case-insensitive matches everywhere.
      const normalizedUserId = String(userId).trim().toLowerCase();
      const { error } = await sb
        .from("app_users")
        .upsert({ user_id: normalizedUserId, name }, { onConflict: "user_id" });

      if (error) {
        console.warn("Supabase upsert app_user failed:", error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.error("Supabase app_user upsert exception:", err);
    }
  }
  return false;
}

export async function deleteUserDb(userId: string): Promise<boolean> {
  const sb = getSupabase();
  if (sb) {
    try {
      const { error } = await sb
        .from("app_users")
        .delete()
        .eq("user_id", userId);

      if (error) {
        console.warn("Supabase delete app_user failed:", error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.error("Supabase app_user delete exception:", err);
    }
  }
  return false;
}

export async function deleteProjectDb(projectId: string): Promise<boolean> {
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
        return data.map((s: any) => ({
          id: s.id,
          date: s.date,
          userEmail: s.user_email,
          works: s.works || [],
          createdAt: s.created_at,
          status: s.status || 'Pending'
        }));
      }
    } catch (err) {
      console.error("Supabase submissions read exception:", err);
    }
  }
  return [];
}

export async function saveSubmissionsBulkDb(submissions: any[]): Promise<boolean> {
  const sb = getSupabase();
  if (sb) {
    try {
      const rows = submissions.map(s => ({
        id: s.id,
        date: s.date,
        user_email: s.userEmail,
        works: s.works || [],
        created_at: s.createdAt,
        status: s.status || 'Pending'
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
  const sb = getSupabase();
  if (sb) {
    try {
      const row = {
        id: entry.id,
        date: entry.date,
        user_email: entry.userEmail,
        works: entry.works || [],
        created_at: entry.createdAt,
        status: entry.status || 'Pending'
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

export async function updateSubmissionStatusDb(submissionId: string, status: string): Promise<boolean> {
  const sb = getSupabase();
  if (sb) {
    try {
      const { error } = await sb
        .from("submissions")
        .update({ status })
        .eq("id", submissionId);

      if (error) {
        console.warn("Supabase update submission status failed:", error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.error("Supabase update submission status exception:", err);
    }
  }
  return false;
}

export async function deleteSubmissionDb(submissionId: string): Promise<boolean> {
  const sb = getSupabase();
  if (sb) {
    try {
      const { error } = await sb
        .from("submissions")
        .delete()
        .eq("id", submissionId);

      if (error) {
        console.warn("Supabase delete submission failed:", error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.error("Supabase submission delete exception:", err);
    }
  }
  return false;
}

export async function clearSubmissionsDb(): Promise<boolean> {
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
        return data.map((a: any) => ({
          id: a.id,
          userEmail: a.user_email,
          projectName: a.project_name,
          projectDomain: a.project_domain,
          message: a.message,
          read: a.read,
          createdAt: a.created_at,
          adminEmail: a.admin_email,
          alertType: a.alert_type || "",
          projectId: a.project_id || "",
          date: a.date || ""
        }));
      }
    } catch (err) {
      console.error("Supabase alerts fetch exception:", err);
    }
  }
  return [];
}

export async function saveAlertDb(alert: any): Promise<boolean> {
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
        admin_email: alert.adminEmail,
        alert_type: alert.alertType || "",
        project_id: alert.projectId || "",
        date: alert.date || ""
      };

      const { error } = await sb
        .from("alerts")
        .insert(row);

      if (error) {
        const missingSchema = error.message && (error.message.includes("does not exist") || error.message.includes("schema cache") || error.message.includes("Could not find") || error.message.includes("alert_type") || error.code === "42703");
        if (missingSchema) {
          // Do NOT silently drop alert_type/project_id/date — that field loss is what makes
          // assignment banners "disappear" after a background sync. Fail loudly instead so the
          // real fix (adding the missing columns) actually gets applied.
          console.error(
            "Supabase 'alerts' table is missing required columns (alert_type, project_id, date). " +
            "Run this in your Supabase SQL editor:\n" +
            "ALTER TABLE alerts ADD COLUMN IF NOT EXISTS alert_type TEXT;\n" +
            "ALTER TABLE alerts ADD COLUMN IF NOT EXISTS project_id TEXT;\n" +
            "ALTER TABLE alerts ADD COLUMN IF NOT EXISTS date TEXT;\n" +
            "Original error: " + error.message
          );
          return false;
        }
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
        admin_email: alert.adminEmail,
        alert_type: alert.alertType || "",
        project_id: alert.projectId || "",
        date: alert.date || ""
      }));

      const { error } = await sb
        .from("alerts")
        .upsert(rows, { onConflict: "id" });

      if (error) {
        const missingSchema = error.message && (error.message.includes("does not exist") || error.message.includes("schema cache") || error.message.includes("Could not find") || error.message.includes("alert_type") || error.code === "42703");
        if (missingSchema) {
          console.error(
            "Supabase 'alerts' table is missing required columns (alert_type, project_id, date). " +
            "Run this in your Supabase SQL editor:\n" +
            "ALTER TABLE alerts ADD COLUMN IF NOT EXISTS alert_type TEXT;\n" +
            "ALTER TABLE alerts ADD COLUMN IF NOT EXISTS project_id TEXT;\n" +
            "ALTER TABLE alerts ADD COLUMN IF NOT EXISTS date TEXT;\n" +
            "Original error: " + error.message
          );
          return false;
        }
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
        return data.map((a: any) => ({
          id: a.id,
          timestamp: a.timestamp,
          userEmail: a.user_email,
          eventType: a.event_type,
          details: a.details,
          platform: a.platform
        }));
      }
    } catch (err) {
      console.error("Supabase activities fetch exception:", err);
    }
  }
  return [];
}

export async function logActivityDb(activity: any): Promise<boolean> {
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
        return data.data || {};
      }
    } catch (err) {
      console.error("Supabase rankings fetch exception:", err);
    }
  }
  return {};
}

export async function saveRankingsDb(rankingsData: any): Promise<boolean> {
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

// =========================================================================
// MANUAL RANKINGS ("Update Ranking" grid) DB INTERACTION
// =========================================================================

export async function getManualRankingsDb(): Promise<any> {
  const sb = getSupabase();
  if (sb) {
    try {
      const { data, error } = await sb
        .from("manual_rankings")
        .select("*")
        .eq("id", "latest")
        .single();

      if (error) {
        if (error.code !== "PGRST116") { // single query no record is okay
          console.warn("Supabase get manual_rankings failed:", error.message);
        }
      } else if (data) {
        return data.data || {};
      }
    } catch (err) {
      console.error("Supabase manual_rankings fetch exception:", err);
    }
  }
  return {};
}

// =========================================================================
// TASK LINEUP (auto-assignment) DB INTERACTION
// =========================================================================
//
// Priority tiers X1-X5 each imply a work-frequency target — X1-X4 are
// weekly (see PRIORITY_RULES in types.ts), X5 is monthly. Every day the
// engine runs (Mon-Sat, Sunday is always skipped) it works out, per user,
// which of their projects are still "owed" work for their tier's period,
// and picks candidates bucket-by-bucket (X1, X2, X3 each have their own
// daily cap; X4 and X5 share one combined cap — see
// PRIORITY_GROUP_DAILY_CAP) up to an overall 15-projects/day ceiling per
// user - carrying forward anything left "Pending" from yesterday first,
// and always honoring carried-over items even if that means slightly
// exceeding a bucket's normal daily cap, so nothing silently falls off
// the list.

function toRow(a: any) {
  return {
    id: a.id,
    date: a.date,
    project_id: a.projectId,
    project_name: a.projectName,
    user_email: a.userEmail,
    priority: a.priority || "",
    status: a.status || "Pending",
    created_at: a.createdAt || new Date().toISOString(),
  };
}

function fromRow(r: any) {
  return {
    id: r.id,
    date: r.date,
    projectId: r.project_id,
    projectName: r.project_name,
    userEmail: r.user_email,
    priority: r.priority || "",
    status: r.status || "Pending",
    createdAt: r.created_at,
  };
}

function dedupeAssignments(rows: any[]): any[] {
  const byKey = new Map<string, any>();
  rows.forEach((r) => {
    const key = `${r.date}::${String(r.userEmail || "").trim().toLowerCase()}::${r.projectId}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, r);
      return;
    }
    const prevDone = prev.status === "Done";
    const curDone = r.status === "Done";
    if (curDone && !prevDone) {
      byKey.set(key, r);
    } else if (curDone === prevDone) {
      const prevTime = new Date(prev.createdAt || 0).getTime();
      const curTime = new Date(r.createdAt || 0).getTime();
      if (curTime >= prevTime) byKey.set(key, r);
    }
  });
  return Array.from(byKey.values());
}

export async function getTaskAssignmentsDb(filters: {
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  userEmail?: string;
  status?: string;
} = {}): Promise<any[]> {
  const sb = getSupabase();
  if (!sb) return [];
  try {
    let query = sb.from("task_assignments").select("*");
    if (filters.date) query = query.eq("date", filters.date);
    if (filters.dateFrom) query = query.gte("date", filters.dateFrom);
    if (filters.dateTo) query = query.lte("date", filters.dateTo);
    if (filters.userEmail) query = query.eq("user_email", filters.userEmail.trim().toLowerCase());
    if (filters.status) query = query.eq("status", filters.status);

    const { data, error } = await query.order("date", { ascending: false });
    if (error) {
      console.warn("Supabase query error for task_assignments:", error.message);
      return [];
    }
    return dedupeAssignments((data || []).map(fromRow));
  } catch (err) {
    console.error("Supabase exception for getTaskAssignmentsDb:", err);
    return [];
  }
}

export async function insertTaskAssignmentsBulkDb(assignments: any[]): Promise<boolean> {
  const sb = getSupabase();
  if (!sb || assignments.length === 0) return false;
  try {
    const rows = assignments.map(toRow);
    const { error } = await sb.from("task_assignments").upsert(rows, { onConflict: "id" });
    if (error) {
      console.warn("Supabase bulk insert task_assignments failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Supabase bulk insert task_assignments exception:", err);
    return false;
  }
}

export async function deleteTaskAssignmentsForDateDb(date: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    const { error } = await sb.from("task_assignments").delete().eq("date", date);
    if (error) {
      console.warn("Supabase delete task_assignments for date failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Supabase delete task_assignments exception:", err);
    return false;
  }
}

// Full reset — wipes EVERY task assignment ever created, for every user and
// every date (not just one day). Used by the "Delete" button's full-reset
// mode so that Yesterday Pending / Total Pending go back to 0 everywhere,
// instead of only clearing the single date that was showing on screen.
export async function deleteAllTaskAssignmentsDb(): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    // Supabase requires a filter on delete; neq on a value nothing can equal
    // (empty string id never happens) safely matches every row.
    const { error } = await sb.from("task_assignments").delete().neq("id", "");
    if (error) {
      console.warn("Supabase delete ALL task_assignments failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Supabase delete ALL task_assignments exception:", err);
    return false;
  }
}

export async function markTaskAssignmentDoneDb(date: string, userEmail: string, projectId: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    const { error } = await sb
      .from("task_assignments")
      .update({ status: "Done" })
      .eq("date", date)
      .eq("user_email", userEmail.trim().toLowerCase())
      .eq("project_id", projectId)
      .eq("status", "Pending");
    if (error) {
      console.warn("Supabase mark task_assignment done failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Supabase mark task_assignment done exception:", err);
    return false;
  }
}
// Reverse of markTaskAssignmentDoneDb — when the Work Log entry that flipped
// an assignment to "Done" gets deleted, the assignment goes back to
// "Pending" so Task Lineup / History reflect that the work is, once again,
// not actually logged.
export async function markTaskAssignmentPendingDb(date: string, userEmail: string, projectId: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    const { error } = await sb
      .from("task_assignments")
      .update({ status: "Pending" })
      .eq("date", date)
      .eq("user_email", userEmail.trim().toLowerCase())
      .eq("project_id", projectId);
    if (error) {
      console.warn("Supabase mark task_assignment pending failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Supabase mark task_assignment pending exception:", err);
    return false;
  }
}


function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return ymd(d);
}

// Monday of the week containing dateStr (weeks run Mon-Sat; Sunday is a rest day).
function weekStartMonday(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  return addDays(dateStr, diffToMonday);
}

// First day of the calendar month containing dateStr — used for X5's
// once-a-month cadence.
function monthStartOf(dateStr: string): string {
  return `${dateStr.slice(0, 7)}-01`;
}

// Given a full list of candidates for ONE user (already deficit-filtered,
// each tagged with `priority` and `carried`), applies caps in two passes:
//   1. Per-TIER cap (PRIORITY_TIER_DAILY_CAP) — e.g. X5 can't take more
//      than 3 slots even inside the combined X4/X5 bucket.
//   2. Per-GROUP cap (PRIORITY_GROUP_DAILY_CAP) — e.g. X4 and X5 combined
//      still can't exceed 5, no matter how the 3-and-3 splits.
// Finally trims the combined result down to the overall
// DAILY_LINEUP_CAP_PER_USER ceiling. Carried-over ("Yesterday Pending")
// items are always kept even if a tier's or bucket's normal cap would
// otherwise exclude them - the caps only limit how many *new* picks can be
// added on top.
function selectDailyCandidates<
  C extends { priority: string; carried: boolean; deficit: number }
>(candidates: C[]): C[] {
  const perUserDeficitSort = (a: C, b: C) => {
    if (a.carried !== b.carried) return a.carried ? -1 : 1; // carried-over pending first
    const weightDiff = (PRIORITY_WEEKLY_TARGET[b.priority] || 0) - (PRIORITY_WEEKLY_TARGET[a.priority] || 0);
    if (weightDiff !== 0) return weightDiff; // within a shared bucket (X4/X5), higher tier first
    return b.deficit - a.deficit; // bigger deficit first
  };

  // Pass 1: per-tier cap.
  const byTier = new Map<string, C[]>();
  candidates.forEach((c) => {
    if (!byTier.has(c.priority)) byTier.set(c.priority, []);
    byTier.get(c.priority)!.push(c);
  });

  const tierLimited: C[] = [];
  byTier.forEach((tierCandidates, tier) => {
    const tierCap = PRIORITY_TIER_DAILY_CAP[tier] ?? DAILY_LINEUP_CAP_PER_USER;
    tierCandidates.sort(perUserDeficitSort);
    const carriedItems = tierCandidates.filter((c) => c.carried);
    const nonCarriedItems = tierCandidates.filter((c) => !c.carried);
    const remainingSlots = Math.max(0, tierCap - carriedItems.length);
    tierLimited.push(...carriedItems, ...nonCarriedItems.slice(0, remainingSlots));
  });

  // Pass 2: per-group cap, applied on top of the already tier-limited list.
  const byGroup = new Map<string, C[]>();
  tierLimited.forEach((c) => {
    const rule = PRIORITY_RULES[c.priority];
    const group = rule ? rule.group : c.priority;
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group)!.push(c);
  });

  let selected: C[] = [];
  byGroup.forEach((groupCandidates, group) => {
    const groupCap = PRIORITY_GROUP_DAILY_CAP[group] ?? DAILY_LINEUP_CAP_PER_USER;
    groupCandidates.sort(perUserDeficitSort);
    const carriedItems = groupCandidates.filter((c) => c.carried);
    const nonCarriedItems = groupCandidates.filter((c) => !c.carried);
    const remainingSlots = Math.max(0, groupCap - carriedItems.length);
    selected = selected.concat(carriedItems, nonCarriedItems.slice(0, remainingSlots));
  });

  // Final overall cap — sort by tier weight (higher tier first) and
  // deficit, carried items always pinned to the front, then slice.
  selected.sort(perUserDeficitSort);

  if (selected.length <= DAILY_LINEUP_CAP_PER_USER) return selected;

  // Trim only from the non-carried tail so carried-over items are never
  // dropped, even if that means the final list is a little over the cap
  // in the rare case where carried items alone exceed it.
  const carriedAll = selected.filter((c) => c.carried);
  const nonCarriedAll = selected.filter((c) => !c.carried);
  const room = Math.max(0, DAILY_LINEUP_CAP_PER_USER - carriedAll.length);
  return carriedAll.concat(nonCarriedAll.slice(0, room));
}

/**
 * Generates (or regenerates, if force=true) the Task Lineup for a single
 * calendar date. Returns a summary the API route can pass straight back to
 * the client.
 */
export async function generateLineupForDate(
  dateStr: string,
  projects: any[],
  users: { email: string; name: string; paused?: boolean }[],
  force: boolean = false
): Promise<{ generated: boolean; reason?: string; count: number; date: string }> {
  const dow = new Date(dateStr + "T00:00:00Z").getUTCDay();
  if (dow === 0) {
    return { generated: false, reason: "Sundays are a rest day - no lineup is generated.", count: 0, date: dateStr };
  }

  const existing = await getTaskAssignmentsDb({ date: dateStr });
  if (existing.length > 0 && !force) {
    return { generated: false, reason: "A lineup already exists for this date.", count: existing.length, date: dateStr };
  }
  if (existing.length > 0 && force) {
    await deleteTaskAssignmentsForDateDb(dateStr);
  }

  // Two app_users rows can end up sharing the same display name (a known
  // duplicate-account issue — see Admin Settings > Users). Without this,
  // the generator treats them as two different people and assigns the same
  // project to both, which is exactly what shows up as "the same person
  // twice" in the Task Lineup. Collapse every email that shares a name onto
  // one canonical email (the first one encountered for that name) so a real
  // person's work is only ever assigned once, no matter how many logins
  // they have on file.
  const canonicalEmailByRawEmail = new Map<string, string>();
  const canonicalEmailByName = new Map<string, string>();
  const pausedEmails = new Set<string>();
  users.forEach((u) => {
    const email = String(u.email || "").trim().toLowerCase();
    if (!email) return;
    if (u.paused) pausedEmails.add(email);
    const nameKey = String(u.name || "").trim().toLowerCase();
    if (nameKey) {
      if (!canonicalEmailByName.has(nameKey)) canonicalEmailByName.set(nameKey, email);
      canonicalEmailByRawEmail.set(email, canonicalEmailByName.get(nameKey)!);
    } else {
      canonicalEmailByRawEmail.set(email, email);
    }
  });
  const canonicalOf = (rawEmail: string): string => {
    const email = rawEmail.trim().toLowerCase();
    return canonicalEmailByRawEmail.get(email) || email;
  };
  // A person counts as paused if any of their duplicate accounts is paused.
  const rawPausedByCanonical = new Set<string>();
  pausedEmails.forEach((e) => rawPausedByCanonical.add(canonicalOf(e)));

  const weekStart = weekStartMonday(dateStr);
  const monthStart = monthStartOf(dateStr);
  const yesterday = addDays(dateStr, -1);

  // One query wide enough to cover both the weekly window (X1-X4) and the
  // monthly window (X5) — whichever starts earlier — then filtered twice
  // below rather than hitting the DB twice.
  const rangeStart = weekStart < monthStart ? weekStart : monthStart;
  const periodSoFar = await getTaskAssignmentsDb({ dateFrom: rangeStart, dateTo: yesterday });

  const countThisWeek = new Map<string, number>(); // `${userEmail}::${projectId}` -> count, Mon..yesterday
  const countThisMonth = new Map<string, number>(); // `${userEmail}::${projectId}` -> count, 1st..yesterday
  periodSoFar.forEach((a) => {
    const key = `${canonicalOf(a.userEmail)}::${a.projectId}`;
    if (a.date >= weekStart) countThisWeek.set(key, (countThisWeek.get(key) || 0) + 1);
    if (a.date >= monthStart) countThisMonth.set(key, (countThisMonth.get(key) || 0) + 1);
  });

  // Yesterday's assignments that never got a matching Work Log ("Yesterday
  // Pending") jump to the front of today's queue so nothing gets silently dropped.
  const yesterdayPending = new Set<string>();
  periodSoFar
    .filter((a) => a.date === yesterday && a.status === "Pending")
    .forEach((a) => yesterdayPending.add(`${canonicalOf(a.userEmail)}::${a.projectId}`));

  type Candidate = {
    userEmail: string;
    projectId: string;
    projectName: string;
    priority: string;
    carried: boolean;
    deficit: number;
  };

  const candidatesByUser = new Map<string, Candidate[]>();

  projects.forEach((p) => {
    const priority = String(p.priority || "").toUpperCase();
    const rule = PRIORITY_RULES[priority];
    if (!rule) return; // no recognized priority tier - admin hasn't set one, skip from auto-assignment

    const rawUsers: string[] = Array.isArray(p.users) ? p.users : [];
    const emails = new Set<string>();
    rawUsers.forEach((u: string) => {
      if (u && String(u).trim()) emails.add(canonicalOf(String(u).trim()));
    });
    if (p.userId && String(p.userId).trim()) emails.add(canonicalOf(String(p.userId).trim()));

    emails.forEach((userEmail) => {
      if (rawPausedByCanonical.has(userEmail)) return; // paused users are skipped entirely for new generation
      const key = `${userEmail}::${p.id}`;
      const doneThisPeriod =
        rule.period === "month" ? countThisMonth.get(key) || 0 : countThisWeek.get(key) || 0;
      const deficit = rule.target - doneThisPeriod;
      const carried = yesterdayPending.has(key);
      if (deficit <= 0 && !carried) return; // this project's quota for its period is already met

      if (!candidatesByUser.has(userEmail)) candidatesByUser.set(userEmail, []);
      candidatesByUser.get(userEmail)!.push({
        userEmail,
        projectId: p.id,
        projectName: p.name,
        priority,
        carried,
        deficit,
      });
    });
  });

  const toInsert: any[] = [];
  candidatesByUser.forEach((candidates) => {
    selectDailyCandidates(candidates).forEach((c) => {
      toInsert.push({
        id: `lineup-${dateStr}-${c.userEmail.replace(/[^a-z0-9]/gi, "")}-${c.projectId}`,
        date: dateStr,
        projectId: c.projectId,
        projectName: c.projectName,
        userEmail: c.userEmail,
        priority: c.priority,
        status: "Pending",
        createdAt: new Date().toISOString(),
      });
    });
  });

  if (toInsert.length > 0) {
    await insertTaskAssignmentsBulkDb(toInsert);
  }

  return { generated: true, count: toInsert.length, date: dateStr };
}

// Deletes ONE user's still-Pending assignments for ONE date (today, in
// practice — called the moment an admin pauses someone). Only "Pending" rows
// are touched — anything already "Done" is real logged work and is never
// removed. This does NOT touch the weekly deficit bookkeeping in a
// destructive way: because the row is gone, `countThisWeek` in the next
// generation run for this user/project will simply be lower, so the exact
// same project is naturally eligible to be picked again — nothing in the
// rotation is permanently skipped, it's just deferred until they're back.
export async function clearPendingAssignmentsForUserOnDateDb(dateStr: string, userEmail: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    const { error } = await sb
      .from("task_assignments")
      .delete()
      .eq("date", dateStr)
      .eq("user_email", userEmail.trim().toLowerCase())
      .eq("status", "Pending");
    if (error) {
      console.warn("Supabase clear pending assignments for user on date failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Supabase clear pending assignments exception:", err);
    return false;
  }
}

// Deletes EVERY user's still-Pending assignments for ONE date (today, in
// practice — called the moment an admin stops/pauses the whole engine).
// Same reasoning as clearPendingAssignmentsForUserOnDateDb, just engine-wide:
// only "Pending" rows are touched (anything already "Done" is real logged
// work and is never removed), and nothing in the weekly/monthly rotation is
// permanently lost — since the deficit math in generateLineupForDate only
// looks at days up to "yesterday", clearing today's not-yet-worked rows
// doesn't erase any completed work, so resuming regenerates today's lineup
// picking up exactly where the cycle left off instead of skipping ahead.
export async function clearAllPendingAssignmentsForDateDb(dateStr: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    const { error } = await sb
      .from("task_assignments")
      .delete()
      .eq("date", dateStr)
      .eq("status", "Pending");
    if (error) {
      console.warn("Supabase clear all pending assignments for date failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Supabase clear all pending assignments exception:", err);
    return false;
  }
}

/**
 * Fills in ONE user's lineup for ONE date using the exact same deficit /
 * carry-forward logic as generateLineupForDate — but scoped to a single
 * person, so it can safely run mid-day (e.g. the moment an admin resumes a
 * paused user) without touching or duplicating anyone else's assignments
 * for that date. If this user already has any assignment for the date, it
 * does nothing (avoids duplicates from being called twice).
 */
export async function regenerateLineupForUserOnDateDb(
  dateStr: string,
  projects: any[],
  user: { email: string; name: string }
): Promise<{ count: number }> {
  const dow = new Date(dateStr + "T00:00:00Z").getUTCDay();
  if (dow === 0) return { count: 0 }; // Sundays are a rest day

  const userEmail = String(user.email || "").trim().toLowerCase();
  if (!userEmail) return { count: 0 };

  // Already has assignments for this date (e.g. resumed twice, or paused
  // and unpaused again before this ran) — don't duplicate.
  const existingForUser = await getTaskAssignmentsDb({ date: dateStr, userEmail });
  if (existingForUser.length > 0) return { count: 0 };

  const weekStart = weekStartMonday(dateStr);
  const monthStart = monthStartOf(dateStr);
  const yesterday = addDays(dateStr, -1);
  const rangeStart = weekStart < monthStart ? weekStart : monthStart;
  const periodSoFar = await getTaskAssignmentsDb({ dateFrom: rangeStart, dateTo: yesterday, userEmail });

  const countThisWeek = new Map<string, number>();
  const countThisMonth = new Map<string, number>();
  periodSoFar.forEach((a) => {
    if (a.date >= weekStart) countThisWeek.set(a.projectId, (countThisWeek.get(a.projectId) || 0) + 1);
    if (a.date >= monthStart) countThisMonth.set(a.projectId, (countThisMonth.get(a.projectId) || 0) + 1);
  });

  const yesterdayPending = new Set<string>();
  periodSoFar
    .filter((a) => a.date === yesterday && a.status === "Pending")
    .forEach((a) => yesterdayPending.add(a.projectId));

  type Candidate = { projectId: string; projectName: string; priority: string; carried: boolean; deficit: number };
  const candidates: Candidate[] = [];

  projects.forEach((p) => {
    const priority = String(p.priority || "").toUpperCase();
    const rule = PRIORITY_RULES[priority];
    if (!rule) return;

    const rawUsers: string[] = Array.isArray(p.users) ? p.users : [];
    const emails = new Set<string>();
    rawUsers.forEach((u: string) => {
      if (u && String(u).trim()) emails.add(String(u).trim().toLowerCase());
    });
    if (p.userId && String(p.userId).trim()) emails.add(String(p.userId).trim().toLowerCase());
    if (!emails.has(userEmail)) return;

    const doneThisPeriod = rule.period === "month" ? countThisMonth.get(p.id) || 0 : countThisWeek.get(p.id) || 0;
    const deficit = rule.target - doneThisPeriod;
    const carried = yesterdayPending.has(p.id);
    if (deficit <= 0 && !carried) return;

    candidates.push({ projectId: p.id, projectName: p.name, priority, carried, deficit });
  });

  const toInsert = selectDailyCandidates(candidates).map((c) => ({
    id: `lineup-${dateStr}-${userEmail.replace(/[^a-z0-9]/gi, "")}-${c.projectId}`,
    date: dateStr,
    projectId: c.projectId,
    projectName: c.projectName,
    userEmail,
    priority: c.priority,
    status: "Pending",
    createdAt: new Date().toISOString(),
  }));

  if (toInsert.length > 0) {
    await insertTaskAssignmentsBulkDb(toInsert);
  }

  return { count: toInsert.length };
}

// =========================================================================
// TASK LINEUP ENGINE STATE — makes "Start Cycle" a one-time, lifetime action.
// `active` is set once, the first time an admin starts the cycle, and never
// gets cleared by the daily auto-generate check. `paused` is the separate
// long-vacation switch — the engine stays "active" but simply skips
// auto-generating while paused, and picks back up the day it's unpaused.
// =========================================================================

export async function getLineupEngineStateDb(): Promise<{ active: boolean; paused: boolean }> {
  const sb = getSupabase();
  if (!sb) return { active: false, paused: false };
  try {
    const { data, error } = await sb.from("lineup_engine").select("*").eq("id", "singleton").maybeSingle();
    // IMPORTANT: a real Supabase error (missing table, bad connection, etc.)
    // used to be silently treated the same as "no row created yet", which
    // masked write failures elsewhere — the caller had no way to tell "never
    // started" apart from "the DB call is actually broken". Log it loudly so
    // it shows up in server logs instead of failing silently.
    if (error) {
      console.error("Supabase error reading lineup_engine state:", error.message);
      return { active: false, paused: false };
    }
    if (!data) return { active: false, paused: false };
    return { active: !!data.active, paused: !!data.paused };
  } catch (err) {
    console.error("Supabase exception for getLineupEngineStateDb:", err);
    return { active: false, paused: false };
  }
}

export async function setLineupEngineStateDb(patch: { active?: boolean; paused?: boolean }): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    const current = await getLineupEngineStateDb();
    const row = {
      id: "singleton",
      active: patch.active !== undefined ? patch.active : current.active,
      paused: patch.paused !== undefined ? patch.paused : current.paused,
      updated_at: new Date().toISOString(),
    };
    const { error } = await sb.from("lineup_engine").upsert(row, { onConflict: "id" });
    if (error) {
      console.warn("Supabase upsert lineup_engine failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Supabase exception for setLineupEngineStateDb:", err);
    return false;
  }
}

// Called on server startup (interval) and opportunistically whenever the
// Task Lineup screen is loaded. If the engine has been started, isn't
// paused, and today's lineup doesn't exist yet (and today isn't a Sunday),
// this generates it — so nobody ever has to remember to click "Start Cycle"
// again after the very first time.
export async function ensureTodayLineupIfEngineActive(): Promise<void> {
  try {
    const state = await getLineupEngineStateDb();
    if (!state.active || state.paused) return;
    const today = new Date().toISOString().slice(0, 10);
    if (new Date(today + "T00:00:00Z").getUTCDay() === 0) return; // Sunday rest day
    const existing = await getTaskAssignmentsDb({ date: today });
    if (existing.length > 0) return;
    const projects = await getProjectsDb();
    const users = await getUsersDb();
    await generateLineupForDate(today, projects, users, false);
  } catch (err) {
    console.error("ensureTodayLineupIfEngineActive error:", err);
  }
}

// Per-user rollup for the admin "Team Pause Controls" panel and the
// "Check Pendings" drill-down: total assignments ever made, yesterday's
// still-pending count, and the all-time still-pending count, for every
// configured user in one shot (avoids N round trips from the client).
export async function getPendingSummaryAllUsersDb(
  users: { email: string; name: string }[]
): Promise<Array<{
  email: string;
  name: string;
  totalTasks: number;
  yesterdayPendingCount: number;
  totalPendingCount: number;
  yesterdayPending: any[];
  totalPending: any[];
}>> {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = addDays(today, -1);
  const all = await getTaskAssignmentsDb({ dateTo: today });

  // Same duplicate-account collapsing as generateLineupForDate: two
  // app_users rows can share a display name but have different emails
  // (a known duplicate-account issue — see Admin Settings > Users). Every
  // assignment actually gets written under ONE canonical email for that
  // name, so without this collapsing here too, the "Total" shown for a
  // person's OTHER (non-canonical) email would wrongly read as a small/odd
  // number instead of their real all-time total. Canonicalize every user
  // onto the first email seen for their name before counting.
  const canonicalEmailByName = new Map<string, string>();
  const canonicalEmailByRawEmail = new Map<string, string>();
  users.forEach((u) => {
    const email = String(u.email || "").trim().toLowerCase();
    if (!email) return;
    const nameKey = String(u.name || "").trim().toLowerCase();
    if (nameKey) {
      if (!canonicalEmailByName.has(nameKey)) canonicalEmailByName.set(nameKey, email);
      canonicalEmailByRawEmail.set(email, canonicalEmailByName.get(nameKey)!);
    } else {
      canonicalEmailByRawEmail.set(email, email);
    }
  });
  const canonicalOf = (rawEmail: string): string => {
    const email = String(rawEmail || "").trim().toLowerCase();
    return canonicalEmailByRawEmail.get(email) || email;
  };

  const perUser = new Map<string, any[]>();
  all.forEach((a) => {
    const key = canonicalOf(String(a.userEmail || ""));
    if (!perUser.has(key)) perUser.set(key, []);
    perUser.get(key)!.push(a);
  });

  return users.map((u) => {
    const key = canonicalOf(u.email);
    const rows = perUser.get(key) || [];
    const yesterdayPending = rows.filter((r) => r.date === yesterday && r.status === "Pending");
    const totalPending = rows.filter((r) => r.status === "Pending");
    return {
      email: u.email,
      name: u.name,
      totalTasks: rows.length,
      yesterdayPendingCount: yesterdayPending.length,
      totalPendingCount: totalPending.length,
      yesterdayPending,
      totalPending,
    };
  });
}

export async function saveManualRankingsDb(gridData: any): Promise<boolean> {
  const sb = getSupabase();
  if (sb) {
    try {
      const row = {
        id: "latest",
        data: gridData,
        created_at: new Date().toISOString()
      };

      const { error } = await sb
        .from("manual_rankings")
        .upsert(row, { onConflict: "id" });

      if (error) {
        console.warn("Supabase upsert manual_rankings failed:", error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.error("Supabase upsert manual_rankings exception:", err);
    }
  }
  return false;
}
