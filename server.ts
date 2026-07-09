import express from "express";
import path from "path";
import dotenv from "dotenv";
import { JWT } from "google-auth-library";
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
  clearRankingsDb
} from "./src/lib/supabaseServer";

dotenv.config();

const app = express();
const PORT = 3000;

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

async function getGoogleAccessToken(): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedAccessToken && now < tokenExpiryTime - 60) {
    return cachedAccessToken;
  }

  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!saJson) {
    return null;
  }

  try {
    const sa = JSON.parse(saJson.trim());
    const clientEmail = sa.client_email;
    let privateKey = sa.private_key;

    if (!clientEmail || !privateKey) {
      return null;
    }

    if (privateKey && typeof privateKey === "string") {
      privateKey = privateKey.replace(/\\n/g, "\n");
    }

    const jwtClient = new JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const tokens = await jwtClient.authorize();
    if (tokens.access_token) {
      cachedAccessToken = tokens.access_token;
      tokenExpiryTime = tokens.expiry_date ? Math.floor(tokens.expiry_date / 1000) : (now + 3600);
      return cachedAccessToken;
    }
  } catch (err: any) {
    console.error("Google Service Account authenticate rejected:", err.message);
  }
  return null;
}

function mapRowsToProjects(rows: string[][]): any[] {
  if (rows.length === 0) return [];
  const headers = rows[0] || [];
  const normalizedHeaders = headers.map((h: any) => String(h || "").toLowerCase().trim());

  const colIdx = {
    domain: normalizedHeaders.findIndex(h => h.includes("domain") || h.includes("website") || h.includes("url") || h.includes("link")),
    name: normalizedHeaders.findIndex(h => h.includes("project") || h.includes("name") || h === "title"),
    location: normalizedHeaders.findIndex(h => h.includes("location") || h.includes("city") || h.includes("office")),
    region: normalizedHeaders.findIndex(h => h.includes("region") || h.includes("zone") || h === "area"),
    users: normalizedHeaders.findIndex(h => h.includes("users") || h.includes("assign") || h.includes("member") || h.includes("staff") || h.includes("employee")),
    userId: normalizedHeaders.findIndex(h => h.includes("user id") || h.includes("userid") || h.includes("employee id") || h.includes("staff id") || h === "uid" || h === "id"),
    priority: normalizedHeaders.findIndex(h => h.includes("priority") || h === "prio"),
    frequency: normalizedHeaders.findIndex(h => h.includes("frequency") || h.includes("freq"))
  };

  const keywordColIdxs: number[] = [];
  normalizedHeaders.forEach((h, idx) => {
    if (h.includes("keyword")) {
      keywordColIdxs.push(idx);
    }
  });

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

const DEFAULT_SPREADSHEET_ID = "1ZkP1c8lBFnqEbXvMx83Zz-uuYU16xqQBsZW9lAqeuwU";

function colIndexToLetter(index: number): string {
  let temp = index;
  let letter = "";
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

async function updateProjectInGoogleSheet(project: any): Promise<boolean> {
  const token = await getGoogleAccessToken();
  if (!token) return false;

  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID;
  if (!spreadsheetId) return false;

  const cleanId = spreadsheetId.trim();
  const candidates = ["Projects_Mapping", "Projects", "sheet1", "Sheet1"];

  for (const candidate of candidates) {
    const fetchUrl = `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values/${encodeURIComponent(candidate + "!A1:Z1000")}`;
    try {
      const res = await fetch(fetchUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (res.ok) {
        const data = await res.json();
        const rows: string[][] = data.values || [];
        if (rows.length === 0) continue;

        const headers = rows[0];
        const normalizedHeaders = headers.map((h: string) => h.toLowerCase().trim());

        const colIdx = {
          userId: normalizedHeaders.findIndex(h => h.includes("user id") || h.includes("userid") || h.includes("employee id") || h.includes("staff id") || h === "uid" || h === "id"),
          users: normalizedHeaders.findIndex(h => h.includes("user") || h.includes("employeename") || h.includes("staffname") || h === "assignee" || h === "name" || h === "reporters"),
          name: normalizedHeaders.findIndex(h => h.includes("project name") || h.includes("projectname") || h.includes("title") || h === "project"),
          domain: normalizedHeaders.findIndex(h => h.includes("domain") || h.includes("website") || h.includes("url")),
          priority: normalizedHeaders.findIndex(h => h.includes("priority") || h === "prio"),
          frequency: normalizedHeaders.findIndex(h => h.includes("frequency") || h.includes("freq")),
        };

        let matchedRowIdx = -1;
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          const rowDomain = colIdx.domain !== -1 ? (row[colIdx.domain] || "").trim().toLowerCase() : "";
          const rowName = colIdx.name !== -1 ? (row[colIdx.name] || "").trim().toLowerCase() : "";

          const projDomain = (project.domain || "").trim().toLowerCase();
          const projName = (project.name || "").trim().toLowerCase();

          if (
            (projDomain && rowDomain && (rowDomain === projDomain || rowDomain.includes(projDomain) || projDomain.includes(rowDomain))) ||
            (projName && rowName && (rowName === projName || rowName.includes(projName) || projName.includes(rowName)))
          ) {
            matchedRowIdx = i;
            break;
          }
        }

        if (matchedRowIdx !== -1) {
          const spreadsheetRowNumber = matchedRowIdx + 1;
          let updatedHeaders = [...headers];
          let headersChanged = false;

          let priorityColIdx = colIdx.priority;
          if (priorityColIdx === -1) {
            priorityColIdx = updatedHeaders.length;
            updatedHeaders.push("Priority");
            headersChanged = true;
          }

          let frequencyColIdx = colIdx.frequency;
          if (frequencyColIdx === -1) {
            frequencyColIdx = updatedHeaders.length;
            updatedHeaders.push("Frequency");
            headersChanged = true;
          }

          if (headersChanged) {
            const headerRange = `${candidate}!A1:${colIndexToLetter(updatedHeaders.length - 1)}1`;
            const headerUrl = `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values/${encodeURIComponent(headerRange)}?valueInputOption=USER_ENTERED`;
            await fetch(headerUrl, {
              method: "PUT",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ values: [updatedHeaders] }),
            });
          }

          let rowToUpdate = [...rows[matchedRowIdx]];
          while (rowToUpdate.length < updatedHeaders.length) {
            rowToUpdate.push("");
          }

          rowToUpdate[priorityColIdx] = project.priority || "";
          rowToUpdate[frequencyColIdx] = project.frequency || "";

          const rowRange = `${candidate}!A${spreadsheetRowNumber}:${colIndexToLetter(updatedHeaders.length - 1)}${spreadsheetRowNumber}`;
          const rowUrl = `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values/${encodeURIComponent(rowRange)}?valueInputOption=USER_ENTERED`;

          const updateRes = await fetch(rowUrl, {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ values: [rowToUpdate] }),
          });

          if (updateRes.ok) {
            return true;
          }
        }
      }
    } catch (err: any) {
      console.warn(`Failed updating project row in candidate tab "${candidate}":`, err.message);
    }
  }
  return false;
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

async function syncProjectsFromGoogleSheet(): Promise<any[] | null> {
  const mergeWithLocalProjects = async (sheetProjects: any[]) => {
    let localProjects = [];
    try {
      localProjects = await getProjectsDb();
    } catch (e) {
      localProjects = [];
    }

    if (!Array.isArray(localProjects)) {
      localProjects = [];
    }

    const localMap = new Map<string, any>();
    for (const proj of localProjects) {
      if (proj.id) {
        localMap.set(String(proj.id).trim().toLowerCase(), proj);
      }
    }

    return sheetProjects.map(sp => {
      const cleanId = String(sp.id || "").trim().toLowerCase();
      const local = localMap.get(cleanId);
      if (local) {
        // If sheet has priority/frequency, use them; otherwise fall back to local ones
        const priority = sp.priority || local.priority || "";
        const frequency = sp.frequency || local.frequency || "";
        return {
          ...sp,
          priority,
          frequency
        };
      }
      return sp;
    });
  };

  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID;
  if (!spreadsheetId) return null;

  const cleanId = spreadsheetId.trim();
  const candidates = ["Projects_Mapping", "Projects", "sheet1", "Sheet1"];
  
  const token = await getGoogleAccessToken();
  if (token) {
    for (const candidate of candidates) {
      const range = encodeURIComponent(`${candidate}!A1:Z1000`);
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values/${range}`;

      try {
        const res = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        });

        if (res.ok) {
          const data = await res.json();
          if (data.values && data.values.length > 0) {
            const mapped = mapRowsToProjects(data.values);
            if (mapped && mapped.length > 0) {
              const finalMerged = await mergeWithLocalProjects(mapped);
              await saveProjectsBulkDb(finalMerged);
              return finalMerged;
            }
          }
        }
      } catch (err: any) {
        console.warn(`Failed reading projects authenticated from candidate tab "${candidate}":`, err.message);
      }
    }
  }

  // Fallback to public CSV fetcher
  for (const candidate of candidates) {
    const url = `https://docs.google.com/spreadsheets/d/${cleanId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(candidate)}`;
    try {
      const res = await fetch(url);
      if (res.ok) {
        const text = await res.text();
        const rows = parseCSV(text);
        if (rows && rows.length > 0) {
          const mapped = mapRowsToProjects(rows);
          if (mapped && mapped.length > 0) {
            const finalMerged = await mergeWithLocalProjects(mapped);
            await saveProjectsBulkDb(finalMerged);
            return finalMerged;
          }
        }
      }
    } catch (err: any) {
      console.warn(`Failed reading projects public CSV from candidate tab "${candidate}":`, err.message);
    }
  }

  return null;
}

async function syncSubmissionsFromGoogleSheet(): Promise<any[] | null> {
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID;
  if (!spreadsheetId) return null;

  const cleanId = spreadsheetId.trim();
  const candidates = ["DSR_Logs", "Submissions", "sheet1", "Sheet1"];

  const parseSubmissionsRows = (rows: string[][]) => {
    if (rows.length <= 1) {
      return [];
    }

    const groupedEntries: Record<string, any> = {};

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row[0] || !row[1] || !row[2]) continue;

      const subBlockId = row[0];
      const dsrParentId = subBlockId.split("-").slice(0, 2).join("-");
      const date = row[1];
      const userEmail = row[2];
      const projectId = row[3] || "";
      const projectName = row[4] || "";
      const listingCount = parseInt(row[5], 10) || 0;
      const blogCount = parseInt(row[6], 10) || 0;
      const pdfCount = parseInt(row[7], 10) || 0;
      const imageCount = parseInt(row[8], 10) || 0;
      const blogNarrative = row[9] || "";
      
      let customValues = {};
      try {
        if (row[10] && row[10].trim().startsWith("{")) {
          customValues = JSON.parse(row[10]);
        }
      } catch (e) {}

      const createdAt = row[11] || new Date().toISOString();
      const workTypes = row[12] ? row[12].split(",").map((s: string) => s.trim()).filter(Boolean) : [];
      const contentUpdates = row[13] ? row[13].split(",").map((s: string) => s.trim()).filter(Boolean) : [];
      const workSummary = row[14] || "";
      const forumCount = parseInt(row[15], 10) || 0;
      const videoPptCount = parseInt(row[16], 10) || 0;
      const profileCount = parseInt(row[17], 10) || 0;
      const linkCount = parseInt(row[18], 10) || 0;
      const extraWorkNote = row[19] || "";

      const workItem = {
        id: subBlockId,
        projectId,
        projectName,
        listingCount,
        blogCount,
        forumCount,
        pdfCount,
        imageCount,
        videoPptCount,
        profileCount,
        linkCount,
        blog: blogNarrative,
        customValues,
        workTypes,
        contentUpdates,
        selectedKeywords: (customValues as any)?.selectedKeywords || [],
        workSummary,
        extraWorkNote
      };

      if (!groupedEntries[dsrParentId]) {
        groupedEntries[dsrParentId] = {
          id: dsrParentId,
          date,
          userEmail,
          works: [],
          createdAt,
        };
      }
      groupedEntries[dsrParentId].works.push(workItem);
    }

    return Object.values(groupedEntries).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  };

  const mergeWithLocalSubmissions = async (sheetEntries: any[]) => {
    let localEntries = [];
    try {
      localEntries = await getSubmissionsDb();
    } catch (e) {
      localEntries = [];
    }

    if (!Array.isArray(localEntries)) {
      localEntries = [];
    }

    const sheetIds = new Set(sheetEntries.map(e => String(e.id || "").trim().toLowerCase()));
    const merged = [...sheetEntries];
    for (const local of localEntries) {
      if (!local.id) continue;
      const cleanLocalId = String(local.id).trim().toLowerCase();
      if (!sheetIds.has(cleanLocalId)) {
        merged.push(local);
      }
    }

    merged.sort((a, b) => {
      const aTime = a.createdAt || a.date || "";
      const bTime = b.createdAt || b.date || "";
      return bTime.localeCompare(aTime);
    });

    return merged;
  };

  const token = await getGoogleAccessToken();
  if (token) {
    for (const candidate of candidates) {
      const range = encodeURIComponent(`${candidate}!A1:S3000`);
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values/${range}`;

      try {
        const res = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        });

        if (res.ok) {
          const data = await res.json();
          const rows: string[][] = data.values || [];
          const sortedList = parseSubmissionsRows(rows);
          const finalMergedList = await mergeWithLocalSubmissions(sortedList);
          await saveSubmissionsBulkDb(finalMergedList);
          return finalMergedList;
        }
      } catch (err: any) {
        console.warn(`Failed reading submissions authenticated from candidate tab "${candidate}":`, err.message);
      }
    }
  }

  // Fallback to public CSV fetcher
  for (const candidate of candidates) {
    const url = `https://docs.google.com/spreadsheets/d/${cleanId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(candidate)}`;
    try {
      const res = await fetch(url);
      if (res.ok) {
        const text = await res.text();
        const rows = parseCSV(text);
        if (rows && rows.length > 0) {
          const sortedList = parseSubmissionsRows(rows);
          const finalMergedList = await mergeWithLocalSubmissions(sortedList);
          await saveSubmissionsBulkDb(finalMergedList);
          return finalMergedList;
        }
      }
    } catch (err: any) {
      console.warn(`Failed reading submissions public CSV from candidate tab "${candidate}":`, err.message);
    }
  }

  return null;
}

async function appendSubmissionToGoogleSheet(works: any[], date: string, userEmail: string, customCreatedAt?: string): Promise<boolean> {
  const token = await getGoogleAccessToken();
  if (!token) return false;

  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID;
  if (!spreadsheetId) return false;

  const cleanId = spreadsheetId.trim();
  const sheetName = "DSR_Logs"; 
  const range = encodeURIComponent(`${sheetName}!A1:T1`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values/${range}:append?valueInputOption=USER_ENTERED`;

  const headers = [
    "DSR ID",
    "Reporting Date",
    "User Email",
    "Project ID",
    "Project Name",
    "Listing Count",
    "Blog Count",
    "PDF Count",
    "Image Count",
    "Work Narrative",
    "Custom Values JSON",
    "CreatedAt",
    "Work Types",
    "Content Updates",
    "Work Summary",
    "Forum Count",
    "Video PPT Count",
    "Profile Count",
    "Link Count",
    "Extra Work Note"
  ];

  try {
    const testUrl = `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values/${encodeURIComponent(sheetName + "!A1:A2")}`;
    const headRes = await fetch(testUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (headRes.ok) {
      const headData = await headRes.json();
      if (!headData.values || headData.values.length === 0) {
        const initUrl = `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values/${encodeURIComponent(sheetName + "!A1")}?valueInputOption=USER_ENTERED`;
        await fetch(initUrl, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ values: [headers] }),
        });
      }
    }

    let submissionId = `dsr-${Date.now()}`;
    if (works && works[0] && works[0].id) {
      const parts = works[0].id.split("-");
      if (parts[0] === "dsr") {
        submissionId = parts.slice(0, 2).join("-");
      }
    }
    const createdAt = customCreatedAt || new Date().toISOString();

    const rowsToWrite = works.map((work, index) => {
      const blockId = `${submissionId}-${index}`;
      return [
        blockId,
        date,
        userEmail,
        work.projectId || "",
        work.projectName || "",
        (work.listingCount || 0).toString(),
        (work.blogCount || 0).toString(),
        (work.pdfCount || 0).toString(),
        (work.imageCount || 0).toString(),
        work.blog || "",
        JSON.stringify(work.customValues || {}),
        createdAt,
        (work.workTypes || []).join(", "),
        (work.contentUpdates || []).join(", "),
        work.workSummary || "",
        (work.forumCount ?? 0).toString(),
        (work.videoPptCount ?? 0).toString(),
        (work.profileCount ?? 0).toString(),
        (work.linkCount ?? 0).toString(),
        work.extraWorkNote || ""
      ];
    });

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        values: rowsToWrite,
      }),
    });

    if (res.ok) {
      return true;
    }
  } catch (error: any) {
    console.error("Error appending submission to Google Sheets:", error.message);
  }
  return false;
}

// ==========================================
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

// POST verify user login email
app.post("/api/auth/verify", (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ allowed: false, error: "Email is required." });
  }

  const emailLower = email.trim().toLowerCase();
  const isAdmin = isUserAdmin(emailLower);

  if (!ALLOWED_USERS.some(u => u.toLowerCase() === emailLower)) {
    ALLOWED_USERS.push(emailLower);
  }

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
    // Sync from Google Sheets first if credentials are valid
    await syncProjectsFromGoogleSheet();

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
      project.id = project.domain.toLowerCase().replace(/[^a-z0-9]/g, "-") || `p-${Date.now()}`;
      await saveProjectDb(project);
    } else if (action === "edit" && project) {
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

// GET filters combinations
app.get("/api/filters", async (req, res) => {
  try {
    // Sync both from Google Sheets first if credentials are valid
    await syncProjectsFromGoogleSheet();
    await syncSubmissionsFromGoogleSheet();

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
    const userMap = new Map<string, string>();

    const formatUserEmailToName = (email: string): string => {
      if (!email) return "";
      let clean = email.trim();
      if (clean.includes("@")) {
        clean = clean.split("@")[0];
      }
      if (clean.includes(".") || clean.includes("-") || clean.includes("_")) {
        return clean
          .split(/[\._-]/)
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(" ");
      }
      return clean.charAt(0).toUpperCase() + clean.slice(1);
    };

    projectsArr.forEach((p: any) => {
      if (p.region) uniqueRegions.add(p.region);
      if (p.userId && String(p.userId).trim()) {
        const uId = String(p.userId).trim().toLowerCase();
        if (!isUserAdmin(uId)) {
          let assignedName = "";
          if (p.users && Array.isArray(p.users) && p.users.length > 0) {
            assignedName = p.users.find((u: string) => !/^\d+$/.test(u.trim())) || p.users[0];
          }
          if (!assignedName) {
            assignedName = formatUserEmailToName(uId);
          }
          const formattedName = assignedName
            .split(' ')
            .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');
          
          userMap.set(uId, formattedName);
        }
      }
    });

    let submissionsArr = await getSubmissionsDb();

    submissionsArr.forEach((entry: any) => {
      if (entry.userEmail) {
        const userStr = entry.userEmail.trim().toLowerCase();
        if (userStr && !isUserAdmin(userStr)) {
          if (!userMap.has(userStr)) {
            userMap.set(userStr, formatUserEmailToName(userStr));
          }
        }
      }
    });

    if (uniqueRegions.size === 0) {
      uniqueRegions.add("North");
      uniqueRegions.add("West");
      uniqueRegions.add("South");
    }

    const finalUsers = Array.from(userMap.entries()).map(([emailStr, nameStr]) => {
      return {
        email: emailStr,
        name: nameStr
      };
    }).sort((a, b) => a.name.localeCompare(b.name));

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

// GET Submissions Logs
app.get("/api/submissions", async (req, res) => {
  try {
    // Sync from Google Sheets first if credentials are valid
    await syncSubmissionsFromGoogleSheet();

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
    const deleted = await deleteSubmissionDb(id);
    if (!deleted) {
      return res.status(500).json({ error: "Failed to delete submission from database." });
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

const writeRankings = async (rankings: Record<string, Record<string, { ranking: string; lastChecked: string }>>) => {
  await saveRankingsDb(rankings);
};

async function checkSerpRanking(keyword: string, domain: string): Promise<string> {
  const apiKey = (process.env.SERP_API_KEY || "").trim();
  let apiUrl = (process.env.SERP_API_URL || "https://serpapi.com/search.json").trim();

  if (!apiKey) {
    console.warn("⚠️ SERP_API_KEY is not configured in environment.");
    return "NA";
  }

  if (apiUrl.includes("serpapi.com") && !apiUrl.includes("/search")) {
    apiUrl = "https://serpapi.com/search.json";
  } else if (apiUrl.includes("valueserp.com") && !apiUrl.includes("/search")) {
    apiUrl = "https://api.valueserp.com/search";
  } else if (apiUrl.includes("scaleserp.com") && !apiUrl.includes("/search")) {
    apiUrl = "https://api.scaleserp.com/search";
  } else if (apiUrl.includes("searchapi.io") && !apiUrl.includes("/api/v1/search")) {
    apiUrl = "https://www.searchapi.io/api/v1/search";
  } else if (apiUrl.includes("serpstack.com") && !apiUrl.includes("/search")) {
    apiUrl = "http://api.serpstack.com/search";
  }

  if (!apiUrl.startsWith("http://") && !apiUrl.startsWith("https://")) {
    apiUrl = "https://serpapi.com/search.json";
  }

  try {
    const cleanDomain = domain.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, "").split('/')[0].trim();
    let fetchUrl = "";
    
    if (apiUrl.includes("serpapi.com")) {
      fetchUrl = `${apiUrl}?q=${encodeURIComponent(keyword)}&api_key=${apiKey}&engine=google&num=100&gl=in&hl=en`;
    } else if (apiUrl.includes("valueserp.com") || apiUrl.includes("scaleserp.com")) {
      fetchUrl = `${apiUrl}?q=${encodeURIComponent(keyword)}&api_key=${apiKey}&num=100&gl=in&hl=en`;
    } else if (apiUrl.includes("searchapi.io")) {
      fetchUrl = `${apiUrl}?q=${encodeURIComponent(keyword)}&api_key=${apiKey}&engine=google&num=100&gl=in&hl=en`;
    } else if (apiUrl.includes("serpstack.com")) {
      fetchUrl = `${apiUrl}?query=${encodeURIComponent(keyword)}&access_key=${apiKey}&num=100&gl=in&hl=en`;
    } else {
      const separator = apiUrl.includes("?") ? "&" : "?";
      fetchUrl = `${apiUrl}${separator}q=${encodeURIComponent(keyword)}&api_key=${apiKey}&key=${apiKey}&query=${encodeURIComponent(keyword)}&num=100&gl=in&hl=en`;
    }

    const response = await fetch(fetchUrl, {
      method: "GET",
      headers: {
        "Accept": "application/json"
      }
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error(`SERP API returned status ${response.status}`);
      return "NA";
    }

    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch {
      return "NA";
    }

    const results = data.organic_results || data.organic || data.results || [];
    
    if (!Array.isArray(results) || results.length === 0) {
      return "NA";
    }

    for (let i = 0; i < results.length; i++) {
      const item = results[i];
      const link = item.link || item.url || item.formatted_url || "";
      if (link && link.toLowerCase().includes(cleanDomain)) {
        const position = item.position !== undefined ? String(item.position) : String(i + 1);
        return position;
      }
    }

    return "100+";
  } catch (err) {
    console.error("Error fetching ranking from SERP API:", err);
    return "NA";
  }
}

// GET rankings
app.get("/api/rankings", async (req, res) => {
  try {
    const rankings = await readRankings();
    res.json(rankings);
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
      await writeRankings(rankings);
      return res.json({ projectId, keyword, ranking: rankings[projectId][keyword] });
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

      await writeRankings(rankings);
      return res.json({ projectId, results });
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
    // Warm up the caches / fallbacks on boot
    syncProjectsFromGoogleSheet().catch(err => console.error("Boot projects sync error:", err));
    syncSubmissionsFromGoogleSheet().catch(err => console.error("Boot submissions sync error:", err));
  });
}

if (!process.env.VERCEL) {
  startServer();
}

export default app;
