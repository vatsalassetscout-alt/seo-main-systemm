/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Project, DSREntry, ProjectWork } from '../types';

// Helper to extract Spreadsheet ID from links or raw ID strings
export function extractSpreadsheetId(url: string): string {
  const cleanUrl = url.trim();
  if (!cleanUrl) return '';
  
  // match standard google spreadsheet url structures
  const match = cleanUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) {
    return match[1];
  }
  return cleanUrl;
}

// Fetch list of projects from a Google Sheet
export async function fetchProjectsFromSheet(
  spreadsheetId: string,
  sheetName: string,
  token: string
): Promise<Project[]> {
  const cleanId = extractSpreadsheetId(spreadsheetId);
  const candidates = Array.from(new Set([
    sheetName,
    "sheet1",
    "Sheet1",
    "Projects_Mapping"
  ].filter(Boolean)));

  let lastError: Error | null = null;
  let rows: string[][] = [];
  let successfulTab = '';

  for (const candidate of candidates) {
    const range = encodeURIComponent(`${candidate}!A1:Z1000`);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values/${range}`;

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (res.ok) {
        const data = await res.json();
        if (data.values && data.values.length > 0) {
          rows = data.values;
          successfulTab = candidate;
          break;
        }
      } else {
        const errBody = await res.text();
        lastError = new Error(`Google Sheets returned ${res.status}: ${errBody}`);
      }
    } catch (err: any) {
      lastError = err;
    }
  }

  try {
    if (rows.length === 0) {
      // Auto-initialize headers if the sheet is completely empty
      await initSheetHeaders(cleanId, sheetName || 'sheet1', ['Project Name', 'Domain', 'Location', 'Region', 'Users', 'Keyword1', 'Keyword2', 'Keyword3', 'Keyword4', 'Keyword5', 'Keyword6', 'Keyword7', 'Keyword8'], token);
      return [];
    }

    const headers = rows[0] || [];
    const normalizedHeaders = headers.map((h: any) => String(h || '').toLowerCase().trim());

    // Auto-detect indices for absolute custom column flexibility
    const colIdx = {
      domain: normalizedHeaders.findIndex(h => h.includes('domain') || h.includes('website') || h.includes('url') || h.includes('link')),
      name: normalizedHeaders.findIndex(h => h.includes('project') || h.includes('name') || h === 'title'),
      location: normalizedHeaders.findIndex(h => h.includes('location') || h.includes('city') || h.includes('office')),
      region: normalizedHeaders.findIndex(h => h.includes('region') || h.includes('zone') || h === 'area'),
      users: normalizedHeaders.findIndex(h => h.includes('users') || h.includes('assign') || h.includes('member') || h.includes('staff') || h.includes('employee')),
      userId: normalizedHeaders.findIndex(h => h.includes('user id') || h.includes('userid') || h.includes('employee id') || h.includes('staff id') || h === 'uid' || h === 'id')
    };

    // Find up to 8 keyword columns
    const keywordColIdxs: number[] = [];
    normalizedHeaders.forEach((h, idx) => {
      if (h.includes('keyword')) {
        keywordColIdxs.push(idx);
      }
    });

    const projectRows = rows.slice(1);
    const mappedProjects: Project[] = projectRows.map((row: any[]) => {
      const getVal = (idx: number, fallback: string = "") => {
        return (idx !== -1 && row[idx] !== undefined && row[idx] !== null) ? String(row[idx]).trim() : fallback;
      };

      const domain = getVal(colIdx.domain);
      const name = getVal(colIdx.name, domain || "Unnamed Project");
      
      const cleanDomain = domain.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
      const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
      const id = cleanDomain || cleanName || `p-${Math.random().toString(36).substr(2, 9)}`;
      const code = name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase() || "PROJ";

      const location = getVal(colIdx.location, "Mumbai");
      const region = getVal(colIdx.region, "West");
      const usersStr = getVal(colIdx.users);
      const userId = getVal(colIdx.userId);
      const description = "";

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
        description,
        priority: "",
        frequency: "",
        keywords
      };
    }).filter((p: Project) => p.name);

    // Deduplicate and merge projects by id
    const deduplicatedMap = new Map<string, Project>();
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
  } catch (error) {
    console.error('Error fetching projects from Sheet:', error);
    throw error;
  }
}

/// Write submissions/DSR rows to Google Sheets
export async function appendSubmissionsToSheet(
  spreadsheetId: string,
  sheetName: string,
  works: Omit<ProjectWork, 'id'>[],
  date: string,
  userEmail: string,
  token: string
): Promise<boolean> {
  const cleanId = extractSpreadsheetId(spreadsheetId);
  const range = encodeURIComponent(`${sheetName}!A1:S1`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values/${range}:append?valueInputOption=USER_ENTERED`;

  // Standard submission log headers schema with added columns
  const headers = [
    'DSR ID',
    'Reporting Date',
    'User Email',
    'Project ID',
    'Project Name',
    'Listing Count',
    'Blog Count',
    'PDF Count',
    'Image Count',
    'Work Narrative',
    'Custom Values JSON',
    'CreatedAt',
    'Work Types',
    'Content Updates',
    'Work Summary',
    'Forum Count',
    'Video PPT Count',
    'Profile Count',
    'Link Count'
  ];

  try {
    // Check if sheet is empty to seed headers first
    const testUrl = `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values/${encodeURIComponent(sheetName + '!A1:A2')}`;
    const headRes = await fetch(testUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (headRes.ok) {
      const headData = await headRes.json();
      if (!headData.values || headData.values.length === 0) {
        await initSheetHeaders(cleanId, sheetName, headers, token);
      }
    }

    // Map each work block to a spreadsheet row
    const submissionId = `dsr-${Date.now()}`;
    const createdAt = new Date().toISOString();

    const rowsToWrite = works.map((work, index) => {
      const blockId = `${submissionId}-${index}`;
      return [
        blockId,
        date,
        userEmail,
        work.projectId,
        work.projectName,
        work.listingCount.toString(),
        work.blogCount.toString(),
        work.pdfCount.toString(),
        work.imageCount.toString(),
        work.blog || '',
        JSON.stringify(work.customValues || {}),
        createdAt,
        (work.workTypes || []).join(', '),
        (work.contentUpdates || []).join(', '),
        work.workSummary || '',
        (work.forumCount ?? 0).toString(),
        (work.videoPptCount ?? 0).toString(),
        (work.profileCount ?? 0).toString(),
        (work.linkCount ?? 0).toString()
      ];
    });

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: rowsToWrite,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('Failed appending DSR cells:', text);
      throw new Error(`Sheets Append Error: ${res.status}`);
    }

    return true;
  } catch (error) {
    console.error('Error logging to Google Sheets:', error);
    throw error;
  }
}

// Fetch all DSR Submissions back from Google Sheets to show on Admin Dashboard and logs
export async function fetchSubmissionsFromSheet(
  spreadsheetId: string,
  sheetName: string,
  token: string
): Promise<DSREntry[]> {
  const cleanId = extractSpreadsheetId(spreadsheetId);
  const range = encodeURIComponent(`${sheetName}!A1:S2000`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values/${range}`;

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('Failed reading submissions Sheet:', err);
      throw new Error(`Sheets Read Error: ${res.status}`);
    }

    const data = await res.json();
    const rows: string[][] = data.values || [];

    if (rows.length <= 1) {
      return []; // empty or only headers
    }

    // Rows represent flattened ProjectWork entries categorized under different DSR submission dates.
    // We will group them by (DSR Submissions Id / Date + UserEmail combo) or group rows matching the same DSR ID.
    const groupedEntries: Record<string, DSREntry> = {};

    // First row is headers:
    // 0: DSR ID, 1: Reporting Date, 2: User Email, 3: Project ID, 4: Project Name,
    // 5: Listing, 6: Blog, 7: PDF, 8: Image, 9: Work Narrative, 10: Custom Values JSON, 11: CreatedAt
    // 12: Work Types, 13: Content Updates, 14: Work Summary, 15: Forum, 16: Video PPT, 17: Profile, 18: Link
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row[0] || !row[1] || !row[2]) continue;

      const subBlockId = row[0]; // e.g. "dsr-1718210331-0"
      // Parent DSR ID is parsed by splitting the sub-block appendix suffix if present
      const dsrParentId = subBlockId.split('-').slice(0, 2).join('-');
      const date = row[1];
      const userEmail = row[2];
      const projectId = row[3] || '';
      const projectName = row[4] || '';
      const listingCount = parseInt(row[5], 10) || 0;
      const blogCount = parseInt(row[6], 10) || 0;
      const pdfCount = parseInt(row[7], 10) || 0;
      const imageCount = parseInt(row[8], 10) || 0;
      const blogNarrative = row[9] || '';
      
      let customValues = {};
      try {
        if (row[10] && row[10].trim().startsWith('{')) {
          customValues = JSON.parse(row[10]);
        }
      } catch (e) {
        console.warn('Skipping corrupted custom JSON:', row[10], e);
      }

      const createdAt = row[11] || new Date().toISOString();
      const workTypes = row[12] ? row[12].split(',').map((s: string) => s.trim()).filter(Boolean) : [];
      const contentUpdates = row[13] ? row[13].split(',').map((s: string) => s.trim()).filter(Boolean) : [];
      const workSummary = row[14] || '';
      const forumCount = parseInt(row[15], 10) || 0;
      const videoPptCount = parseInt(row[16], 10) || 0;
      const profileCount = parseInt(row[17], 10) || 0;
      const linkCount = parseInt(row[18], 10) || 0;

      const workItem: ProjectWork = {
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
        workSummary
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

    // Convert compiled map dictionary back to ordered array list (latest first)
    return Object.values(groupedEntries).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (error) {
    console.error('Error fetching submissions from sheet backend:', error);
    throw error;
  }
}

// Seeder to write default headers into a worksheet if empty
async function initSheetHeaders(
  spreadsheetId: string,
  sheetName: string,
  headers: string[],
  token: string
): Promise<void> {
  const range = encodeURIComponent(`${sheetName}!A1`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`;

  try {
    await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: [headers],
      }),
    });
  } catch (error) {
    console.warn('Silent warning seeding headers:', error);
  }
}

// Fetch project locations (North / West) from Google Sheets
export async function fetchLocationsFromSheet(
  spreadsheetId: string,
  sheetName: string,
  token: string
): Promise<any[]> {
  const cleanId = extractSpreadsheetId(spreadsheetId);
  const range = encodeURIComponent(`${sheetName}!A1:C300`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values/${range}`;

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error('Failed to fetch project locations from Sheet:', errBody);
      // Auto-initialize headers if the sheet does not exist / errors
      await initSheetHeaders(cleanId, sheetName, ['Project ID', 'North', 'West'], token);
      return [];
    }

    const data = await res.json();
    const rows: string[][] = data.values || [];

    if (rows.length === 0) {
      await initSheetHeaders(cleanId, sheetName, ['Project ID', 'North', 'West'], token);
      return [];
    }

    // Skip headers
    const dataRows = rows.slice(1);

    return dataRows
      .filter(row => row[0]) // Must have projectId
      .map(row => ({
        projectId: row[0].trim(),
        north: (row[1] || '').trim(),
        west: (row[2] || '').trim()
      }));
  } catch (error) {
    console.error('Error fetching locations from Sheet:', error);
    return [];
  }
}

