import express from "express";
import path from "path";
import dotenv from "dotenv";
import { JWT } from "google-auth-library";
import nodemailer from "nodemailer";
import cron from "node-cron";
import dns from "dns";
import {
  isSupabaseConfigured,
  checkSupabaseTablesStatus,
  SUPABASE_SQL_SCHEMA,
  getProjectsDb,
  saveProjectsBulkDb,
  saveProjectDb,
  deleteProjectDb,
  getSubmissionsDb,
  saveSubmissionsBulkDb,
  appendSubmissionDb,
  updateSubmissionStatusDb,
  deleteSubmissionDb,
  clearSubmissionsDb,
  getAlertsDb,
  saveAlertDb,
  saveAlertsBulkDb,
  deleteAlertDb,
  getActivitiesDb,
  logActivityDb,
  clearActivitiesDb,
  getRankingsDb,
  saveRankingsDb,
  clearRankingsDb,
  getManualRankingsDb,
  saveManualRankingsDb,
  saveRankingHistoryDb,
  getRankingHistoryDb,
  getReportStateDb,
  setReportStateDb,
  getUsersDb,
  saveUserDb,
  deleteUserDb,
  setUserPausedDb,
  verifyUserCredentialsDb,
  renameUserDb,
  getTaskAssignmentsDb,
  generateLineupForDate,
  regenerateLineupForUserOnDateDb,
  backfillMissingLineupForDateDb,
  trimLineupToDailyCapForDateDb,
  markTaskAssignmentDoneDb,
  markTaskAssignmentPendingDb,
  deleteTaskAssignmentsForDateDb,
  deleteAllTaskAssignmentsDb,
  getLineupEngineStateDb,
  setLineupEngineStateDb,
  ensureTodayLineupIfEngineActive,
  getPendingSummaryAllUsersDb,
  buildCanonicalEmailMap,
  resolveCanonicalEmail,
  dedupeAssignmentsByCanonicalIdentity
} from "./src/lib/supabaseServer";
import { detectColumns } from "./src/lib/columnMapper";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// User email authentication mapping
const ALLOWED_ADMINS = [
  "8888",
];

const ALLOWED_USERS = [
  "1859",
  "9531",
  "5595",
  "4001",
];

const isUserAdmin = (email: string): boolean => {
  if (!email) return false;
  const emailLower = email.trim().toLowerCase();
  if (emailLower.includes("admin")) return true;
  if (emailLower === "8888") return true;
  if (ALLOWED_ADMINS.some(adm => adm.toLowerCase() === emailLower)) return true;
  return false;
};

// Server-side guard for destructive/admin-only endpoints.
// The frontend already hides these actions from non-admins, but that only
// controls the UI — anyone who calls the endpoint directly (curl, Postman,
// devtools) bypasses that. This checks the same x-user-email header the
// rest of the app already sends, against the authoritative isUserAdmin()
// check, and rejects the request server-side before any DB call runs.
const requireAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const email = req.headers['x-user-email'];
  if (!email || typeof email !== 'string' || !isUserAdmin(email)) {
    console.warn(`Blocked non-admin attempt to call ${req.method} ${req.originalUrl} from "${email || 'unknown'}"`);
    return res.status(403).json({ error: "Admin access required for this action." });
  }
  next();
};

// Straightforward userId equality — the Sheet is the single source of
// identity, so no hardcoded name/email synonym list is needed here.
const doesUserMatchBackend = (val: string, clientUserEmail: string): boolean => {
  if (!val || !clientUserEmail) return false;
  return val.trim().toLowerCase() === clientUserEmail.trim().toLowerCase();
};

const cleanEmailToNameOrUsername = (email: string): string => {
  if (!email) return "";
  const emailLower = email.trim().toLowerCase();
  if (emailLower.includes('@')) {
    return emailLower.split('@')[0];
  }
  return emailLower;
};

// Activity logging helper
const logActivityLocally = async (email: string, eventType: string, details: string) => {
  try {
    const activity = {
      id: `act-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      timestamp: new Date().toISOString(),
      userEmail: email,
      eventType,
      details,
      platform: "Web App"
    };
    await logActivityDb(activity);
  } catch (err) {
    console.error("Failed to log activity:", err);
  }
};

// ==========================================
// GOOGLE SHEETS INTERACTIVE DATABASE SYNC HELPER
// ==========================================
let cachedAccessToken: string | null = null;
let tokenExpiryTime = 0;


function mapRowsToProjects(rows: string[][]): any[] {
  if (rows.length === 0) return [];
  const headers = rows[0] || [];

  const colIdx = detectColumns(headers);
  const keywordColIdxs: number[] = colIdx.keywords;

  const projectRows = rows.slice(1);
  const mappedProjects = projectRows.map((row: any[]) => {
    const getVal = (idx: number, fallback: string = "") => {
      return (idx !== -1 && row[idx] !== undefined && row[idx] !== null) ? String(row[idx]).trim() : fallback;
    };

    const domain = getVal(colIdx.domain);
    const name = getVal(colIdx.name, domain || "Unnamed Project");
    
    const cleanDomain = domain.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    const id = cleanDomain || cleanName || `p-${Math.random().toString(36).substr(2, 9)}`;
    const code = name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase() || "PROJ";

    const location = getVal(colIdx.location, "Mumbai");
    const region = getVal(colIdx.region, "West");
    const usersStr = getVal(colIdx.users);
    const userId = getVal(colIdx.userId);
    const priority = getVal(colIdx.priority);
    const frequency = getVal(colIdx.frequency);

    const usersList = usersStr 
      ? usersStr.split(/[,;|]/).map((u: string) => u.trim().toLowerCase()).filter(Boolean) 
      : [];

    const keywords: string[] = [];
    keywordColIdxs.forEach(idx => {
      const val = getVal(idx);
      if (val && keywords.length < 8) {
        keywords.push(val);
      }
    });

    return {
      id,
      domain,
      name,
      code,
      location,
      region,
      users: usersList,
      userId,
      description: "",
      priority,
      frequency,
      keywords
    };
  }).filter((p: any) => p.name);

  const deduplicatedMap = new Map<string, any>();
  mappedProjects.forEach((p) => {
    if (deduplicatedMap.has(p.id)) {
      const existing = deduplicatedMap.get(p.id)!;
      const combinedUsers = Array.from(new Set([
        ...(existing.users || []),
        ...(p.users || [])
      ].map(u => String(u).trim().toLowerCase())));
      const combinedKeywords = Array.from(new Set([
        ...(existing.keywords || []),
        ...(p.keywords || [])
      ].map(k => String(k).trim())));

      deduplicatedMap.set(p.id, {
        ...existing,
        ...p,
        users: combinedUsers,
        keywords: combinedKeywords.slice(0, 8),
        location: existing.location !== "Mumbai" ? existing.location : p.location,
        region: existing.region !== "West" ? existing.region : p.region,
        userId: existing.userId || p.userId
      });
    } else {
      deduplicatedMap.set(p.id, p);
    }
  });

  return Array.from(deduplicatedMap.values());
}

function colIndexToLetter(index: number): string {
  let temp = index;
  let letter = "";
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}


function parseCSV(csvText: string): string[][] {
  const lines: string[][] = [];
  const rows = csvText.split(/\r?\n/);
  for (const row of rows) {
    if (!row.trim()) continue;
    const fields: string[] = [];
    let currentField = "";
    let insideQuotes = false;
    for (let i = 0; i < row.length; i++) {
      const char = row[i];
      if (char === '"') {
        insideQuotes = !insideQuotes;
      } else if (char === ',' && !insideQuotes) {
        fields.push(currentField);
        currentField = "";
      } else {
        currentField += char;
      }
    }
    fields.push(currentField);
    lines.push(fields.map(f => f.trim().replace(/^"|"$/g, '').trim()));
  }
  return lines;
}



// API ENDPOINTS
// ==========================================

// GET Auth configurations for sync
app.get("/api/auth/config", (req, res) => {
  const filteredUsers = ALLOWED_USERS.filter(u => !isUserAdmin(u));
  res.json({
    allowedAdmins: ALLOWED_ADMINS,
    allowedUsers: filteredUsers
  });
});

app.post("/api/auth/login-verify", async (req, res) => {
  try {
    const { userId, passkey } = req.body;
    if (!userId || !passkey) {
      return res.status(400).json({ success: false, error: "User ID and Passkey are required." });
    }
    const id = String(userId).trim();

    const dbResult = await verifyUserCredentialsDb(id, String(passkey).trim());
    if (dbResult) {
      logActivityLocally(id.toLowerCase(), "User Login", `Successfully logged in as ${dbResult.role === 'admin' ? 'Admin' : 'Standard Employee'}`);
      return res.json({ success: true, role: dbResult.role, name: dbResult.name });
    }

    const legacy = LEGACY_CREDENTIALS[id];
    if (legacy && legacy.passkey === String(passkey).trim()) {
      logActivityLocally(id.toLowerCase(), "User Login", `Successfully logged in as ${legacy.role === 'admin' ? 'Admin' : 'Standard Employee'} (legacy credentials — run the app_users SQL migration)`);
      return res.json({ success: true, role: legacy.role, name: legacy.role === 'admin' ? 'Admin' : `User ${id}` });
    }

    return res.status(401).json({ success: false, error: "Invalid User ID or Passkey." });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST verify user login email
app.post("/api/auth/verify", (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ allowed: false, error: "Email is required." });
  }

  const emailLower = email.trim().toLowerCase();
  const isAdmin = isUserAdmin(emailLower);

  // No auto-creation: an unrecognized ID is simply not added here. New
  // users must be created explicitly by an admin (POST /api/users), which
  // also enforces the numeric-only userId rule.

  const filteredUsers = ALLOWED_USERS
    .filter(u => !isUserAdmin(u))
    .map(u => cleanEmailToNameOrUsername(u));

  logActivityLocally(emailLower, "User Login", `Successfully logged in as ${isAdmin ? "Admin" : "Standard Employee"}`);

  return res.json({
    allowed: true,
    role: isAdmin ? "admin" : "user",
    allowedAdmins: ALLOWED_ADMINS,
    allowedUsers: filteredUsers
  });
});

// POST record a successful login timestamp (used for "Last Logged In" on admin side)
app.post("/api/activity/login", async (req, res) => {
  try {
    const { userEmail, role } = req.body;
    if (!userEmail || typeof userEmail !== 'string') {
      return res.status(400).json({ error: "userEmail is required." });
    }
    const emailLower = userEmail.trim().toLowerCase();
    await logActivityLocally(
      emailLower,
      "User Login",
      `Successfully logged in as ${role === 'admin' ? 'Admin' : 'Standard Employee'}`
    );
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET configuration diagnostics status (indicating Google Sheets and fallback status)
app.get("/api/config-status", async (req, res) => {
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  let serviceAccountConfigured = false;
  let serviceAccountEmail = "Not Configured";
  let fetchStatus = { ok: true, error: "" };
  
  if (saJson) {
    try {
      const sa = JSON.parse(saJson.trim());
      serviceAccountConfigured = true;
      serviceAccountEmail = sa.client_email || "Configured";
    } catch (e: any) {
      fetchStatus = { ok: false, error: "Failed to parse service account JSON: " + e.message };
    }
  }

  let tokenSuccess = false;
  let tokenError = "";
  if (serviceAccountConfigured && fetchStatus.ok) {
    try {
      const token = await getGoogleAccessToken();
      if (token) {
        tokenSuccess = true;
      } else {
        tokenError = "Google OAuth endpoint rejected credentials (e.g. Invalid JWT Signature or Revoked Key)";
      }
    } catch (err: any) {
      tokenError = err.message;
    }
  }

  let dbStatus = { ok: true, error: "Using local fallback (Supabase not configured)" };
  if (isSupabaseConfigured()) {
    const status = await checkSupabaseTablesStatus();
    dbStatus = { ok: status.ok, error: status.error };
  }

  res.json({
    serviceAccountConfigured,
    serviceAccountEmail,
    projectsSpreadsheetId: process.env.GOOGLE_SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID,
    logsSpreadsheetId: process.env.GOOGLE_SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID,
    fetchStatus: (serviceAccountConfigured && tokenSuccess) ? { ok: true, error: "" } : { ok: false, error: tokenError || "Authentication offline / Fallback active" },
    databaseStatus: dbStatus,
    supabaseConfigured: isSupabaseConfigured(),
    supabaseSchemaSql: SUPABASE_SQL_SCHEMA
  });
});

// GET All Projects
app.get("/api/projects", async (req, res) => {
  try {
    // NOTE: Auto-sync from Google Sheets on every load has been removed.
    // Supabase is now the source of truth. Use POST /api/projects/sync-from-sheet
    // to explicitly pull fresh data from the Sheet when you want to.
    let list = await getProjectsDb();

    const clientUserEmail = req.headers['x-user-email'];
    const clientUserRole = req.headers['x-user-role'];
    if (clientUserEmail && typeof clientUserEmail === 'string' && clientUserRole !== 'admin') {
      const emailLower = clientUserEmail.trim().toLowerCase();
      list = list.filter((p: any) => {
        const assigned = Array.isArray(p.users) ? p.users : [];
        const matchesUsers = assigned.some((u: string) => doesUserMatchBackend(u, emailLower));
        const matchesUserId = p.userId && doesUserMatchBackend(String(p.userId), emailLower);
        return matchesUsers || matchesUserId;
      });
    }

    return res.json(list);
  } catch (err: any) {
    console.error("GET /api/projects error:", err);
    return res.json([]);
  }
});

// ADD, EDIT, DELETE Projects
// Strips protocol (http/https), "www.", any trailing path/slash, so every
// project is always stored as a bare domain like "example.com".
const normalizeDomain = (raw: string): string => {
  if (!raw) return raw;
  let d = String(raw).trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "");
  d = d.replace(/^www\./, "");
  d = d.split("/")[0];
  d = d.split("?")[0];
  return d.trim();
};

app.post("/api/projects", async (req, res) => {
  const { action, project } = req.body;
  try {
    if (action === "delete") {
      const email = req.headers['x-user-email'];
      if (!email || typeof email !== 'string' || !isUserAdmin(email)) {
        console.warn(`Blocked non-admin attempt to delete project from "${email || 'unknown'}"`);
        return res.status(403).json({ error: "Admin access required to delete a project." });
      }
    }
    if (action === "add" && project) {
      project.domain = normalizeDomain(project.domain);
      project.id = project.domain.toLowerCase().replace(/[^a-z0-9]/g, "-") || `p-${Date.now()}`;
      await saveProjectDb(project);
    } else if (action === "edit" && project) {
      project.domain = normalizeDomain(project.domain);
      await saveProjectDb(project);
      try {
        await updateProjectInGoogleSheet(project);
      } catch (sheetErr: any) {
        console.error("Failed to update project in Google Sheets:", sheetErr.message);
      }
    } else if (action === "delete" && project) {
      await deleteProjectDb(project.id);
    }

    const updatedList = await getProjectsDb();

    const userEmail = req.headers['x-user-email'] || "Admin";
    await logActivityLocally(String(userEmail), `${action === 'add' ? 'CREATE' : action === 'edit' ? 'EDIT' : 'DELETE'} Project`, `${action === 'add' ? 'Created' : action === 'edit' ? 'Edited' : 'Deleted'} project: "${project?.name || project?.domain || 'unnamed'}"`);

    return res.json({ success: true, list: updatedList });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// MANUAL SYNC: Pull latest data from Google Sheet into Supabase, on demand only.
// This is the ONLY place Google Sheet data now overwrites Supabase project data.
// Call this from an admin "Sync from Sheet" button, not automatically on page load.
app.post("/api/projects/sync-from-sheet", async (req, res) => {
  try {
    const email = req.headers['x-user-email'];
    if (!email || typeof email !== 'string' || !isUserAdmin(email)) {
      console.warn(`Blocked non-admin attempt to sync projects from Sheet: "${email || 'unknown'}"`);
      return res.status(403).json({ error: "Admin access required to sync from Sheet." });
    }

    const result = await syncProjectsFromGoogleSheet();
    const list = await getProjectsDb();

    await logActivityLocally(String(email), "SYNC Projects", `Manually synced ${result?.length ?? 0} project(s) from Google Sheet into the database.`);

    return res.json({ success: true, syncedCount: result?.length ?? 0, list });
  } catch (err: any) {
    console.error("POST /api/projects/sync-from-sheet error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// Manage the dedicated Users table (clean source for the admin Users dropdown)
// GET the dedicated Users table (id, name, role, paused — never passkey).
// Used to populate the Admin Control panel's user list + reassign dropdown.
app.get("/api/users", async (req, res) => {
  try {
    const list = await getUsersDb();
    return res.json({ success: true, users: list });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/users", async (req, res) => {
  const email = req.headers['x-user-email'];
  if (!email || typeof email !== 'string' || !isUserAdmin(email)) {
    return res.status(403).json({ error: "Admin access required to add a user." });
  }
  const { userId, name, passkey, role } = req.body;
  if (!userId || !name) {
    return res.status(400).json({ error: "userId and name are required." });
  }
  if (!/^\d+$/.test(String(userId).trim())) {
    return res.status(400).json({ error: "userId must be numeric only (e.g. 1859)." });
  }
  try {
    const ok = await saveUserDb(
      String(userId).trim(),
      String(name).trim(),
      passkey ? String(passkey).trim() : undefined,
      role === 'admin' ? 'admin' : 'user'
    );
    if (!ok) return res.status(500).json({ error: "Failed to save user." });
    const list = await getUsersDb();
    await logActivityLocally(String(email), "CREATE User", `Added user "${name}" (ID: ${userId})`);
    return res.json({ success: true, users: list });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Rename a user's login ID and/or display name and/or passkey. Cascades the
// ID + name change onto every project currently assigned to them.
app.post("/api/users/rename", async (req, res) => {
  const email = req.headers['x-user-email'];
  if (!email || typeof email !== 'string' || !isUserAdmin(email)) {
    return res.status(403).json({ error: "Admin access required to rename a user." });
  }
  const { oldUserId, newUserId, newName, newPasskey } = req.body;
  if (!oldUserId || !newUserId || !newName) {
    return res.status(400).json({ error: "oldUserId, newUserId and newName are required." });
  }
  try {
    const ok = await renameUserDb(
      String(oldUserId).trim(),
      String(newUserId).trim(),
      String(newName).trim(),
      newPasskey ? String(newPasskey).trim() : undefined
    );
    if (!ok) return res.status(500).json({ error: "Failed to rename user." });
    const list = await getUsersDb();
    const projects = await getProjectsDb();
    await logActivityLocally(String(email), "RENAME User", `Renamed user "${oldUserId}" -> "${newUserId}" (${newName})`);
    return res.json({ success: true, users: list, projects });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.delete("/api/users/:userId", async (req, res) => {
  const email = req.headers['x-user-email'];
  if (!email || typeof email !== 'string' || !isUserAdmin(email)) {
    return res.status(403).json({ error: "Admin access required to delete a user." });
  }
  try {
    const ok = await deleteUserDb(req.params.userId);
    if (!ok) return res.status(500).json({ error: "Failed to delete user." });
    const list = await getUsersDb();
    await logActivityLocally(String(email), "DELETE User", `Deleted user "${req.params.userId}"`);
    return res.json({ success: true, users: list });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Reassign a project from one user to another. Since project.userId/users
// gets fully overwritten (not appended), the project automatically stops
// showing up for the previous user the moment this succeeds.
app.post("/api/projects/reassign", async (req, res) => {
  const email = req.headers['x-user-email'];
  if (!email || typeof email !== 'string' || !isUserAdmin(email)) {
    return res.status(403).json({ error: "Admin access required to reassign a project." });
  }
  const { projectId, newUserId, newUserName } = req.body;
  if (!projectId || !newUserId || !newUserName) {
    return res.status(400).json({ error: "projectId, newUserId and newUserName are required." });
  }
  try {
    const allProjects = await getProjectsDb();
    const existing = allProjects.find((p: any) => p.id === projectId);
    if (!existing) return res.status(404).json({ error: "Project not found." });

    const previousUser = existing.userId || (existing.users && existing.users[0]) || "Unassigned";
    // ROOT BUG (found and fixed): this used to write `users: [newUserName]`
    // — the person's display NAME — instead of their real ID. The Task
    // Lineup engine reads `project.users` as a list of assignee IDs
    // (generateLineupForDate), so every reassignment was silently planting
    // a phantom "user" whose ID was literally someone's name (e.g.
    // "kavita mishra" instead of "5595"). That phantom then got its own
    // full, separate lineup generated for it — showing up as the SAME
    // person appearing twice in the admin's Task Lineup with two
    // different sets of projects. Both `userId` and `users` must hold the
    // real ID, never the display name.
    const updatedProject = {
      ...existing,
      userId: String(newUserId).trim(),
      users: [String(newUserId).trim()]
    };
    const ok = await saveProjectDb(updatedProject);
    if (!ok) return res.status(500).json({ error: "Failed to reassign project." });

    const list = await getProjectsDb();
    await logActivityLocally(String(email), "REASSIGN Project", `Reassigned "${existing.name || existing.domain}" from "${previousUser}" to "${newUserName}" (${newUserId})`);
    return res.json({ success: true, list });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET filters combinations
app.get("/api/filters", async (req, res) => {
  try {
    // NOTE: Both project AND submissions auto-sync are removed — Supabase is
    // the sole source of truth now. Use manual sync endpoints when you
    // actually want to pull fresh data from the Sheet.
    let projectsArr = await getProjectsDb();

    const clientUserEmail = req.headers['x-user-email'];
    const clientUserRole = req.headers['x-user-role'];
    if (clientUserEmail && typeof clientUserEmail === 'string' && clientUserRole !== 'admin') {
      const emailLower = clientUserEmail.trim().toLowerCase();
      projectsArr = projectsArr.filter((p: any) => {
        const assigned = Array.isArray(p.users) ? p.users : [];
        const matchesUsers = assigned.some((u: string) => doesUserMatchBackend(u, emailLower));
        const matchesUserId = p.userId && doesUserMatchBackend(String(p.userId), emailLower);
        return matchesUsers || matchesUserId;
      });
    }

    const uniqueRegions = new Set<string>();

    projectsArr.forEach((p: any) => {
      if (p.region) uniqueRegions.add(p.region);
    });


    if (uniqueRegions.size === 0) {
      uniqueRegions.add("North");
      uniqueRegions.add("West");
      uniqueRegions.add("South");
    }

    // Users dropdown/list now comes ONLY from the dedicated app_users table —
    // no more deriving/guessing names from projects.users, projects.user_id,
    // or submissions.user_email (that guessing logic was the root cause of
    // project names leaking into the users dropdown). Admin-role accounts
    // are excluded here too — admins are logins, not team members, and
    // without this filter the admin's own account was showing up as a
    // normal "user" row (with a Pause button) in Task Lineup's Controls
    // panel, since that panel just renders every entry in this list.
    const dbUsers = await getUsersDb();
    const finalUsers = dbUsers
      .filter((u: any) => (u.role || "user") !== "admin")
      .map((u: any) => ({ email: u.email, name: u.name, paused: !!u.paused }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return res.json({
      projects: projectsArr,
      locations: [],
      regions: Array.from(uniqueRegions).sort(),
      users: finalUsers
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// TASK LINEUP (auto-assignment engine)
// =========================================================================

// GET today's (or any given date's) lineup. Admins get everyone's; a
// non-admin only ever gets their own rows regardless of what's asked for.
app.get("/api/task-lineup", async (req, res) => {
  try {
    const date = typeof req.query.date === "string" && req.query.date ? req.query.date : new Date().toISOString().slice(0, 10);
    const clientUserEmail = req.headers["x-user-email"];
    const clientUserRole = req.headers["x-user-role"];

    // Opportunistic auto-generate: if the engine has been started and isn't
    // paused, make sure today's lineup exists before answering. Cheap no-op
    // once today's lineup is already there.
    await ensureTodayLineupIfEngineActive();

    let list = await getTaskAssignmentsDb({ date });

    // Collapse duplicate-account rows (same real person, two login emails)
    // onto one canonical email before returning — this is what fixes the
    // admin's Daily Assignment Status calendar showing the same project
    // "repeated" under one person, and makes sure a Work Log submitted
    // under a non-canonical email still reads as Submitted here.
    const users = await getUsersDb();
    const canonicalMap = buildCanonicalEmailMap(users);
    list = dedupeAssignmentsByCanonicalIdentity(list, canonicalMap);

    // Admin logins are not team members and should never appear as a
    // "user" in this list — generateLineupForDate now refuses to create
    // new rows for them, but this also strips out any older rows that
    // were generated for an admin account before that fix, so the
    // calendar/pending views clear up immediately without a DB cleanup.
    const adminEmails = new Set(
      users.filter((u: any) => (u.role || "user") === "admin").map((u: any) => String(u.email || "").trim().toLowerCase())
    );
    list = list.filter((a: any) => !adminEmails.has(a.userEmail));

    if (clientUserRole !== "admin" && typeof clientUserEmail === "string" && clientUserEmail) {
      const emailLower = resolveCanonicalEmail(clientUserEmail, canonicalMap);
      list = list.filter((a: any) => a.userEmail === emailLower);
    }
    return res.json({ date, assignments: list });
  } catch (err: any) {
    console.error("GET /api/task-lineup error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// POST generate (or, with force:true, regenerate) the lineup for a date.
// Admin-only — this is the "Start Cycle" button in the Task Lineup tab.
app.post("/api/task-lineup/generate", requireAdmin, async (req, res) => {
  try {
    const date = req.body?.date || new Date().toISOString().slice(0, 10);
    const force = !!req.body?.force;

    const projects = await getProjectsDb();
    const users = await getUsersDb();

    const result = await generateLineupForDate(date, projects, users, force);
    return res.json(result);
  } catch (err: any) {
    console.error("POST /api/task-lineup/generate error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// POST full reset — this is the "Delete" button. It wipes EVERY task
// assignment ever created (every user, every date, not just the date that
// happened to be on screen), so Yesterday Pending / Total Pending drop back
// to 0 everywhere right away. It also resets the lifetime engine state back
// to inactive, so the UI shows "Start Cycle" again afterwards instead of
// "Resume Cycle" — a real restart, not a paused cycle picking back up.
app.post("/api/task-lineup/delete", requireAdmin, async (req, res) => {
  try {
    const existing = await getTaskAssignmentsDb({});
    const ok = await deleteAllTaskAssignmentsDb();
    await setLineupEngineStateDb({ active: false, paused: false });
    return res.json({ success: ok, deletedCount: existing.length });
  } catch (err: any) {
    console.error("POST /api/task-lineup/delete error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// GET a per-user pending summary: yesterday's un-worked assignments (which
// get carried into today's lineup automatically) and the all-time rolling
// count of every assignment still sitting at "Pending".
app.get("/api/task-lineup/pending-summary", async (req, res) => {
  try {
    const clientUserEmail = req.headers["x-user-email"];
    const clientUserRole = req.headers["x-user-role"];
    const requestedEmail = typeof req.query.userEmail === "string" ? req.query.userEmail : undefined;

    const rawUserEmail = clientUserRole === "admin" ? requestedEmail : (typeof clientUserEmail === "string" ? clientUserEmail : undefined);
    if (!rawUserEmail) {
      return res.json({ yesterdayPending: [], totalPendingCount: 0, totalPending: [] });
    }

    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    // Same canonicalization the Daily Assignment Status calendar already
    // uses (GET /api/task-lineup) — that's exactly why the calendar is
    // accurate and this endpoint wasn't. Previously this route matched the
    // raw x-user-email/userEmail header directly against task_assignments,
    // with no canonicalization and no dedupe at all. If a stray row was
    // ever filed under a different spelling of the same person's identity
    // (a second login email, or a project's "Users" column with their NAME
    // typed in instead of their ID), it was invisible here even though it
    // was still sitting in the table — so Yesterday Pending / Total
    // Pending silently disagreed with the calendar. Now both draw from the
    // exact same canonicalized source. NOTE: this only folds duplicate
    // rows that resolve to ONE real, unambiguous account — it deliberately
    // never merges two different real people together (see
    // buildCanonicalEmailMap), so this fix cannot reintroduce that bug.
    const users = await getUsersDb();
    const canonicalMap = buildCanonicalEmailMap(users);
    const canonicalUserEmail = resolveCanonicalEmail(rawUserEmail, canonicalMap);

    const yesterdayPending = dedupeAssignmentsByCanonicalIdentity(
      await getTaskAssignmentsDb({ date: yesterday, status: "Pending" }),
      canonicalMap
    ).filter((a: any) => a.userEmail === canonicalUserEmail);

    const totalPending = dedupeAssignmentsByCanonicalIdentity(
      await getTaskAssignmentsDb({ dateTo: today, status: "Pending" }),
      canonicalMap
    ).filter((a: any) => a.userEmail === canonicalUserEmail);

    return res.json({
      yesterdayPending,
      totalPendingCount: totalPending.length,
      totalPending
    });
  } catch (err: any) {
    console.error("GET /api/task-lineup/pending-summary error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// POST toggle a user's pause state (admin only).
// - Pausing: TODAY's already-generated lineup for this user is left exactly
//   as it is — nothing gets cleared, and anything already Submitted stays
//   Submitted. Pausing only stops them from being picked up by FUTURE
//   generation runs (generateLineupForDate skips paused users entirely —
//   see rawPausedByCanonical in supabaseServer.ts), so tomorrow's lineup
//   simply won't include them while they're paused.
//   (Previously this cleared today's still-Pending rows immediately, which
//   is exactly what was wiping out a lineup the user hadn't finished
//   working yet, even though they were only meant to be paused starting
//   the next day.)
// - Resuming: today's row is left alone (it was never touched, so it's
//   already there / still visible). `regenerateLineupForUserOnDateDb` is
//   still called as a safety net for the one case where today's lineup
//   never existed for this user in the first place (e.g. they were paused
//   before the day's cycle ever ran for them) — it's a no-op if a row for
//   today already exists, so it can never duplicate or overwrite anything.
app.post("/api/task-lineup/pause", requireAdmin, async (req, res) => {
  try {
    const { userEmail, paused } = req.body;
    if (!userEmail || typeof paused !== "boolean") {
      return res.status(400).json({ error: "userEmail and paused (boolean) are required." });
    }
    const normalizedEmail = String(userEmail).trim().toLowerCase();
    const ok = await setUserPausedDb(normalizedEmail, paused);
    const today = new Date().toISOString().slice(0, 10);

    if (!paused) {
      try {
        const [projects, users] = await Promise.all([getProjectsDb(), getUsersDb()]);
        const me = users.find((u: any) => String(u.email || "").trim().toLowerCase() === normalizedEmail);
        if (me) {
          await regenerateLineupForUserOnDateDb(today, projects, { email: normalizedEmail, name: me.name });
        }
      } catch (fillErr: any) {
        console.error("Failed to refill lineup after resuming user:", fillErr.message);
      }
    }

    return res.json({ success: ok });
  } catch (err: any) {
    console.error("POST /api/task-lineup/pause error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// POST one-time repair for the old Pause / Stop Cycle bug: refills TODAY's
// (or a given date's) lineup for every eligible, non-paused user who
// currently has ZERO assignment rows for that date — i.e. whoever's lineup
// got hard-deleted by the old behavior. Anyone who already has rows for the
// date (submitted or still pending) is left completely untouched. Safe to
// call more than once — it's a no-op for anyone already restored.
app.post("/api/task-lineup/restore", requireAdmin, async (req, res) => {
  try {
    const date = req.body?.date || new Date().toISOString().slice(0, 10);
    const [projects, users] = await Promise.all([getProjectsDb(), getUsersDb()]);
    const result = await backfillMissingLineupForDateDb(date, projects, users);
    return res.json({ success: true, date, ...result });
  } catch (err: any) {
    console.error("POST /api/task-lineup/restore error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// POST one-time repair: trims any user back down to DAILY_LINEUP_CAP_PER_USER
// (15) for a given date if the Restore Lineup flow over-added and pushed
// them past it (e.g. showing 30 instead of 15). Removes the MOST RECENTLY
// CREATED rows first — i.e. the "added later" ones — and never touches a
// row already marked Done.
app.post("/api/task-lineup/trim", requireAdmin, async (req, res) => {
  try {
    const date = req.body?.date || new Date().toISOString().slice(0, 10);
    const result = await trimLineupToDailyCapForDateDb(date);
    return res.json({ success: true, date, ...result });
  } catch (err: any) {
    console.error("POST /api/task-lineup/trim error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// GET the engine's lifetime state — has it ever been started, and is it
// currently paused (the long-vacation switch)?
app.get("/api/task-lineup/engine-status", async (req, res) => {
  try {
    const state = await getLineupEngineStateDb();
    return res.json(state);
  } catch (err: any) {
    console.error("GET /api/task-lineup/engine-status error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// POST start the engine (admin only, one-time action). Marks the cycle
// "active" for life and immediately generates today's lineup if it doesn't
// exist yet. After this, the cycle keeps generating every day on its own —
// no more daily manual clicks.
app.post("/api/task-lineup/engine/start", requireAdmin, async (req, res) => {
  try {
    const ok = await setLineupEngineStateDb({ active: true, paused: false });
    if (!ok) {
      return res.status(500).json({ error: "Failed to save the cycle state to the database — check server logs / Supabase connection." });
    }
    await ensureTodayLineupIfEngineActive();
    const state = await getLineupEngineStateDb();
    // Verify the write actually stuck before telling the client it worked —
    // upsert() can report no error yet still not persist (e.g. RLS silently
    // rejecting the row), so re-reading and comparing catches that case.
    if (!state.active) {
      console.error("Lineup engine start mismatch: wrote active=true but DB reads back active=false");
      return res.status(500).json({ error: "Cycle state did not persist correctly — please try again." });
    }
    return res.json({ success: true, ...state });
  } catch (err: any) {
    console.error("POST /api/task-lineup/engine/start error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// POST pause/resume the whole engine (admin only) — the "Stop Cycle" /
// "Run Cycle" switch. Stopping does NOT touch any existing assignment —
// TODAY's lineup (including whatever is still Pending) stays exactly as it
// is and stays visible/workable for everyone. All Stop Cycle does is skip
// the auto-generate step for any day the engine is paused on, so no NEW
// lineup gets created for tomorrow (or any later day) while stopped.
// Resuming doesn't need to "refill" anything: ensureTodayLineupIfEngineActive
// only generates when today's date has no lineup yet, so —
//   - resuming the SAME day it was stopped: today's lineup is already there
//     (never cleared), so this is a no-op and it just picks back up as-is.
//   - resuming on a LATER day: that day never got a lineup while stopped,
//     so this generates a fresh NEW lineup for it, same as any normal day.
app.post("/api/task-lineup/engine/pause", requireAdmin, async (req, res) => {
  try {
    const { paused } = req.body;
    if (typeof paused !== "boolean") {
      return res.status(400).json({ error: "paused (boolean) is required." });
    }
    // Previously the write's success/failure was never checked here — if the
    // Supabase upsert silently failed (bad connection, RLS, etc.) this route
    // still re-read whatever the OLD value was and returned it wrapped in
    // `success: true`. The frontend trusted that and showed "Cycle paused"
    // even though the DB still had paused=false — which is exactly why the
    // cycle looked "already started" again after relogin. Now we check the
    // write result AND verify the value actually stuck before reporting
    // success.
    const ok = await setLineupEngineStateDb({ paused });
    if (!ok) {
      return res.status(500).json({ error: "Failed to save the cycle's paused state — check server logs / Supabase connection." });
    }

    if (!paused) {
      await ensureTodayLineupIfEngineActive();
    }
    const state = await getLineupEngineStateDb();
    if (state.paused !== paused) {
      console.error(`Lineup engine pause mismatch: requested paused=${paused} but DB reads back paused=${state.paused}`);
      return res.status(500).json({ error: "Cycle state did not persist correctly — please try again." });
    }
    return res.json({ success: true, ...state });
  } catch (err: any) {
    console.error("POST /api/task-lineup/engine/pause error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// GET a one-shot rollup of every user's total tasks, yesterday-pending count,
// and total-pending count — powers both the Team Pause Controls stats and
// the admin "Check Pendings" drill-down list. Admin only.
app.get("/api/task-lineup/pending-summary/all", requireAdmin, async (req, res) => {
  try {
    const users = await getUsersDb();
    const summary = await getPendingSummaryAllUsersDb(users);
    return res.json({ users: summary });
  } catch (err: any) {
    console.error("GET /api/task-lineup/pending-summary/all error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// GET Submissions Logs
app.get("/api/submissions", async (req, res) => {
  try {
    // NOTE: Auto-sync from Google Sheets removed — Supabase is the source of
    // truth now (same reasoning as projects). Sync manually if/when needed.
    let list = await getSubmissionsDb();
    return res.json(list);
  } catch (err: any) {
    console.error("GET /api/submissions error:", err);
    return res.json([]);
  }
});

// POST Log DSR Submission
app.post("/api/submissions/append", async (req, res) => {
  const { works, date, userEmail } = req.body;
  if (!userEmail || !works || !Array.isArray(works)) {
    return res.status(400).json({ error: "Missing required submission parameters." });
  }

  // NOTE: submissions are upserted with onConflict:"id" in Supabase, so a
  // colliding id here would silently overwrite another user's submission
  // instead of creating a new row. Date.now() alone is only millisecond
  // resolution and WILL collide if two people submit around the same
  // instant, so a random suffix is required to keep ids unique.
  const submissionId = `dsr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = new Date().toISOString();

  try {
    const worksWithIds = works.map((w: any, index: number) => ({
      ...w,
      id: `${submissionId}-${index}`
    }));

    const newEntry = {
      id: submissionId,
      date,
      userEmail,
      works: worksWithIds,
      createdAt
    };

    const dbSaved = await appendSubmissionDb(newEntry);
    if (!dbSaved) {
      console.error(`Submission "${submissionId}" was NOT saved to Supabase — check server logs for the underlying database error. It only exists in the submitter's local browser state right now.`);
    }

    // Flip any Task Lineup assignment(s) covering the same project/user/date
    // to "Done" now that a Work Log actually came in for it. Assignments
    // are generated under a person's CANONICAL email (see
    // buildCanonicalEmailMap), so if this submitter is logged in under a
    // different (non-canonical) duplicate account email, matching on the
    // raw userEmail would silently miss the row and the admin's calendar
    // would keep showing "Not Submitted" forever. Resolve to canonical
    // first so the flip always lands on the right row.
    try {
      const usersForCanonical = await getUsersDb();
      const canonicalMapForSubmission = buildCanonicalEmailMap(usersForCanonical);
      const canonicalSubmitterEmail = resolveCanonicalEmail(userEmail, canonicalMapForSubmission);

      const seenProjectIds = new Set<string>();
      for (const w of worksWithIds) {
        if (w.projectId && !seenProjectIds.has(w.projectId)) {
          seenProjectIds.add(w.projectId);
          await markTaskAssignmentDoneDb(date, canonicalSubmitterEmail, w.projectId);
        }
      }
    } catch (lineupErr: any) {
      console.error("Failed to update Task Lineup status from submission:", lineupErr.message);
    }

    await logActivityLocally(userEmail, "DSR Submission", `Submitted Work Log for date ${date} containing ${works.length} project block(s).`);

    // Append to Google Sheets
    try {
      await appendSubmissionToGoogleSheet(worksWithIds, date, userEmail, createdAt);
    } catch (sheetErr: any) {
      console.error("Failed to append to Google Sheets:", sheetErr.message);
    }

    const updatedList = await getSubmissionsDb();
    return res.json({ success: true, dbSaved, list: updatedList });
  } catch (err: any) {
    console.error("POST /api/submissions/append error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// PATCH update the status of a single DSR submission/log (admin only)
app.patch("/api/submissions/:id/status", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const actorEmail = String(req.headers["x-user-email"] || "unknown");

  if (!id) {
    return res.status(400).json({ error: "Missing submission id." });
  }
  if (!status || !["Pending", "Approved", "Needs Revision", "Remark"].includes(status)) {
    return res.status(400).json({ error: "Invalid status value." });
  }

  try {
    const updated = await updateSubmissionStatusDb(id, status);
    if (!updated) {
      return res.status(500).json({ error: "Failed to update submission status in database." });
    }

    await logActivityLocally(actorEmail, "Status Update", `Marked work log submission "${id}" as ${status}.`);

    const updatedList = await getSubmissionsDb();
    return res.json({ success: true, list: updatedList });
  } catch (err: any) {
    console.error("PATCH /api/submissions/:id/status error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// DELETE a single DSR submission/log (admin only)
app.delete("/api/submissions/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const actorEmail = String(req.headers["x-user-email"] || "unknown");

  if (!id) {
    return res.status(400).json({ error: "Missing submission id." });
  }

  try {
    // Grab the submission BEFORE deleting it — we need its date/user/project
    // list afterwards to flip the matching Task Lineup assignment(s) back to
    // "Pending", now that the Work Log that marked them "Done" is gone.
    const allSubmissions = await getSubmissionsDb();
    const target = allSubmissions.find((s: any) => s.id === id);

    const deleted = await deleteSubmissionDb(id);
    if (!deleted) {
      return res.status(500).json({ error: "Failed to delete submission from database." });
    }

    if (target && Array.isArray(target.works)) {
      try {
        // Same canonical-email resolution as the append route above, so
        // reverting a deleted log back to "Pending" hits the same
        // assignment row that was flipped to "Done" in the first place.
        const usersForCanonical = await getUsersDb();
        const canonicalMapForSubmission = buildCanonicalEmailMap(usersForCanonical);
        const canonicalSubmitterEmail = resolveCanonicalEmail(target.userEmail, canonicalMapForSubmission);

        const seenProjectIds = new Set<string>();
        for (const w of target.works) {
          if (w.projectId && !seenProjectIds.has(w.projectId)) {
            seenProjectIds.add(w.projectId);
            await markTaskAssignmentPendingDb(target.date, canonicalSubmitterEmail, w.projectId);
          }
        }
      } catch (lineupErr: any) {
        console.error("Failed to revert Task Lineup status after deleting submission:", lineupErr.message);
      }
    }

    await logActivityLocally(actorEmail, "Delete Log", `Permanently deleted work log submission "${id}".`);

    const updatedList = await getSubmissionsDb();
    return res.json({ success: true, list: updatedList });
  } catch (err: any) {
    console.error("DELETE /api/submissions/:id error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// POST Reset Database
app.post("/api/reset-database", requireAdmin, async (req, res) => {
  try {
    // Clear from Supabase database only
    await saveProjectsBulkDb([]);
    await clearSubmissionsDb();
    await saveAlertsBulkDb([]);
    await clearActivitiesDb();
    await clearRankingsDb();
    
    return res.json({ success: true, message: "Supabase database tables cleared and reset." });
  } catch (err: any) {
    console.error("Error resetting database:", err);
    return res.status(500).json({ error: err.message });
  }
});

// Clear logs/submissions
app.delete("/api/submissions", requireAdmin, async (req, res) => {
  try {
    await clearSubmissionsDb();
    return res.json({ success: true, message: "All work log submissions have been cleared from history." });
  } catch (err: any) {
    console.error("Error clearing submissions:", err);
    return res.status(500).json({ error: err.message });
  }
});

// GET Alerts
app.get("/api/alerts", async (req, res) => {
  try {
    const list = await getAlertsDb();
    return res.json(list);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST alert notifications to admin
app.post("/api/alerts", async (req, res) => {
  const { alert } = req.body;
  if (!alert) {
    return res.status(400).json({ error: "Missing alert data" });
  }

  try {
    alert.createdAt = alert.createdAt || new Date().toISOString();
    const dbSaved = await saveAlertDb(alert);

    if (!dbSaved) {
      // Don't pretend this succeeded — if it didn't actually persist, the alert will
      // silently vanish on the next background sync. Surface it clearly instead.
      console.error(`Alert "${alert.id}" was NOT saved to Supabase — it will only exist in the requester's local browser state until the DB issue is fixed. Check server logs above for the missing-column details.`);
    }

    const adminEmail = req.headers['x-user-email'] || alert.adminEmail || "Admin";
    await logActivityLocally(String(adminEmail), "Create Note/Assignment", `Created notification assignment for ${alert.userEmail || 'all workers'} on project "${alert.projectName || alert.projectDomain || 'All'}"`);

    const updatedList = await getAlertsDb();
    return res.json({ list: updatedList, dbSaved });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST Clear/Dismiss alerts
app.post("/api/alerts/clear", async (req, res) => {
  const { id, ids, all } = req.body;
  try {
    let list = await getAlertsDb();

    const clearedItem = id ? list.find((a: any) => a.id === id) : null;
    if (all) {
      // mark all as read
      list = list.map((a: any) => ({ ...a, read: true }));
      await saveAlertsBulkDb(list);
    } else if (ids && Array.isArray(ids)) {
      // delete specified ids
      for (const alertId of ids) {
        await deleteAlertDb(alertId);
      }
    } else if (id) {
      // delete single id
      await deleteAlertDb(id);
    }

    const updatedList = await getAlertsDb();

    const actorEmail = req.headers['x-user-email'] || "User";
    const logMsg = all 
      ? "Cleared all active stick-notes and assignments" 
      : ids 
        ? `Bulk cleared ${ids.length} project task assignments` 
        : `Cleared notification assignment: "${clearedItem?.message || id}"`;
    await logActivityLocally(String(actorEmail), "Clear Note/Assignment", logMsg);

    return res.json(updatedList);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET Activity Logs
app.get("/api/activity", async (req, res) => {
  try {
    const list = await getActivitiesDb();
    return res.json(list);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// SERP RANKING INTEGRATION ENDPOINTS
// =========================================================================
const readRankings = async (): Promise<Record<string, Record<string, { ranking: string; lastChecked: string }>>> => {
  return await getRankingsDb();
};

const writeRankings = async (rankings: Record<string, Record<string, { ranking: string; lastChecked: string }>>): Promise<boolean> => {
  return await saveRankingsDb(rankings);
};

// =========================================================================
// SERP RANKING CHECKER — accurate, India-only, mobile-only, up to 8 pages
// =========================================================================
// Design notes (why it's built this way):
//
// 1. ACCURACY BUG THAT WAS HERE BEFORE: SerpApi's `organic_results[i].position`
//    field is the result's position WITHIN that single page response (i.e. it
//    resets back to a low number on every page), not its true overall rank
//    on Google. Trusting that field directly was why rankings looked right
//    on page 1 but went haywire from page 2 onward. Fixed by never reading
//    `.position` from the API - instead we keep our own running counter as
//    we walk organic results across every page, so a domain found as the
//    4th organic result on page 2 correctly reports as rank 14, not 4.
//
// 2. PAGE-TO-PAGE DRIFT: building each page as an independent request (our
//    own `start=10`, `start=20`, ...) can occasionally return a slightly
//    different Google snapshot per request. SerpApi avoids this by handing
//    back ready-made pagination URLs in `serpapi_pagination.other_pages`,
//    generated from the exact same search as page 1. We use those instead
//    of hand-building `start=` URLs, so every page is coherent with page 1.
//
// 3. LOCATION / DEVICE: locked to India (google_domain=google.co.in, gl=in)
//    and mobile (device=mobile) on every request, matching how rankings
//    should actually be tracked for this project - not configurable per
//    call, so there's no risk of accidentally checking desktop/global rank.
//
// 4. KEY POOL: unchanged behavior from before - add/remove keys via
//    SERP_API_KEYS (comma-separated), rotates round-robin and loops back to
//    the first key after the last, skips a key automatically if it errors
//    out or reports it's out of quota.
// =========================================================================

function getSerpApiKeyPool(): string[] {
  const multi = (process.env.SERP_API_KEYS || "").trim();
  if (multi) {
    return multi.split(",").map((k) => k.trim()).filter(Boolean);
  }
  const single = (process.env.SERP_API_KEY || "").trim();
  return single ? [single] : [];
}

// Round-robin cursor kept in memory across requests. Wraps back to the first
// key once it passes the last one - it never "runs out", it just loops.
let serpKeyCursor = 0;
function nextSerpApiKey(pool: string[]): string {
  const key = pool[serpKeyCursor % pool.length];
  serpKeyCursor = (serpKeyCursor + 1) % pool.length;
  return key;
}

const SERPAPI_BASE_URL = "https://serpapi.com/search.json";
const SERP_MAX_PAGES = 6; // start=0,10,20,30,40,50 -> checks positions 1-60

interface SerpApiOrganicResult {
  link?: string;
  url?: string;
  formatted_url?: string;
}
interface SerpApiPagination {
  other_pages?: Record<string, string>;
}
interface SerpApiResponse {
  organic_results?: SerpApiOrganicResult[];
  serpapi_pagination?: SerpApiPagination;
  error?: string;
  error_message?: string;
}

// Strips protocol/www/path/query down to a bare, lowercase hostname.
function normalizeHostname(rawUrl: string): string | null {
  try {
    const withProtocol = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    const url = new URL(withProtocol);
    return url.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

// Normalizes the domain the user is tracking (e.g. "www.example.com/" -> "example.com")
function normalizeTrackedDomain(domain: string): string {
  return domain
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/?#].*$/, "")
    .toLowerCase()
    .trim();
}

// Exact host match or subdomain match only (e.g. "blog.example.com" matches
// "example.com", but "notexample.com" or "example.com.fake.net" do not) -
// far more accurate than a plain substring check.
function isMatchingHost(hostname: string, trackedDomain: string): boolean {
  return hostname === trackedDomain || hostname.endsWith(`.${trackedDomain}`);
}

// Fetches a SERP API URL, trying keys from the pool round-robin (swapping
// the api_key param each attempt) up to pool.length times if a key errors
// out or reports it's out of quota. Returns null only if every key failed.
async function fetchSerpJson(rawUrl: string, pool: string[]): Promise<SerpApiResponse | null> {
  for (let attempt = 0; attempt < pool.length; attempt++) {
    const apiKey = nextSerpApiKey(pool);
    try {
      const url = new URL(rawUrl);
      url.searchParams.set("api_key", apiKey);

      const response = await fetch(url.toString(), { method: "GET", headers: { "Accept": "application/json" } });
      const responseText = await response.text();

      if (!response.ok) {
        console.warn(`SERP key ...${apiKey.slice(-4)} returned status ${response.status}, trying next key`);
        continue;
      }

      let data: SerpApiResponse;
      try {
        data = JSON.parse(responseText);
      } catch {
        console.warn(`SERP key ...${apiKey.slice(-4)} returned invalid JSON, trying next key`);
        continue;
      }

      if (data.error || data.error_message) {
        console.warn(`SERP key ...${apiKey.slice(-4)} reported: ${data.error || data.error_message}, trying next key`);
        continue;
      }

      return data;
    } catch (err) {
      console.error(`SERP key ...${apiKey.slice(-4)} fetch failed, trying next key:`, err);
      continue;
    }
  }
  // Every key in the pool failed.
  return null;
}

async function checkSerpRanking(keyword: string, domain: string): Promise<string> {
  const pool = getSerpApiKeyPool();
  if (pool.length === 0) {
    console.warn("⚠️ No SERP API key configured. Set SERP_API_KEYS (comma-separated) or SERP_API_KEY.");
    return "NA";
  }

  const trackedDomain = normalizeTrackedDomain(domain);
  if (!trackedDomain) return "NA";

  try {
    // Page 1 - fresh live fetch, locked to Pune, India + mobile.
    // NOTE on accuracy: gl/google_domain alone are a *weaker* localization
    // signal - SerpApi's own docs say Google can still lean on the proxy's
    // real-world location unless `location` is also set. City-level location
    // (rather than just the country) is what SerpApi recommends for the
    // closest match to a real user's search, since rankings can genuinely
    // vary city to city within the same country.
    const page1Params = new URLSearchParams({
      engine: "google",
      q: keyword,
      location: "Pune, Maharashtra, India",
      google_domain: "google.co.in",
      gl: "in",
      hl: "en",
      device: "mobile",
      num: "10",
      start: "0",
      no_cache: "true", // force a fresh crawl rather than a cached snapshot
    });
    const page1Url = `${SERPAPI_BASE_URL}?${page1Params.toString()}`;

    const page1 = await fetchSerpJson(page1Url, pool);
    if (!page1) {
      console.error(`All ${pool.length} SERP key(s) failed on page 1 for "${keyword}"; stopping.`);
      return "NA";
    }

    // Running counter across ALL pages = true organic rank (never trust the
    // API's own per-page `.position` field - see notes above).
    let overallRank = 0;
    const seenLinks = new Set<string>();

    const scanPage = (items: SerpApiOrganicResult[]): number | null => {
      for (const item of items) {
        const link = item.link || item.url || item.formatted_url || "";
        if (!link || seenLinks.has(link)) continue;
        seenLinks.add(link);
        const hostname = normalizeHostname(link);
        if (!hostname) continue;
        overallRank += 1;
        if (isMatchingHost(hostname, trackedDomain)) {
          return overallRank;
        }
      }
      return null;
    };

    const page1Match = scanPage(page1.organic_results ?? []);
    if (page1Match !== null) return String(page1Match);

    // Pages 2-N - simple, fixed start=10,20,30,40,50 offsets (same device,
    // location, and all other params as page 1). SERP_MAX_PAGES controls
    // how many of these we check (see constant above) before giving up.
    for (let pageNum = 2; pageNum <= SERP_MAX_PAGES; pageNum++) {
      const start = (pageNum - 1) * 10;
      const params = new URLSearchParams(page1Params);
      params.set("start", String(start));
      const pageUrl = `${SERPAPI_BASE_URL}?${params.toString()}`;

      const page = await fetchSerpJson(pageUrl, pool);
      if (!page) {
        console.error(`All ${pool.length} SERP key(s) failed mid-pagination for "${keyword}" (page ${pageNum}); stopping.`);
        break;
      }
      const items = page.organic_results ?? [];
      if (items.length === 0) break; // ran off the end of Google's results

      const match = scanPage(items);
      if (match !== null) return String(match);
    }

    // Not found within the checked range - "NA" (not "100+"): we only
    // looked at start=0..50 (positions 1-60), so we genuinely don't know
    // where beyond that it ranks, if at all.
    return "NA";
  } catch (err) {
    console.error("Error fetching ranking from SERP API:", err);
    return "NA";
  }
}

// =========================================================================
// WEEKLY AUTO RANKING CHECK + EMAIL REPORT (every Sunday, fully automatic)
// =========================================================================
// How this is triggered (two belt-and-braces paths, either is enough):
//
// 1. EXTERNAL FREE CRON PING (the reliable path for a free Render web
//    service, which sleeps after ~15 min of no traffic): a free scheduler
//    like cron-job.org hits POST/GET /api/rankings/weekly-report every
//    Sunday. The incoming request itself wakes a sleeping Render instance,
//    so this works forever without needing to pay for an "always on" plan.
//
// 2. IN-PROCESS SUNDAY SCHEDULER (node-cron below): fires automatically
//    whenever the server happens to already be awake at the scheduled
//    time (e.g. if it's on a paid/always-on plan, or kept awake by an
//    uptime pinger). This is a bonus, not the primary mechanism.
//
// Both paths call the exact same runWeeklyRankingReport() function, which
// checks a "did we already run this ISO week" guard (report_state table)
// before doing any SERP API calls, so triggering both never double-runs
// or double-emails the same week.
// =========================================================================

// ISO week id like "2026-W34" - stable, sortable, one id per calendar week.
function getIsoWeekId(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

// Same "project keywords + any extra keywords workers have logged against
// this project in their Work Log submissions" merge used by the manual
// bulk-check endpoint below, pulled out here so the weekly job can reuse it
// without duplicating the SERP calls twice a request apart.
function mergeProjectKeywords(project: any, submissions: any[]): string[] {
  let keywords: string[] = Array.isArray(project?.keywords) ? [...project.keywords] : [];
  if (Array.isArray(submissions)) {
    for (const sub of submissions) {
      if (sub && Array.isArray(sub.works)) {
        for (const work of sub.works) {
          if (work && work.projectId === project.id && Array.isArray(work.selectedKeywords)) {
            for (const kw of work.selectedKeywords) {
              if (kw && typeof kw === "string" && kw.trim()) {
                const cleaned = kw.trim();
                if (!keywords.map(k => k.toLowerCase()).includes(cleaned.toLowerCase())) {
                  keywords.push(cleaned);
                }
              }
            }
          }
        }
      }
    }
  }
  return keywords;
}

interface WeeklyReportRow {
  projectName: string;
  domain: string;
  keyword: string;
  before: string; // rank last week, or "—" if never checked before
  after: string;  // rank this week (or "NA")
  change: string; // e.g. "+3", "-2", "New", "Lost", "Same"
}

function buildChangeLabel(before: string, after: string): string {
  const beforeNum = /^\d+$/.test(before) ? parseInt(before, 10) : null;
  const afterNum = /^\d+$/.test(after) ? parseInt(after, 10) : null;
  if (beforeNum === null && afterNum !== null) return "New";
  if (beforeNum !== null && afterNum === null) return "Lost";
  if (beforeNum === null && afterNum === null) return "—";
  const diff = beforeNum! - afterNum!; // positive = moved UP (lower rank number is better)
  if (diff > 0) return `Up ${diff}`;
  if (diff < 0) return `Down ${Math.abs(diff)}`;
  return "Same";
}

function renderWeeklyReportHtml(rows: WeeklyReportRow[], weekId: string): string {
  const byProject = new Map<string, WeeklyReportRow[]>();
  for (const row of rows) {
    const key = `${row.projectName} (${row.domain})`;
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key)!.push(row);
  }

  const changeColor = (change: string): string => {
    if (change.startsWith("Up") || change === "New") return "#15803d";
    if (change.startsWith("Down") || change === "Lost") return "#b91c1c";
    return "#6b7280";
  };

  let sections = "";
  for (const [projectLabel, projectRows] of byProject.entries()) {
    const tableRows = projectRows.map(r => `
      <tr>
        <td style="padding:8px 10px;border:1px solid #e5e7eb;">${r.keyword}</td>
        <td style="padding:8px 10px;border:1px solid #e5e7eb;text-align:center;">${r.before}</td>
        <td style="padding:8px 10px;border:1px solid #e5e7eb;text-align:center;">${r.after}</td>
        <td style="padding:8px 10px;border:1px solid #e5e7eb;text-align:center;color:${changeColor(r.change)};font-weight:600;">${r.change}</td>
      </tr>`).join("");

    sections += `
      <h3 style="margin:24px 0 8px;font-family:Arial,sans-serif;color:#111827;">${projectLabel}</h3>
      <table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:13px;">
        <thead>
          <tr style="background:#f3f4f6;">
            <th style="padding:8px 10px;border:1px solid #e5e7eb;text-align:left;">Keyword</th>
            <th style="padding:8px 10px;border:1px solid #e5e7eb;">Last Week</th>
            <th style="padding:8px 10px;border:1px solid #e5e7eb;">This Week</th>
            <th style="padding:8px 10px;border:1px solid #e5e7eb;">Change</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>`;
  }

  return `
    <div style="font-family:Arial,sans-serif;color:#111827;">
      <h2 style="margin:0 0 4px;">Weekly SEO Ranking Report</h2>
      <p style="margin:0 0 16px;color:#6b7280;">Week ${weekId} · Generated ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} (IST)</p>
      ${sections || "<p>No keywords were found to check this week.</p>"}
    </div>`;
}

let cachedTransporter: any = null;
async function getMailTransporter(): Promise<any> {
  if (cachedTransporter) return cachedTransporter;
  const user = process.env.SMTP_USER;
  // Gmail App Passwords are shown with spaces (e.g. "abcd efgh ijkl mnop")
  // for readability but must be used without them - strip any whitespace
  // in case it was pasted in that display format.
  const pass = (process.env.SMTP_APP_PASSWORD || "").replace(/\s+/g, "");
  if (!user || !pass) return null;

  // Render's outbound network has broken/blocked IPv6 routing to Google's
  // mail servers. Passing family: 4 to nodemailer does NOT reliably force
  // IPv4 (confirmed in production: it still picked an IPv6 address and
  // failed with "connect ENETUNREACH 2607:f8b0:..."). The fix that
  // actually works is to resolve smtp.gmail.com to a real IPv4 address
  // ourselves and connect to that IP directly - then separately tell TLS
  // the original hostname via `servername` so the certificate check
  // (which expects "smtp.gmail.com", not a bare IP) still passes.
  let ipv4Host = "smtp.gmail.com";
  try {
    const { address } = await dns.promises.lookup("smtp.gmail.com", { family: 4 });
    ipv4Host = address;
  } catch (err) {
    console.error("Failed to resolve smtp.gmail.com to IPv4, falling back to hostname:", err);
  }

  cachedTransporter = nodemailer.createTransport({
    host: ipv4Host,
    // Port 465 (implicit TLS) is blocked/unreachable on Render's outbound
    // network (confirmed: hangs until connectionTimeout). Port 587 with
    // STARTTLS is the standard fallback and is not blocked - the
    // connection starts as plain text and upgrades to TLS via the
    // STARTTLS command, so secure must be false and requireTLS true.
    port: 587,
    secure: false,
    requireTLS: true,
    auth: { user, pass },
    tls: {
      servername: "smtp.gmail.com", // required for TLS cert validation since host above is now a bare IP
    },
    // Without these, a flaky/blocked connection on Render's network can
    // hang forever (no error, no timeout) - the weekly job would then
    // never reach finishedAt and would look "stuck" indefinitely instead
    // of failing with a clear reason. These bound every phase of the SMTP
    // handshake so a bad connection fails fast instead of hanging.
    connectionTimeout: 20000, // time to establish the TCP connection
    greetingTimeout: 20000,   // time to receive the SMTP server greeting
    socketTimeout: 30000,     // time of inactivity before killing the socket
  } as any);
  return cachedTransporter;
}

async function sendWeeklyReportEmail(rows: WeeklyReportRow[], weekId: string): Promise<{ sent: boolean; reason?: string }> {
  const to = (process.env.REPORT_TO_EMAIL || "").trim();
  if (!to) return { sent: false, reason: "REPORT_TO_EMAIL is not set." };

  const transporter = await getMailTransporter();
  if (!transporter) return { sent: false, reason: "SMTP_USER / SMTP_APP_PASSWORD is not set." };

  try {
    await transporter.sendMail({
      from: `"SEO Ranking Report" <${process.env.SMTP_USER}>`,
      to,
      subject: `Weekly SEO Ranking Report — Week ${weekId}`,
      html: renderWeeklyReportHtml(rows, weekId),
    });
    return { sent: true };
  } catch (err: any) {
    console.error("Failed to send weekly ranking report email:", err);
    return { sent: false, reason: err?.message || "Unknown email error." };
  }
}

// In-memory progress tracker for the weekly job. Needed because the job can
// legitimately take several minutes (it checks every keyword's live SERP
// ranking, sequentially, page by page) - far longer than any HTTP proxy
// (Render, cron-job.org, a plain browser tab) will wait for a response. So
// the trigger endpoint below no longer blocks on the job; it kicks the job
// off, replies immediately, and callers poll /weekly-report/status instead.
let weeklyReportProgress: {
  running: boolean;
  weekId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  keywordsDone: number;
  keywordsTotal: number;
  lastResult: any | null;
  lastError: string | null;
} = {
  running: false,
  weekId: null,
  startedAt: null,
  finishedAt: null,
  keywordsDone: 0,
  keywordsTotal: 0,
  lastResult: null,
  lastError: null,
};

// The main job. force=true skips the "already ran this week" guard (useful
// for testing from the browser/Postman without waiting for Sunday).
// testLimit, if set, caps how many keywords (across ALL projects, in order)
// are actually checked/emailed - purely for quick testing (e.g. testLimit=2
// sends a report after checking just the first 2 keywords instead of all
// ~1228). Rankings are NOT persisted as "latest" or archived to history when
// testLimit is set, so a test run never corrupts next Sunday's real "before"
// data or the long-term trend history.
// sendEmail=false (used by the manual "Check All" button) checks and saves
// exactly the same as a normal run, but skips sending the email - for when
// someone wants rankings refreshed now and will hit "Send Report" separately.
async function runWeeklyRankingReport(force: boolean = false, testLimit?: number, sendEmail: boolean = true): Promise<any> {
  const weekId = getIsoWeekId(new Date());
  const isTest = typeof testLimit === "number" && testLimit > 0;

  if (!force && !isTest) {
    const state = await getReportStateDb();
    if (state?.last_run_week === weekId) {
      console.log(`Weekly ranking report for ${weekId} already ran at ${state.last_run_at}; skipping.`);
      return { skipped: true, weekId, reason: "already ran this week" };
    }
  }

  console.log(`Starting weekly ranking report for ${weekId}${isTest ? ` (TEST MODE - limit ${testLimit} keyword(s), nothing will be saved/archived)` : ""}${!sendEmail ? " (check-only, no email)" : ""}...`);

  const [projects, submissions, rankingsBefore] = await Promise.all([
    getProjectsDb(),
    getSubmissionsDb(),
    readRankings(),
  ]);

  const rows: WeeklyReportRow[] = [];

  // Pre-count so /weekly-report/status can show "12 / 50 done" while it runs.
  let plannedKeywords: { project: any; cleaned: string }[] = [];
  for (const project of projects) {
    if (!project?.domain) continue;
    const keywords = mergeProjectKeywords(project, submissions);
    for (const kw of keywords) {
      const cleaned = kw.trim();
      if (!cleaned) continue;
      plannedKeywords.push({ project, cleaned });
    }
  }
  if (isTest) {
    plannedKeywords = plannedKeywords.slice(0, testLimit);
  }
  weeklyReportProgress.keywordsTotal = plannedKeywords.length;
  weeklyReportProgress.keywordsDone = 0;

  for (const { project, cleaned } of plannedKeywords) {
    if (!rankingsBefore[project.id]) rankingsBefore[project.id] = {};

    const beforeEntry = rankingsBefore[project.id][cleaned];
    const before = beforeEntry?.ranking || "—";

    const after = await checkSerpRanking(cleaned, project.domain);
    const timestamp = new Date().toISOString();
    rankingsBefore[project.id][cleaned] = { ranking: after, lastChecked: timestamp };

    rows.push({
      projectName: project.name || project.domain,
      domain: project.domain,
      keyword: cleaned,
      before,
      after,
      change: buildChangeLabel(before, after),
    });

    weeklyReportProgress.keywordsDone += 1;
  }

  // Persist the freshly-checked rankings as the new "latest" (this becomes
  // next Sunday's "before" automatically) and archive this week's full
  // before/after report for the long-term (1 year+) trend history.
  // Skipped entirely in test mode so a quick testLimit=2 run never
  // overwrites real "before" data or pollutes the history table.
  if (!isTest) {
    await writeRankings(rankingsBefore);
    await saveRankingHistoryDb(weekId, { generatedAt: new Date().toISOString(), rows });
    await setReportStateDb(weekId);
  }

  let emailResult: { sent: boolean; reason?: string } = { sent: false, reason: "Email not requested (check-only run)." };
  if (sendEmail) {
    emailResult = await sendWeeklyReportEmail(rows, isTest ? `${weekId} (TEST - ${rows.length} keyword(s) only)` : weekId);
    if (!emailResult.sent) {
      console.warn(`Weekly ranking report ${weekId}: rankings were checked${isTest ? "" : " and saved"}, but email was NOT sent — ${emailResult.reason}`);
    } else {
      console.log(`Weekly ranking report ${weekId}: email sent to ${process.env.REPORT_TO_EMAIL}.`);
    }
  } else {
    console.log(`Weekly ranking report ${weekId}: check-only run complete, ${rows.length} keyword(s) saved. No email sent (use Send Report to email this).`);
  }

  if (!isTest) {
    await logActivityLocally(
      "system",
      "Weekly Ranking Report",
      `Checked ${rows.length} keyword(s) across ${projects.length} project(s) for week ${weekId}. Email ${!sendEmail ? "not requested (check-only)" : emailResult.sent ? "sent" : "NOT sent (" + emailResult.reason + ")"}.`
    );
  }

  return { skipped: false, weekId, test: isTest, checkOnly: !sendEmail, keywordsChecked: rows.length, projectsCovered: new Set(rows.map(r => r.projectName)).size, email: emailResult };
}

// Sends a report of WHATEVER ranking data is currently present right now
// (in the same "rankings" table that the Ranking tab's existing "Check All" /
// per-project "Check" buttons already save to via /api/rankings/check) -
// however many keywords that happens to be, no re-checking involved. Same
// exact email format/recipient as the automatic Sunday system
// (renderWeeklyReportHtml + sendWeeklyReportEmail). "Before" column is
// filled in from the last archived report if one exists, purely for context;
// nothing is required to have run first except at least one keyword having
// been checked at some point (via the Ranking tab).
async function sendCurrentRankingsReport(): Promise<any> {
  const [projects, submissions, rankings, priorHistory] = await Promise.all([
    getProjectsDb(),
    getSubmissionsDb(),
    readRankings(),
    getRankingHistoryDb(1),
  ]);

  // domain::keyword -> previous "after" value, so the email can still show a
  // "Last Week" column when we have something to compare against.
  const priorLookup = new Map<string, string>();
  const priorRows: WeeklyReportRow[] = priorHistory?.[0]?.data?.rows || [];
  for (const r of priorRows) {
    priorLookup.set(`${r.domain}::${r.keyword.toLowerCase()}`, r.after);
  }

  const rows: WeeklyReportRow[] = [];
  for (const project of projects) {
    if (!project?.domain) continue;
    const projectRankings = rankings[project.id];
    if (!projectRankings) continue; // nothing checked for this project yet - skip it

    const keywords = mergeProjectKeywords(project, submissions);
    for (const kw of keywords) {
      const cleaned = kw.trim();
      if (!cleaned) continue;
      const entry = projectRankings[cleaned];
      if (!entry || !entry.ranking) continue; // this specific keyword hasn't been checked - skip it

      const after = entry.ranking;
      const before = priorLookup.get(`${project.domain}::${cleaned.toLowerCase()}`) || "—";

      rows.push({
        projectName: project.name || project.domain,
        domain: project.domain,
        keyword: cleaned,
        before,
        after,
        change: buildChangeLabel(before, after),
      });
    }
  }

  if (rows.length === 0) {
    return { sent: false, reason: "No ranking data found yet - check some keywords first from the Ranking tab, then try Send Report again." };
  }

  const weekId = getIsoWeekId(new Date());
  const emailResult = await sendWeeklyReportEmail(rows, weekId);

  if (emailResult.sent) {
    // Archive this as the latest snapshot so the NEXT manual send (or the
    // Sunday auto job) has a proper "before" to compare against.
    await saveRankingHistoryDb(weekId, { generatedAt: new Date().toISOString(), rows });
    await logActivityLocally(
      "system",
      "Manual Send Report",
      `Manually sent a ranking report for week ${weekId} (${rows.length} keyword(s), based on currently available data).`
    );
    console.log(`Manual Send Report: emailed ${rows.length} keyword(s) to ${process.env.REPORT_TO_EMAIL}.`);
  } else {
    console.warn(`Manual Send Report: failed to send — ${emailResult.reason}`);
  }

  return { weekId, keywordsInReport: rows.length, email: emailResult };
}

// Protected trigger endpoint - point a free external scheduler (e.g.
// cron-job.org) at this URL, every Sunday, with the secret attached, e.g.:
//   GET https://your-app.onrender.com/api/rankings/weekly-report?secret=YOUR_CRON_SECRET
// Supports GET (so a plain browser/cron-job.org GET job works) and POST.
//
// IMPORTANT: this does NOT wait for the job to finish before responding.
// Checking every keyword's live SERP ranking can take several minutes, which
// is longer than Render's proxy, cron-job.org's default timeout, or a plain
// browser tab will wait - so waiting here is what caused the old
// "site can't be reached" error on force=true. Instead we kick the job off
// in the background and reply right away with { started: true }. Poll
// GET /api/rankings/weekly-report/status to watch progress and see the
// final result (rows checked, email sent/not sent, etc.) once it's done.
async function handleWeeklyReportTrigger(req: express.Request, res: express.Response) {
  const configuredSecret = (process.env.CRON_SECRET || "").trim();
  const providedSecret = String(req.query.secret || req.headers["x-cron-secret"] || "").trim();

  if (configuredSecret && providedSecret !== configuredSecret) {
    console.warn("Blocked weekly-report trigger with missing/incorrect secret.");
    return res.status(401).json({ error: "Invalid or missing secret." });
  }
  if (!configuredSecret) {
    console.warn("CRON_SECRET is not set — weekly-report endpoint is currently UNPROTECTED. Set CRON_SECRET in your environment.");
  }

  const force = String(req.query.force || "") === "true";

  // Optional ?testLimit=2 - checks only the first N keywords (across all
  // projects) and does NOT save/archive anything, purely for a quick
  // "does the email actually arrive" test. Ignored if not a positive number.
  const testLimitRaw = parseInt(String(req.query.testLimit || ""), 10);
  const testLimit = Number.isFinite(testLimitRaw) && testLimitRaw > 0 ? testLimitRaw : undefined;

  if (weeklyReportProgress.running) {
    // Already going (e.g. the in-process Sunday cron and an external ping
    // landed close together) - don't start a second overlapping run.
    return res.status(202).json({
      started: false,
      alreadyRunning: true,
      progress: weeklyReportProgress,
    });
  }

  const weekId = getIsoWeekId(new Date());
  weeklyReportProgress = {
    running: true,
    weekId,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    keywordsDone: 0,
    keywordsTotal: 0,
    lastResult: null,
    lastError: null,
  };

  // Fire and forget - do NOT await this. Respond to the HTTP caller
  // immediately so the connection can't time out mid-job.
  runWeeklyRankingReport(force, testLimit)
    .then((result) => {
      weeklyReportProgress.lastResult = result;
    })
    .catch((err: any) => {
      console.error("Error running weekly ranking report:", err);
      weeklyReportProgress.lastError = err?.message || "Unknown error.";
    })
    .finally(() => {
      weeklyReportProgress.running = false;
      weeklyReportProgress.finishedAt = new Date().toISOString();
    });

  res.status(202).json({
    started: true,
    weekId,
    force,
    testLimit: testLimit ?? null,
    message: testLimit
      ? `TEST MODE: checking only ${testLimit} keyword(s), nothing will be saved. Poll /api/rankings/weekly-report/status for progress.`
      : "Weekly ranking report started in the background. Poll /api/rankings/weekly-report/status for progress.",
  });
}
app.get("/api/rankings/weekly-report", handleWeeklyReportTrigger);
app.post("/api/rankings/weekly-report", handleWeeklyReportTrigger);

// GET current/last-run progress of the weekly job - poll this after
// triggering, instead of waiting on the trigger request itself.
app.get("/api/rankings/weekly-report/status", (req, res) => {
  res.json(weeklyReportProgress);
});

// GET the last N archived weekly reports (for building a "history" view later)
app.get("/api/rankings/weekly-report/history", async (req, res) => {
  try {
    const limit = parseInt(String(req.query.limit || "12"), 10);
    const history = await getRankingHistoryDb(limit);
    res.json(history);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// MANUAL ADMIN CONTROL - "Send Report" button
// =========================================================================
// The Ranking tab already has its own "Check All" / per-project "Check"
// buttons (see DSRDashboard.tsx -> /api/rankings/check) that check live
// SERP rankings and save them into the same "rankings" table this reads
// from. This button does NOT check anything - it just takes whatever
// ranking data is currently present (however many keywords that is) and
// emails it, in the exact same HTML format and to the exact same
// REPORT_TO_EMAIL address the automatic Sunday system uses. Fast (no SERP
// calls), so it responds synchronously.
app.post("/api/rankings/send-report", requireAdmin, async (req, res) => {
  try {
    const result = await sendCurrentRankingsReport();
    res.json(result);
  } catch (err: any) {
    console.error("Error sending manual report:", err);
    res.status(500).json({ error: err.message });
  }
});

// Bonus in-process scheduler: fires every Sunday 08:30 IST (03:00 UTC) IF
// the server happens to be awake at that moment. runWeeklyRankingReport()'s
// own "already ran this week" guard means this can never double-send even
// if the external cron ping above also fires around the same time.
cron.schedule("0 3 * * 0", () => {
  console.log("In-process Sunday scheduler firing weekly ranking report...");
  runWeeklyRankingReport(false).catch(err => console.error("Scheduled weekly ranking report failed:", err));
}, { timezone: "UTC" });

// GET rankings
app.get("/api/rankings", async (req, res) => {
  try {
    const rankings = await readRankings();
    res.json(rankings);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET a user's Update Ranking sheet - a free-form Google-Sheets-style grid
// (dynamic columns, dynamic rows, per-column colors, per-row colors). Every
// user has their own independent sheet, keyed by ?user=<email/id>, so
// regular users only ever see their own and admins must explicitly ask for
// one specific user's sheet (never everyone's mashed together).
app.get("/api/manual-rankings", async (req, res) => {
  try {
    const userKey = String(req.query.user || "").trim().toLowerCase();
    if (!userKey) {
      return res.json({ columns: [], rows: [] });
    }
    const grid = await getManualRankingsDb(userKey);
    const ok = grid && (Array.isArray(grid.columns) || Array.isArray(grid.rows));
    res.json(ok ? grid : { columns: [], rows: [] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST a user's Update Ranking sheet (full overwrite - columns + rows together)
app.post("/api/manual-rankings", async (req, res) => {
  try {
    const { user, columns, rows } = req.body || {};
    const userKey = String(user || "").trim().toLowerCase();
    if (!userKey) {
      return res.status(400).json({ error: "Missing user." });
    }
    const grid = {
      columns: Array.isArray(columns) ? columns : [],
      rows: Array.isArray(rows) ? rows : []
    };
    const ok = await saveManualRankingsDb(userKey, grid);
    if (!ok) {
      return res.status(500).json({ error: "Failed to save the ranking sheet." });
    }
    res.json({ success: true, ...grid });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST check rankings
app.post("/api/rankings/check", async (req, res) => {
  try {
    const { projectId, keyword, domain } = req.body || {};
    if (!projectId || !domain) {
      return res.status(400).json({ error: "projectId and domain are required." });
    }

    const rankings = await readRankings();
    if (!rankings[projectId]) {
      rankings[projectId] = {};
    }

    const timestamp = new Date().toISOString();

    if (keyword) {
      const rank = await checkSerpRanking(keyword, domain);
      rankings[projectId][keyword] = {
        ranking: rank,
        lastChecked: timestamp
      };
      const saved = await writeRankings(rankings);
      if (!saved) {
        // The SERP lookup itself succeeded, but the write to the database
        // failed (e.g. Supabase not configured, "rankings" table missing,
        // or an RLS policy blocking the upsert). We still return the
        // freshly-checked ranking so the UI can show it immediately, but
        // we flag `persisted: false` so the frontend knows NOT to trust
        // it will still be there after a refresh, and surfaces a warning
        // instead of silently losing the value.
        console.error(`Ranking for "${keyword}" (project ${projectId}) was checked but FAILED to save to Supabase. Verify the "rankings" table exists (see supabaseServer.ts SQL) and that SUPABASE_URL/SUPABASE_KEY are correct.`);
        return res.json({
          projectId,
          keyword,
          ranking: rankings[projectId][keyword],
          persisted: false,
          warning: "Ranking checked successfully but could not be saved to the database. It will be lost on refresh — check your Supabase 'rankings' table/credentials."
        });
      }
      return res.json({ projectId, keyword, ranking: rankings[projectId][keyword], persisted: true });
    } else {
      let projectKeywords: string[] = [];
      try {
        const projs = await getProjectsDb();
        const found = projs.find((p: any) => p.id === projectId);
        if (found && found.keywords) {
          projectKeywords = [...found.keywords];
        }
      } catch (e) {
        console.error("Error loading project keywords:", e);
      }

      try {
        const submissions = await getSubmissionsDb();
        if (Array.isArray(submissions)) {
          for (const sub of submissions) {
            if (sub && Array.isArray(sub.works)) {
              for (const work of sub.works) {
                if (work && work.projectId === projectId && Array.isArray(work.selectedKeywords)) {
                  for (const kw of work.selectedKeywords) {
                    if (kw && typeof kw === 'string' && kw.trim()) {
                      const cleaned = kw.trim();
                      if (!projectKeywords.map(k => k.toLowerCase()).includes(cleaned.toLowerCase())) {
                        projectKeywords.push(cleaned);
                      }
                    }
                  }
                }
              }
            }
          }
        }
      } catch (e) {
        console.error("Error loading project keywords from submissions:", e);
      }

      if (projectKeywords.length === 0) {
        return res.status(404).json({ error: "No keywords found or mapped for this project." });
      }

      const results: Record<string, { ranking: string; lastChecked: string }> = {};
      for (const kw of projectKeywords) {
        if (kw && kw.trim()) {
          const rank = await checkSerpRanking(kw, domain);
          rankings[projectId][kw] = {
            ranking: rank,
            lastChecked: timestamp
          };
          results[kw] = rankings[projectId][kw];
        }
      }

      const saved = await writeRankings(rankings);
      if (!saved) {
        console.error(`Bulk ranking check for project ${projectId} succeeded but FAILED to save to Supabase. Verify the "rankings" table exists (see supabaseServer.ts SQL) and that SUPABASE_URL/SUPABASE_KEY are correct.`);
        return res.json({
          projectId,
          results,
          persisted: false,
          warning: "Rankings checked successfully but could not be saved to the database. They will be lost on refresh — check your Supabase 'rankings' table/credentials."
        });
      }
      return res.json({ projectId, results, persisted: true });
    }
  } catch (err: any) {
    console.error("Error in POST /api/rankings/check:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ==========================================
// STATIC FRONTEND SERVING & VITE
// ==========================================
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Express Local DB Server running on port ${PORT}`);
    // Auto-sync on boot removed for both projects and submissions —
    // Supabase is the sole source of truth. Use the manual sync endpoints
    // (POST /api/projects/sync-from-sheet) when you want fresh Sheet data.
  });

  // Task Lineup engine heartbeat: once an admin has started the cycle, this
  // makes sure a new day's lineup gets generated on its own, without anyone
  // having to open the app or click Start Cycle again. Also checked
  // opportunistically on every GET /api/task-lineup call — this interval is
  // just the belt-and-braces path for when nobody's actively using the app.
  ensureTodayLineupIfEngineActive();
  setInterval(() => {
    ensureTodayLineupIfEngineActive();
  }, 15 * 60 * 1000);
}


startServer();

export default app;
