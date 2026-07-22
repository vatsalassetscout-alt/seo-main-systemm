/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Single source of truth for mapping Google Sheet header text -> field names.
//
// WHY THIS FILE EXISTS:
// There used to be THREE separate, slightly different copies of this
// detection logic (client sheetsService.ts, server mapRowsToProjects,
// server updateProjectInGoogleSheet). Because each copy used loose
// `.includes()` matching with no protection against one header being
// claimed by two different fields, a header like "Users" could get
// matched by the generic `name` detector, or "User ID" could get
// swallowed by the `users` detector - silently shifting every column
// after it and making "Location" show "Project Name"'s value (or vice
// versa) depending on which function ran.
//
// Fix: every header index can be claimed by AT MOST ONE field. Once a
// column is matched, it's removed from the candidate pool so nothing
// else can grab it. Matchers are tried most-specific-first.

export interface SheetColumnMap {
  userId: number;
  users: number;
  name: number;
  domain: number;
  location: number;
  region: number;
  priority: number;
  frequency: number;
  keywords: number[];
}

// The exact recommended header order. If the sheet's header row matches
// this (case/spacing-insensitive), we map by position directly - no
// guessing at all, zero chance of collision.
export const CANONICAL_HEADERS = [
  'user id',
  'users',
  'project name',
  'domain',
  'location',
  'region',
];

export function detectColumns(headers: string[]): SheetColumnMap {
  const normalized = headers.map(h => String(h || '').toLowerCase().trim());

  // Fast path: header row matches the canonical layout exactly (ignoring
  // keyword columns after it) -> map by fixed position, guaranteed correct.
  const matchesCanonical = CANONICAL_HEADERS.every((expected, i) => normalized[i] === expected);
  if (matchesCanonical) {
    const keywords: number[] = [];
    normalized.forEach((h, i) => {
      if (i >= CANONICAL_HEADERS.length && h.includes('keyword')) keywords.push(i);
    });
    return {
      userId: 0,
      users: 1,
      name: 2,
      domain: 3,
      location: 4,
      region: 5,
      priority: normalized.findIndex(h => h.includes('priority') || h === 'prio'),
      frequency: normalized.findIndex(h => h.includes('frequency') || h.includes('freq')),
      keywords,
    };
  }

  // Fallback path: fuzzy detection, but collision-safe - each header index
  // can only ever be claimed once, and matchers run most-specific-first.
  const used = new Set<number>();
  const findCol = (matchers: Array<(h: string) => boolean>): number => {
    for (const matcher of matchers) {
      const idx = normalized.findIndex((h, i) => !used.has(i) && matcher(h));
      if (idx !== -1) {
        used.add(idx);
        return idx;
      }
    }
    return -1;
  };

  const userId = findCol([
    h => h === 'user id' || h === 'userid',
    h => h.includes('user id') || h.includes('userid') || h.includes('employee id') || h.includes('staff id'),
    h => h === 'uid' || h === 'id',
  ]);

  const users = findCol([
    h => h === 'users',
    h => h.includes('users') || h.includes('assign') || h.includes('member') || h.includes('staff') || h.includes('employee'),
  ]);

  const name = findCol([
    h => h === 'project name' || h === 'projectname',
    h => h.includes('project name') || h.includes('projectname'),
    h => h.includes('project'),
    h => h === 'title' || h === 'name',
  ]);

  const domain = findCol([
    h => h === 'domain',
    h => h.includes('domain') || h.includes('website') || h.includes('url') || h.includes('link'),
  ]);

  const location = findCol([
    h => h === 'location',
    h => h.includes('location') || h.includes('city') || h.includes('office'),
  ]);

  const region = findCol([
    h => h === 'region',
    h => h.includes('region') || h.includes('zone') || h === 'area',
  ]);

  const priority = findCol([h => h.includes('priority') || h === 'prio']);
  const frequency = findCol([h => h.includes('frequency') || h.includes('freq')]);

  const keywords: number[] = [];
  normalized.forEach((h, i) => {
    if (!used.has(i) && h.includes('keyword')) {
      keywords.push(i);
      used.add(i);
    }
  });

  return { userId, users, name, domain, location, region, priority, frequency, keywords };
}
