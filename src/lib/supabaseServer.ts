import { createClient } from "@supabase/supabase-js";
import { PRIORITY_RULES, PRIORITY_TIER_DAILY_CAP, DAILY_LINEUP_CAP_PER_USER, GROUP_CASCADE_ORDER } from "../types";

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

// ---------------------------------------------------------------------------
// IST-safe "today" helper.
//
// BUG THIS FIXES: every "what's today's date" calculation in this file used
// to be `new Date().toISOString().slice(0, 10)`. toISOString() ALWAYS
// returns the date in UTC, never the server's or user's local timezone. For
// any time between 12:00 AM and 5:29 AM IST, UTC is still on the PREVIOUS
// calendar day (IST = UTC + 5:30) — so a lineup generated, or a
// pending-summary computed, in that early-morning window silently landed
// one day earlier than the actual IST date. Work logged/submitted that
// morning (matched against the correct IST date) then never lined up with
// the assignment row that got the wrong (UTC) date, so it stayed stuck on
// "Pending" forever even though the work was genuinely done and saved.
//
// Fix: compute "today" (and "yesterday") explicitly in Asia/Kolkata, not by
// asking a UTC-based Date for its ISO string. Every "today"/"current date"
// call site in this file (and the pending-summary route in server.ts) now
// goes through this instead of `new Date().toISOString().slice(0, 10)`.
export function todayIST(): string {
  // en-CA locale formats as YYYY-MM-DD, which is exactly what every date
  // column/comparison in this codebase expects.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// Check which tables exist in Supabase
export async function checkSupabaseTablesStatus(): Promise<{ configured: boolean; ok: boolean; error: string; missingTables: string[] }> {
  const sb = getSupabase();
  if (!sb) {
    return { configured: false, ok: false, error: "Supabase not configured in settings variables.", missingTables: [] };
  }

  const tables = ["projects", "submissions", "alerts", "activities", "rankings", "manual_rankings", "task_assignments", "lineup_engine", "ranking_history", "report_state"];
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
-- Older databases created before the admin "status" workflow (Pending/
-- Approved/Needs Revision/Remark) was added may be missing this column,
-- which used to make every single Work Log submission silently fail to
-- save. Safe to run any number of times.
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Pending';

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
-- Admin Control Panel: login credentials + role now live in the DB instead
-- of being hardcoded in LoginScreen.tsx / App.tsx.
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS passkey TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';

-- One-time seed of the previously-hardcoded ID/passkey pairs so existing
-- logins keep working after you switch this table on. Safe to run more
-- than once (ON CONFLICT does nothing if the user already exists).
INSERT INTO app_users (user_id, name, passkey, role) VALUES
  ('1859', 'User 1859', '0069', 'user'),
  ('9531', 'User 9531', '4949', 'user'),
  ('5595', 'User 5595', '9231', 'user'),
  ('4001', 'User 4001', '1793', 'user'),
  ('8888', 'Admin', '2010', 'admin')
ON CONFLICT (user_id) DO NOTHING;

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

-- 10. Ranking History Table — one archived snapshot per ISO week (e.g.
-- "2026-W34"), so the Sunday auto-report has a permanent before/after
-- trail you can look back on across the whole year, not just the latest run.
CREATE TABLE IF NOT EXISTS ranking_history (
  id TEXT PRIMARY KEY, -- ISO week id, e.g. "2026-W34"
  data JSONB DEFAULT '{}'::jsonb, -- { generatedAt, rows: [{projectName, domain, keyword, before, after, change}, ...] }
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- 11. Report State Table (single row) — tracks the last ISO week the
-- weekly ranking-report job actually ran, so it never double-sends the
-- same week's email even if both the external cron ping and the
-- in-process Sunday scheduler happen to fire close together.
CREATE TABLE IF NOT EXISTS report_state (
  id TEXT PRIMARY KEY, -- always "weekly_ranking_report"
  last_run_week TEXT,
  last_run_at TIMESTAMPTZ,
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
ALTER TABLE ranking_history DISABLE ROW LEVEL SECURITY;
ALTER TABLE report_state DISABLE ROW LEVEL SECURITY;

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
      // Assignment (userId/users) is managed inside the app via
      // Admin > Reassign Project, which only ever writes to Supabase — it
      // has no way to also update the Google Sheet. If a bulk sync (e.g.
      // "Sync from Sheet") then blindly overwrote user_id/users with
      // whatever's in the Sheet for that row, any reassignment done since
      // the Sheet was last updated would silently get wiped back to
      // blank/stale the next time someone clicks Sync — which is exactly
      // what was happening. So: only let the Sheet REPLACE the assignment
      // when the Sheet actually has a non-empty value for it; otherwise
      // keep whatever is already in Supabase for that project.
      const existingList = await getProjectsDb();
      const existingById = new Map<string, any>(existingList.map((p: any) => [p.id, p]));

      const rows = projects.map(p => {
        const existing = existingById.get(p.id);
        const incomingUsers = Array.isArray(p.users) ? p.users.filter((u: any) => String(u || "").trim()) : [];
        const incomingUserId = String(p.userId || "").trim();

        const resolvedUsers = incomingUsers.length > 0 ? incomingUsers : (existing?.users || []);
        const resolvedUserId = incomingUserId ? incomingUserId : (existing?.userId || "");

        return {
          id: p.id,
          name: p.name,
          code: p.code,
          domain: p.domain,
          location: p.location,
          region: p.region,
          users: resolvedUsers,
          user_id: resolvedUserId,
          priority: p.priority || "",
          frequency: p.frequency || "",
          keywords: p.keywords || [],
          description: p.description || ""
        };
      });

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

export async function getUsersDb(): Promise<{ email: string; name: string; paused?: boolean; role?: string }[]> {
  const sb = getSupabase();
  if (sb) {
    try {
      const { data, error } = await sb
        .from("app_users")
        .select("user_id, name, paused, role")
        .order("name", { ascending: true });

      if (error) {
        console.warn("Supabase query error for app_users:", error.message);
      } else if (data) {
        // NOTE: passkey is intentionally never returned here — this list is
        // consumed by the frontend admin dropdown and must not leak credentials.
        // ROOT BUG (found and fixed): a malformed/duplicate app_users row
        // with a null/empty user_id (e.g. left over from the Kavita/5595
        // duplicate-account cleanup) was being mapped straight through as
        // `{ email: null, ... }`. The frontend (DSRLogs.tsx, DSRDashboard.tsx,
        // TaskLineup.tsx, App.tsx) calls `u.email.trim()` in many places
        // without a null check, assuming every entry in this list has a real
        // ID — one bad row crashed the whole Work Log History screen (white
        // screen) for anyone whose data happened to trigger that code path.
        // Filtering out rows with no usable user_id here, at the source,
        // protects every one of those call sites at once.
        return data
          .filter((u: any) => u.user_id && String(u.user_id).trim())
          .map((u: any) => ({ email: String(u.user_id).trim(), name: u.name, paused: !!u.paused, role: u.role || 'user' }));
      }
    } catch (err) {
      console.error("Supabase exception for getUsersDb:", err);
    }
  }
  return [];
}

// Server-side only — verifies a userId/passkey pair against the DB.
// Falls back to null (caller decides how to handle "not found") so the
// route can apply a legacy-hardcoded safety net until the SQL migration
// above has actually been run on the person's Supabase project.
export async function verifyUserCredentialsDb(
  userId: string,
  passkey: string
): Promise<{ name: string; role: 'user' | 'admin' } | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const normalizedId = String(userId).trim().toLowerCase();
    const { data, error } = await sb
      .from("app_users")
      .select("user_id, name, passkey, role")
      .ilike("user_id", normalizedId)
      .maybeSingle();

    if (error || !data) return null;
    if (data.passkey == null) return null; // column not migrated / user has no passkey set yet
    if (String(data.passkey) !== String(passkey)) return null;

    return { name: data.name || normalizedId, role: (data.role === 'admin' ? 'admin' : 'user') };
  } catch (err) {
    console.error("Supabase exception for verifyUserCredentialsDb:", err);
    return null;
  }
}

// Updates a user's display name and/or passkey ONLY.
//
// IMPORTANT: the login ID (app_users.user_id, the primary key that every
// project's userId/users[] points at) is NEVER changed by this function
// anymore. It used to also accept a `newUserId` and rewrite the ID here,
// cascading that new ID (plus the OLD display name, swapped in as a raw
// string) onto every project's `users[]` array. That cascade is exactly
// what kept re-planting name strings (e.g. "vatsal patel") into
// `users[]` instead of the numeric ID every time an admin edited someone's
// name — which is the root cause of the "same user shown twice, once
// properly-cased and once lowercase" bug. Since the ID can no longer
// change and projects only ever store the numeric ID, there is nothing to
// cascade onto projects at all: renaming a user is now a pure metadata
// update on the app_users row, and every screen that displays a name
// resolves it live from this table by ID.
export async function renameUserDb(
  userId: string,
  newName: string,
  newPasskey?: string
): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    const id = String(userId).trim().toLowerCase();

    const updatePayload: any = { name: newName };
    if (newPasskey) updatePayload.passkey = newPasskey;

    const { error: userErr } = await sb
      .from("app_users")
      .update(updatePayload)
      .ilike("user_id", id);
    if (userErr) {
      console.warn("Supabase renameUserDb (app_users) failed:", userErr.message);
      return false;
    }

    return true;
  } catch (err) {
    console.error("Supabase exception for renameUserDb:", err);
    return false;
  }
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

export async function saveUserDb(
  userId: string,
  name: string,
  passkey?: string,
  role?: 'user' | 'admin'
): Promise<boolean> {
  const sb = getSupabase();
  if (sb) {
    try {
      // Normalize to lowercase on write so every future lookup (pause
      // toggle, assignment matching, etc.) can rely on a consistent case
      // instead of needing case-insensitive matches everywhere.
      const normalizedUserId = String(userId).trim().toLowerCase();
      const row: any = { user_id: normalizedUserId, name };
      if (passkey) row.passkey = passkey;
      if (role) row.role = role;
      const { error } = await sb
        .from("app_users")
        .upsert(row, { onConflict: "user_id" });

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
      // IMPORTANT: PostgREST/Supabase caps any single .select() at 1000 rows
      // by default. With no .range() paging, once total submissions across
      // ALL users crossed 1000, only the newest 1000 rows (globally) came
      // back — silently cutting off every user's older Work Log history and
      // making it look like "only the last few days" of data existed. This
      // loops in pages of 1000 until Supabase returns a page smaller than
      // the page size, guaranteeing the FULL table (every user, every date,
      // A to Z) is returned every time. Nothing is deleted or skipped.
      const PAGE_SIZE = 1000;
      let page = 0;
      const allRows: any[] = [];
      while (true) {
        const from = page * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;
        const { data, error } = await sb
          .from("submissions")
          .select("*")
          .order("created_at", { ascending: false })
          .range(from, to);

        if (error) {
          console.warn("Supabase query error for submissions:", error.message);
          break;
        }
        if (!data || data.length === 0) break;

        allRows.push(...data);
        if (data.length < PAGE_SIZE) break; // last page reached
        page += 1;
      }

      if (allRows.length > 0) {
        return allRows.map((s: any) => ({
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

// Returns { ok, error } instead of a bare boolean so the caller (and, from
// there, the client that just clicked "Submit") can see the REAL reason a
// save failed instead of a generic "didn't save" message. This was needed
// because a submission could fail for very different reasons (a transient
// network blip to Supabase vs. the table genuinely rejecting the row) and
// previously all of them looked identical from the outside.
export async function appendSubmissionDb(entry: any): Promise<{ ok: boolean; error?: string }> {
  const sb = getSupabase();
  if (!sb) {
    return { ok: false, error: "Supabase is not configured on the server." };
  }

  const buildRow = (includeStatus: boolean) => {
    const row: any = {
      id: entry.id,
      date: entry.date,
      user_email: entry.userEmail,
      works: entry.works || [],
      created_at: entry.createdAt,
    };
    if (includeStatus) row.status = entry.status || 'Pending';
    return row;
  };

  // A single Supabase insert attempt. Returns the raw error (if any) so the
  // caller can decide whether to retry.
  const attemptInsert = async (includeStatus: boolean) => {
    const { error } = await sb.from("submissions").insert(buildRow(includeStatus));
    return error;
  };

  let lastError: any = null;

  // Up to 2 tries total for ordinary (transient) failures — a dropped
  // connection or a momentary Supabase hiccup shouldn't cost the user their
  // Work Log entry when a simple retry would have gone through fine.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const error = await attemptInsert(true);
      if (!error) return { ok: true };

      lastError = error;
      const msg = String(error.message || "");

      // Some Supabase projects' "submissions" table predates the "status"
      // column being added to the app. In that case every insert here would
      // fail forever with "Could not find the 'status' column..." even
      // though nothing is actually wrong with the submission itself. Detect
      // that specific case and immediately retry once WITHOUT the status
      // field, rather than losing the whole Work Log entry over one
      // optional column.
      const isMissingStatusColumn =
        error.code === "PGRST204" ||
        (msg.toLowerCase().includes("status") && msg.toLowerCase().includes("column"));

      if (isMissingStatusColumn) {
        const fallbackError = await attemptInsert(false);
        if (!fallbackError) return { ok: true };
        lastError = fallbackError;
      }

      console.warn(`Supabase append submission failed (attempt ${attempt}):`, {
        message: error.message,
        code: (error as any).code,
        details: (error as any).details,
        hint: (error as any).hint,
      });

      // Brief backoff before the one retry for transient errors only.
      if (attempt === 1) await new Promise((r) => setTimeout(r, 400));
    } catch (err: any) {
      lastError = err;
      console.error(`Supabase append submission exception (attempt ${attempt}):`, err);
      if (attempt === 1) await new Promise((r) => setTimeout(r, 400));
    }
  }

  return { ok: false, error: lastError?.message || "Unknown database error." };
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
// RANKING HISTORY (weekly auto-report archive) DB INTERACTION
// =========================================================================

// Saves one week's full before/after report snapshot, keyed by ISO week
// (e.g. "2026-W34"). Safe to call more than once for the same week - it
// just overwrites that week's row instead of duplicating it.
export async function saveRankingHistoryDb(weekId: string, data: any): Promise<boolean> {
  const sb = getSupabase();
  if (sb) {
    try {
      const row = {
        id: weekId,
        data,
        created_at: new Date().toISOString()
      };
      const { error } = await sb
        .from("ranking_history")
        .upsert(row, { onConflict: "id" });

      if (error) {
        console.warn("Supabase upsert ranking_history failed:", error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.error("Supabase ranking_history upsert exception:", err);
    }
  }
  return false;
}

// Returns the most recent N archived weekly reports, newest first.
export async function getRankingHistoryDb(limit: number = 12): Promise<any[]> {
  const sb = getSupabase();
  if (sb) {
    try {
      const { data, error } = await sb
        .from("ranking_history")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) {
        console.warn("Supabase get ranking_history failed:", error.message);
        return [];
      }
      return data || [];
    } catch (err) {
      console.error("Supabase ranking_history fetch exception:", err);
    }
  }
  return [];
}

// =========================================================================
// REPORT STATE (dedupe guard for the weekly ranking-report job)
// =========================================================================

const REPORT_STATE_ID = "weekly_ranking_report";

export async function getReportStateDb(): Promise<{ last_run_week?: string; last_run_at?: string } | null> {
  const sb = getSupabase();
  if (sb) {
    try {
      const { data, error } = await sb
        .from("report_state")
        .select("*")
        .eq("id", REPORT_STATE_ID)
        .single();

      if (error) {
        if (error.code !== "PGRST116") {
          console.warn("Supabase get report_state failed:", error.message);
        }
        return null;
      }
      return data || null;
    } catch (err) {
      console.error("Supabase report_state fetch exception:", err);
    }
  }
  return null;
}

export async function setReportStateDb(weekId: string): Promise<boolean> {
  const sb = getSupabase();
  if (sb) {
    try {
      const row = {
        id: REPORT_STATE_ID,
        last_run_week: weekId,
        last_run_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      const { error } = await sb
        .from("report_state")
        .upsert(row, { onConflict: "id" });

      if (error) {
        console.warn("Supabase upsert report_state failed:", error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.error("Supabase report_state upsert exception:", err);
    }
  }
  return false;
}

// =========================================================================
// MANUAL RANKINGS ("Update Ranking" grid) DB INTERACTION
// =========================================================================

export async function getManualRankingsDb(userKey: string): Promise<any> {
  const sb = getSupabase();
  if (sb && userKey) {
    try {
      const { data, error } = await sb
        .from("manual_rankings")
        .select("*")
        .eq("id", `user:${userKey}`)
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
// which of their projects are still "owed" work for their tier's period
// (deficit = target - how many times it's already been assigned so far
// this period), and picks candidates bucket-by-bucket.
//
// NO CARRY-FORWARD: a project that's still "Pending" (not yet submitted)
// from a previous day is never force-added to today's lineup. It simply
// stays Pending, and is only re-offered here the next time its own
// period's deficit math makes it eligible again — e.g. an X5 project
// won't reappear until next month, an X1/X2/X3/X4 project won't reappear
// until its weekly target has room again (which, for X1 with a 4x/week
// target, can still be later in the SAME week — but never forced onto a
// day just because it's pending).
//
// CASCADING DAILY CAPACITY: X1 (4/day) and X2 (3/day) are the top-
// weightage tiers and their daily cap never grows. X3/X4/X5 start at their
// own base caps (2/3/3), but if X1, X2, or one of X3/X4/X5 itself runs out
// of eligible projects for the day, its unused capacity cascades to the
// rest of the X3/X4/X5 group (in the order X3 -> X4 -> X5, wrapping around
// whichever tier still has real candidates) so the user's lineup keeps
// trying to reach the overall DAILY_LINEUP_CAP_PER_USER (15) ceiling
// instead of leaving slots unused. See selectDailyCandidates() below.

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

// Matches the submission's date to a Pending assignment by EXACT date only.
//
// This used to widen the match to a ±1 day window, on the theory that a
// work log's date and its assignment's date could end up one calendar day
// apart from midnight/5:30-AM-IST boundary drift. That drift was a real bug
// once, but it's already fixed at the source by todayIST() above — every
// "today" computation in this codebase is now IST-safe, so a submission's
// date and its assignment's date should always agree exactly.
//
// Keeping the ±1 day tolerance after that fix caused a WORSE bug: X1-X4
// projects legitimately repeat for the same user on a following day (that's
// normal frequency scheduling, not drift), so when today's fresh lineup
// re-offered a project the user had already done yesterday, this function's
// wide window matched TODAY's brand-new Pending row against YESTERDAY's
// submission and silently flipped it to "Done" before the user had done any
// work today. Each day's row must only be settled by that day's own
// submission — new day, new date, fresh Pending status — so this is now a
// strict exact-date match.
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
// One-time cleanup for assignments that got stuck on "Pending" from BEFORE
// the todayIST() fix above existed — i.e. exactly the "I submitted it but
// it still shows Pending" backlog (e.g. last Saturday's rows). Cross-checks
// every still-Pending assignment against the submissions that already exist
// in the DB: if a Work Log was filed by the same (canonical) user, for the
// same project, on the assignment's EXACT date, the work was genuinely done
// — so it gets flipped to Done now instead of staying stuck forever. Safe
// to run more than once; anything that's already Done or has no matching
// submission is left untouched. Returns how many rows it fixed.
//
// This used to also match submissions from the day before/after each
// assignment (±1 day tolerance), for the same midnight/5:30-AM-IST boundary
// drift markTaskAssignmentDoneDb used to guard against. That tolerance is
// gone here too, for the same reason: todayIST() already makes every date
// exact, and the tolerance was instead matching yesterday's submission
// against a same-user/same-project row freshly re-offered TODAY (normal for
// X1-X4 projects), wrongly marking today's untouched row as Done. New day,
// new date — only that day's own submission can settle that day's row.
export async function reconcileStuckPendingAssignmentsDb(
  users: { email: string; name: string; role?: string }[]
): Promise<{ checked: number; fixed: number }> {
  const sb = getSupabase();
  if (!sb) return { checked: 0, fixed: 0 };

  const canonicalMap = buildCanonicalEmailMap(users);
  const canonicalOf = (rawEmail: string): string => resolveCanonicalEmail(rawEmail, canonicalMap);

  const [pending, submissions] = await Promise.all([
    getTaskAssignmentsDb({ status: "Pending" }),
    getSubmissionsDb(),
  ]);

  // Index submissions by canonical user -> set of "date::projectId" strings,
  // using the submission's EXACT date only — no ±1 day tolerance.
  const submittedKeys = new Set<string>();
  submissions.forEach((s: any) => {
    if (!s.date || !Array.isArray(s.works)) return;
    const canonical = canonicalOf(String(s.userEmail || ""));
    s.works.forEach((w: any) => {
      if (w.projectId) submittedKeys.add(`${canonical}::${w.projectId}::${s.date}`);
    });
  });

  let fixed = 0;
  for (const a of pending) {
    const canonical = canonicalOf(String(a.userEmail || ""));
    const key = `${canonical}::${a.projectId}::${a.date}`;
    if (submittedKeys.has(key)) {
      const { error } = await sb
        .from("task_assignments")
        .update({ status: "Done" })
        .eq("id", a.id)
        .eq("status", "Pending");
      if (!error) fixed++;
      else console.warn(`Reconcile: failed to flip assignment ${a.id}:`, error.message);
    }
  }

  return { checked: pending.length, fixed };
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

// ---------------------------------------------------------------------
// Duplicate-account canonicalization (shared helper)
// ---------------------------------------------------------------------
// Two app_users rows can share a display name but have different login
// emails (a known duplicate-account issue — see Admin Settings > Users).
// generateLineupForDate() and getPendingSummaryAllUsersDb() already
// collapse every email onto one "canonical" email per name so a real
// person's work is only ever assigned/counted once. This was NOT applied
// where Task Lineup rows are read back for display, or where a Work Log
// submission flips an assignment to "Done" — so a person logging in under
// their non-canonical email would (a) never see their submission reflected
// as "Submitted" in the admin's Daily Assignment Status calendar (the
// update targeted a user_email that no assignment row was ever written
// under), and (b) could show the same project twice under one name in that
// calendar if old rows exist under both of their emails. These helpers
// let every call site canonicalize consistently.
// Normalizes a display name into a stable grouping key: trims, lowercases,
// AND collapses any run of internal whitespace (double spaces, tabs, a
// stray newline pasted from a spreadsheet) down to one space. Plain
// `.trim().toLowerCase()` leaves "Kavita  Mishra" (double space) and
// "Kavita Mishra" (single space) as two DIFFERENT keys — which is exactly
// what let two duplicate-account rows for the same real person dodge every
// canonicalization check below and both receive a full, separate lineup
// (visible as the same name showing up as two separate cards in the admin
// Task Lineup view). Every canonicalization site in this file must use
// this helper, not its own inline trim/lowercase, so they all agree on
// which rows belong to the same person.
export function normalizeNameKey(name: string | undefined | null): string {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function buildCanonicalEmailMap(users: { email: string; name?: string }[]): Map<string, string> {
  const canonicalEmailByRawEmail = new Map<string, string>();

  // Every real registered account is its own canonical identity by default.
  users.forEach((u) => {
    const email = String(u.email || "").trim().toLowerCase();
    if (!email) return;
    canonicalEmailByRawEmail.set(email, email);
  });

  // Count how many DISTINCT real accounts share each normalized display name.
  const emailsByName = new Map<string, Set<string>>();
  users.forEach((u) => {
    const email = String(u.email || "").trim().toLowerCase();
    if (!email) return;
    const nameKey = normalizeNameKey(u.name);
    if (!nameKey) return;
    if (!emailsByName.has(nameKey)) emailsByName.set(nameKey, new Set());
    emailsByName.get(nameKey)!.add(email);
  });

  // Only fold a NAME onto a canonical email when that name belongs to
  // EXACTLY ONE real registered account. This is what lets a phantom "name
  // typed in instead of the numeric ID" row in a project's Users column
  // (e.g. "kavita mishra" instead of "5595") resolve back onto that one
  // real person's real account — the original bug this map was built to
  // fix.
  //
  // BUG FIXED HERE: the previous version folded by name unconditionally —
  // the FIRST real account seen with a given name became "the" canonical
  // email for that name, and every OTHER real account that happened to
  // share the exact same display name got silently merged into it too.
  // Two different real team members legitimately sharing a name (e.g. two
  // people both named "Kavita Mishra") were being treated as the SAME
  // person: one person's task lineup, submissions, and pending counts were
  // getting attributed to the other's account — which is exactly what
  // showed up as "different/extra items in today's lineup" and admin
  // seeing a different project set than what the actual assigned user saw.
  // Now, when a name is shared by 2+ real accounts, it's left deliberately
  // AMBIGUOUS and is never used to fold anyone's identity — each of those
  // accounts keeps its own separate email as its canonical identity.
  emailsByName.forEach((emails, nameKey) => {
    if (emails.size === 1) {
      const [onlyEmail] = Array.from(emails);
      if (!canonicalEmailByRawEmail.has(nameKey)) canonicalEmailByRawEmail.set(nameKey, onlyEmail);
    }
  });

  return canonicalEmailByRawEmail;
}

export function resolveCanonicalEmail(rawEmail: string, canonicalMap: Map<string, string>): string {
  const email = String(rawEmail || "").trim().toLowerCase();
  if (canonicalMap.has(email)) return canonicalMap.get(email)!;
  // Fallback: the raw value might be a NAME (with irregular spacing) rather
  // than an email/ID — e.g. "Kavita  Mishra" instead of "kavita mishra" or
  // her real ID. Try the whitespace-collapsed form before giving up.
  const nameForm = normalizeNameKey(rawEmail);
  if (canonicalMap.has(nameForm)) return canonicalMap.get(nameForm)!;
  return email;
}

// Collapses task_assignments rows belonging to the same real person (same
// canonical email) + project + date down to one row — same precedence
// rules as dedupeAssignments (prefer "Done" over "Pending", then the most
// recently created row) but keyed on canonical identity so duplicate
// ACCOUNT rows (different emails, same person) merge too, not just exact
// email duplicates. Returned rows have userEmail rewritten to the
// canonical email so grouping/display is consistent.
export function dedupeAssignmentsByCanonicalIdentity(rows: any[], canonicalMap: Map<string, string>): any[] {
  const byKey = new Map<string, any>();
  rows.forEach((r) => {
    const canonicalEmail = resolveCanonicalEmail(r.userEmail, canonicalMap);
    const candidate = { ...r, userEmail: canonicalEmail };
    const key = `${candidate.date}::${canonicalEmail}::${candidate.projectId}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, candidate);
      return;
    }
    const prevDone = prev.status === "Done";
    const curDone = candidate.status === "Done";
    if (curDone && !prevDone) {
      byKey.set(key, candidate);
    } else if (curDone === prevDone) {
      const prevTime = new Date(prev.createdAt || 0).getTime();
      const curTime = new Date(candidate.createdAt || 0).getTime();
      if (curTime >= prevTime) byKey.set(key, candidate);
    }
  });
  return Array.from(byKey.values());
}

// =========================================================================
// PAUSE = A REAL STATUS, NOT A READ-TIME HIDE.
//
// "Paused" is a third status value alongside "Pending" and "Done". Pausing
// a day's lineup (for one user, or for everyone via "Stop Cycle") flips
// that day's still-"Pending" rows to "Paused" — a real write, nothing is
// deleted. Resuming flips them straight back to "Pending".
//
// This is deliberately simple on purpose:
//   - Every screen that reads the lineup (Today's Lineup, the admin's
//     per-user cards, the Daily Assignment Status calendar) just excludes
//     "Paused" rows, so a paused day reads as "no lineup for today" with
//     no extra bookkeeping needed — the status IS the visibility.
//   - Every pending-count endpoint already filters on status === "Pending"
//     specifically, so a "Paused" row simply stops being counted the
//     moment it's paused, and starts being counted again the moment it's
//     resumed — the count naturally goes down on pause and back up on
//     resume, because that's what actually happened to the data.
//   - The Work Log "Done" flip (markTaskAssignmentDoneDb) only ever
//     matches rows still at status "Pending", so a submission made while
//     paused correctly leaves the "Paused" row alone instead of silently
//     consuming it — the work log itself still saves in full either way.
//   - "Done" rows are NEVER touched by any of the functions below — once a
//     task is actually submitted it's real logged work, and pause/resume
//     only ever affects work that hasn't been done yet.
// =========================================================================

// Per-user Pause: flips ONE user's still-Pending rows on ONE date to
// "Paused". Used by the per-user Pause button — only ever touches that
// single person's rows for that day; every other user's lineup for the
// same date is completely untouched.
export async function pauseUserAssignmentsForDateDb(date: string, userEmail: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    const { error } = await sb
      .from("task_assignments")
      .update({ status: "Paused" })
      .eq("date", date)
      .eq("user_email", userEmail.trim().toLowerCase())
      .eq("status", "Pending");
    if (error) {
      console.warn("Supabase pause user assignments failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Supabase pause user assignments exception:", err);
    return false;
  }
}

// Per-user Resume: flips this user's "Paused" rows (any date they're
// paused on) straight back to "Pending" — the exact same lineup they had
// before reappears, and it starts counting toward their pending totals
// again immediately, because it now genuinely IS pending again.
export async function resumeUserAssignmentsDb(userEmail: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    const { error } = await sb
      .from("task_assignments")
      .update({ status: "Pending" })
      .eq("user_email", userEmail.trim().toLowerCase())
      .eq("status", "Paused");
    if (error) {
      console.warn("Supabase resume user assignments failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Supabase resume user assignments exception:", err);
    return false;
  }
}

// "Stop Cycle": flips EVERY still-Pending row dated `date` to "Paused" in
// one shot — the whole team's lineup for that day disappears from every
// screen (and every pending count) at once, with nothing deleted.
export async function pauseAllAssignmentsForDateDb(date: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    const { error } = await sb
      .from("task_assignments")
      .update({ status: "Paused" })
      .eq("date", date)
      .eq("status", "Pending");
    if (error) {
      console.warn("Supabase pause all assignments failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Supabase pause all assignments exception:", err);
    return false;
  }
}

// "Run Cycle": flips every "Paused" row back to "Pending" — EXCEPT rows
// belonging to a user who is still individually paused (their own Pause
// switch hasn't been turned back on). That exclusion is what keeps an
// individually-paused person's lineup correctly hidden even after the
// whole-team stop has lifted, instead of Run Cycle silently un-pausing
// someone the admin never asked to resume.
export async function resumeAllAssignmentsDb(
  excludeCanonicalEmails: Set<string>,
  canonicalOf: (rawEmail: string) => string
): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    const { data, error: fetchErr } = await sb
      .from("task_assignments")
      .select("id, user_email")
      .eq("status", "Paused");
    if (fetchErr) {
      console.warn("Supabase fetch paused assignments failed:", fetchErr.message);
      return false;
    }
    const idsToResume = (data || [])
      .filter((r: any) => !excludeCanonicalEmails.has(canonicalOf(String(r.user_email || ""))))
      .map((r: any) => r.id);
    if (idsToResume.length === 0) return true;
    const { error } = await sb
      .from("task_assignments")
      .update({ status: "Pending" })
      .in("id", idsToResume);
    if (error) {
      console.warn("Supabase resume all assignments failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Supabase resume all assignments exception:", err);
    return false;
  }
}



function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(dateStr: string, days: number): string {
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

// Given a full list of candidates for ONE user (already deficit-filtered —
// deficit > 0, no "carried" concept anymore), picks the day's lineup using
// a cascading-capacity waterfall:
//
//   1. X1 gets up to its base cap (4), X2 up to its base cap (3) — these
//      two never grow beyond that, no matter how much spare capacity is
//      floating around. Whatever slots they can't fill (not enough X1/X2
//      projects currently owed work) becomes leftover capacity.
//   2. X3, X4, X5 each first get filled up to their own base cap (2/3/3).
//   3. Any capacity still unused — either because X1/X2 couldn't fill
//      their caps, or because one of X3/X4/X5 itself didn't have enough
//      candidates to fill its own base cap — cascades through the group
//      in order X3 -> X4 -> X5 (one slot at a time, looping back around),
//      landing on whichever of those tiers still has real, un-picked
//      candidates. This is what lets, say, an exhausted X4 tier's unused
//      slots bump X3 up (e.g. from 2 to 3 for the day) with any remainder
//      flowing on to X5, and the same cascade applies symmetrically if
//      X3 or X5 is the tier that's run dry instead.
//
// Within any single tier, candidates with the biggest deficit (most
// "behind schedule" for their period) are picked first.
function selectDailyCandidates<
  C extends { priority: string; deficit: number }
>(candidates: C[]): C[] {
  const byDeficitDesc = (a: C, b: C) => b.deficit - a.deficit;

  const TIERS = ['X1', 'X2', 'X3', 'X4', 'X5'];
  const remainingByTier: Record<string, C[]> = {};
  const takenByTier: Record<string, C[]> = {};
  TIERS.forEach((tier) => {
    remainingByTier[tier] = candidates.filter((c) => c.priority === tier).sort(byDeficitDesc);
    takenByTier[tier] = [];
  });

  const takeFromTier = (tier: string, count: number) => {
    for (let i = 0; i < count && remainingByTier[tier].length > 0; i++) {
      takenByTier[tier].push(remainingByTier[tier].shift()!);
    }
  };

  // Pass 1: every tier gets its own base daily cap, limited by however
  // many real candidates it actually has.
  TIERS.forEach((tier) => {
    takeFromTier(tier, PRIORITY_TIER_DAILY_CAP[tier] ?? 0);
  });

  // X1/X2 leftover: capacity they were entitled to but couldn't use.
  const x1Leftover = (PRIORITY_TIER_DAILY_CAP.X1 ?? 0) - takenByTier.X1.length;
  const x2Leftover = (PRIORITY_TIER_DAILY_CAP.X2 ?? 0) - takenByTier.X2.length;

  // X3/X4/X5's own leftover from Pass 1 (some tier(s) in the group
  // couldn't fill their own base cap either).
  const groupOrder = GROUP_CASCADE_ORDER.X4_X5 || ['X3', 'X4', 'X5'];
  const groupBaseCapTotal = groupOrder.reduce((sum, t) => sum + (PRIORITY_TIER_DAILY_CAP[t] ?? 0), 0);
  const groupBaseUsed = groupOrder.reduce((sum, t) => sum + takenByTier[t].length, 0);
  const groupOwnLeftover = groupBaseCapTotal - groupBaseUsed;

  // Total leftover now available to cascade through the X3/X4/X5 group —
  // this is what lets X1/X2's unused daily capacity flow all the way down
  // to X3/X4/X5, on top of the group's own internal reshuffling.
  let cascadeBudget = x1Leftover + x2Leftover + groupOwnLeftover;

  let madeProgress = true;
  while (cascadeBudget > 0 && madeProgress) {
    madeProgress = false;
    for (const tier of groupOrder) {
      if (cascadeBudget <= 0) break;
      if (remainingByTier[tier].length > 0) {
        takeFromTier(tier, 1);
        cascadeBudget -= 1;
        madeProgress = true;
      }
    }
  }

  let selected: C[] = TIERS.flatMap((tier) => takenByTier[tier]);

  // Final safety net — the tier/group math above is built to never exceed
  // DAILY_LINEUP_CAP_PER_USER (base caps already sum to it, and the
  // cascade only ever redistributes already-accounted-for slots), but
  // guard the overall ceiling here regardless.
  if (selected.length > DAILY_LINEUP_CAP_PER_USER) {
    selected = selected.slice(0, DAILY_LINEUP_CAP_PER_USER);
  }

  return selected;
}

/**
 * Generates (or regenerates, if force=true) the Task Lineup for a single
 * calendar date. Returns a summary the API route can pass straight back to
 * the client.
 */
export async function generateLineupForDate(
  dateStr: string,
  projects: any[],
  users: { email: string; name: string; paused?: boolean; role?: string }[],
  force: boolean = false,
  // Internal-use optimization: when the caller has ALREADY just confirmed
  // (via its own getTaskAssignmentsDb call) that no rows exist yet for this
  // date, it can pass true here to skip this function's own identical
  // existing-check query below. Defaults to false, so every existing call
  // site (admin "Start/Regenerate Cycle", restore, trim, etc.) keeps doing
  // its own safe existing-check exactly as before — only
  // ensureTodayLineupIfEngineActive opts into this.
  assumeNoExisting: boolean = false
): Promise<{ generated: boolean; reason?: string; count: number; date: string; rows: any[] }> {
  // Admin accounts are logins, not team members doing SEO work — they
  // should never receive a Task Lineup of their own. Without this, an
  // admin's account (role: 'admin' in app_users) was being treated as just
  // another user by the generator, so it would show up as its own entry
  // in the admin's Daily Assignment Status calendar and in "Check
  // Pendings" — mixed in with actual team members, where it doesn't
  // belong. Filtering here (rather than at every call site) guarantees no
  // path into this function can ever assign work to an admin.
  users = users.filter((u) => (u.role || "user") !== "admin");

  // Only numeric-ID accounts (e.g. "1859") are real team members eligible
  // for a Task Lineup. Any leftover/legacy non-numeric app_users row
  // (name typed into the ID field, stray email, etc.) is excluded here so
  // it can never receive project assignments.
  users = users.filter((u) => /^\d+$/.test(String(u.email || "").trim()));

  const dow = new Date(dateStr + "T00:00:00Z").getUTCDay();
  if (dow === 0) {
    return { generated: false, reason: "Sundays are a rest day - no lineup is generated.", count: 0, date: dateStr, rows: [] };
  }

  const existing = assumeNoExisting ? [] : await getTaskAssignmentsDb({ date: dateStr });
  if (existing.length > 0 && !force) {
    return { generated: false, reason: "A lineup already exists for this date.", count: existing.length, date: dateStr, rows: existing };
  }
  if (existing.length > 0 && force) {
    await deleteTaskAssignmentsForDateDb(dateStr);
  }

  // Two app_users rows can end up sharing the same display name (a known
  // duplicate-account issue — see Admin Settings > Users), and a project's
  // "Users" column can also have a person's NAME typed in instead of their
  // real ID (a Google Sheets data-entry mistake) — both cases must resolve
  // to the SAME real person's canonical email, or the generator treats them
  // as different people and assigns the same project twice ("the same
  // person twice" in the Task Lineup). buildCanonicalEmailMap/
  // resolveCanonicalEmail (shared helpers, defined above) handle both
  // cases — do not re-implement this mapping inline here.
  const canonicalMap = buildCanonicalEmailMap(users);
  const pausedEmails = new Set<string>();
  users.forEach((u) => {
    const email = String(u.email || "").trim().toLowerCase();
    if (!email) return;
    if (u.paused) pausedEmails.add(email);
  });
  const canonicalOf = (rawEmail: string): string => resolveCanonicalEmail(rawEmail, canonicalMap);
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

  // Counts EVERY assignment so far this period — Pending or Done — not
  // just submitted ones. This is what makes "no carry-forward" work: a
  // project assigned (even if still Pending) already counts against its
  // period's target, so it naturally won't be re-offered until the target
  // has room again (next week for X1-X4, next month for X5). Nothing here
  // force-adds yesterday's still-Pending items to today's list.
  const countThisWeek = new Map<string, number>(); // `${userEmail}::${projectId}` -> count, Mon..yesterday
  const countThisMonth = new Map<string, number>(); // `${userEmail}::${projectId}` -> count, 1st..yesterday
  periodSoFar.forEach((a) => {
    const key = `${canonicalOf(a.userEmail)}::${a.projectId}`;
    if (a.date >= weekStart) countThisWeek.set(key, (countThisWeek.get(key) || 0) + 1);
    if (a.date >= monthStart) countThisMonth.set(key, (countThisMonth.get(key) || 0) + 1);
  });

  type Candidate = {
    userEmail: string;
    projectId: string;
    projectName: string;
    priority: string;
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
      // Not owed any more work for this period — including if it's still
      // sitting Pending from an earlier day this period — so skip it. It
      // will only become eligible again once the next period starts.
      if (deficit <= 0) return;

      if (!candidatesByUser.has(userEmail)) candidatesByUser.set(userEmail, []);
      candidatesByUser.get(userEmail)!.push({
        userEmail,
        projectId: p.id,
        projectName: p.name,
        priority,
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

  let insertOk = true;
  if (toInsert.length > 0) {
    insertOk = await insertTaskAssignmentsBulkDb(toInsert);
  }

  // `rows` only reflects what's actually confirmed saved — if the bulk
  // insert reported failure, callers that display `rows` directly (instead
  // of re-querying) must see an empty list, not rows that only exist in
  // memory. `generated`/`count` are left exactly as they were before (still
  // reporting the attempted count) so no existing caller's behavior changes.
  return { generated: true, count: toInsert.length, date: dateStr, rows: insertOk ? toInsert : [] };
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

  // Counts EVERY assignment so far this period — Pending or Done — so a
  // project already assigned (even if still un-submitted) naturally isn't
  // re-offered until its period's target has room again. No carry-forward.
  const countThisWeek = new Map<string, number>();
  const countThisMonth = new Map<string, number>();
  periodSoFar.forEach((a) => {
    if (a.date >= weekStart) countThisWeek.set(a.projectId, (countThisWeek.get(a.projectId) || 0) + 1);
    if (a.date >= monthStart) countThisMonth.set(a.projectId, (countThisMonth.get(a.projectId) || 0) + 1);
  });

  type Candidate = { projectId: string; projectName: string; priority: string; deficit: number };
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
    if (deficit <= 0) return;

    candidates.push({ projectId: p.id, projectName: p.name, priority, deficit });
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

// Guards ensureTodayLineupIfEngineActive against the case where two page
// loads land at the exact same instant, both see "nothing generated yet",
// and both start generating today's lineup independently. Keyed by date —
// the first caller starts the work and stores its promise here; anyone
// else who arrives while it's still running awaits that SAME promise
// instead of kicking off a second, redundant generation run. Cleared once
// the promise settles either way.
const inFlightAutoGeneration = new Map<string, ReturnType<typeof generateLineupForDate>>();

// Called on server startup (interval) and opportunistically whenever the
// Task Lineup screen is loaded. If the engine has been started, isn't
// paused, and today's lineup doesn't exist yet (and today isn't a Sunday),
// this generates it — so nobody ever has to remember to click "Start Cycle"
// again after the very first time.
//
// Returns today's date plus the assignment rows for today whenever it
// actually looked them up (either found them already there, or just
// generated them) — so a caller like GET /api/task-lineup, which is about
// to fetch that exact same date right after calling this, can reuse the
// result instead of firing an identical query a second time. Returns null
// when it didn't look anything up (engine inactive/paused, Sunday, or an
// error) — callers should fall back to fetching themselves in that case,
// same as before this returned anything.
export async function ensureTodayLineupIfEngineActive(): Promise<{ date: string; list: any[] } | null> {
  try {
    const state = await getLineupEngineStateDb();
    if (!state.active || state.paused) return null;
    const today = todayIST();
    if (new Date(today + "T00:00:00Z").getUTCDay() === 0) return null; // Sunday rest day
    const existing = await getTaskAssignmentsDb({ date: today });
    if (existing.length > 0) return { date: today, list: existing };

    let genPromise = inFlightAutoGeneration.get(today);
    if (!genPromise) {
      const [projects, users] = await Promise.all([getProjectsDb(), getUsersDb()]);
      // We just confirmed above that nothing exists yet for today, so tell
      // generateLineupForDate to skip its own repeat of that same check
      // (assumeNoExisting) — and use the rows it hands back directly instead
      // of re-querying Supabase a third time for data we just wrote.
      genPromise = generateLineupForDate(today, projects, users, false, true);
      inFlightAutoGeneration.set(today, genPromise);
      genPromise.finally(() => {
        // Only clear the slot if it's still OUR promise — guards against a
        // newer generation call (e.g. next day) having already replaced it.
        if (inFlightAutoGeneration.get(today) === genPromise) {
          inFlightAutoGeneration.delete(today);
        }
      });
    }
    const result = await genPromise;
    return { date: today, list: result.rows };
  } catch (err) {

    console.error("ensureTodayLineupIfEngineActive error:", err);
    return null;
  }
}

// Per-user rollup for the admin "Team Pause Controls" panel and the
// "Check Pendings" drill-down: total assignments ever made, yesterday's
// still-pending count, and the all-time still-pending count, for every
// configured user in one shot (avoids N round trips from the client).
//
// NOTE: these are always the real, true numbers for each person — never
// zeroed out just because that person happens to be paused right now. A
// paused person's own pending backlog is still useful information for an
// admin to see on their row ("Total: 248 · Pending: 15"). Excluding
// paused people only happens where these per-person numbers get POOLED
// together into one team-wide total (historyTotalPending /
// historyYesterdayPending in TaskLineup.tsx) — see the comment there.
export async function getPendingSummaryAllUsersDb(
  users: { email: string; name: string; role?: string; paused?: boolean }[]
): Promise<Array<{
  email: string;
  name: string;
  totalTasks: number;
  yesterdayPendingCount: number;
  totalPendingCount: number;
  yesterdayPending: any[];
  totalPending: any[];
}>> {
  // Same reasoning as generateLineupForDate: an admin login is not a team
  // member and should never appear in the per-user pending breakdown.
  users = users.filter((u) => (u.role || "user") !== "admin");

  const today = todayIST();
  const yesterday = addDays(today, -1);
  const all = await getTaskAssignmentsDb({ dateTo: today });

  // Same canonicalization as generateLineupForDate: two app_users rows can
  // share a display name but have different emails, AND a project's
  // "Users" column can have a person's NAME typed in instead of their real
  // ID — both resolve to one canonical email via the shared helpers below,
  // so the "Total" shown for a person's non-canonical email/name-typo row
  // isn't wrongly split off as its own tiny total.
  const canonicalMap = buildCanonicalEmailMap(users);
  const canonicalOf = (rawEmail: string): string => resolveCanonicalEmail(rawEmail, canonicalMap);

  const perUser = new Map<string, any[]>();
  all.forEach((a) => {
    const key = canonicalOf(String(a.userEmail || ""));
    if (!perUser.has(key)) perUser.set(key, []);
    perUser.get(key)!.push(a);
  });

  // Dedupe the users list itself before mapping: two app_users rows sharing
  // the same canonical name would otherwise both map their user_email
  // through canonicalOf() to the SAME bucket of rows, and each would appear
  // as its own separate entry in the returned array — meaning the exact
  // same pending items show up twice (once per duplicate account) anywhere
  // this summary is pooled across users (e.g. the History tab's pooled
  // "Total Pending" list). Keep only the first row seen per canonical key.
  const seenCanonical = new Set<string>();
  const dedupedUsers = users.filter((u) => {
    const key = canonicalOf(u.email);
    if (seenCanonical.has(key)) return false;
    seenCanonical.add(key);
    return true;
  });

  return dedupedUsers.map((u) => {
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

export async function saveManualRankingsDb(userKey: string, gridData: any): Promise<boolean> {
  const sb = getSupabase();
  if (sb && userKey) {
    try {
      const row = {
        id: `user:${userKey}`,
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
