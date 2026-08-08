/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { AppUser, TaskAssignment } from '../types';
import {
  Trash2,
  Play,
  Pause,
  CheckCircle2,
  Clock,
  AlertTriangle,
  PenTool,
  ListChecks,
  ChevronDown,
  ChevronUp,
  CalendarDays,
} from 'lucide-react';

interface TaskLineupProps {
  isAdmin: boolean;
  currentUserEmail: string;
  allowedUsers: AppUser[];
  onSetAllowedUsers: (users: AppUser[]) => void;
  onJumpToWorkLog: (projectId: string, date: string) => void;
}

interface UserPendingSummary {
  email: string;
  name: string;
  totalTasks: number;
  yesterdayPendingCount: number;
  totalPendingCount: number;
  yesterdayPending: TaskAssignment[];
  totalPending: TaskAssignment[];
}

const PRIORITY_BADGE: Record<string, string> = {
  X1: 'bg-red-50 text-red-700 border-red-100',
  X2: 'bg-amber-50 text-amber-700 border-amber-100',
  X3: 'bg-blue-50 text-blue-700 border-blue-100',
  X4: 'bg-purple-50 text-purple-700 border-purple-100',
  X5: 'bg-gray-50 text-gray-700 border-gray-150',
};

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

// Pending ("not yet worked") tasks always float to the top; a Submitted
// (formerly "Done") task has already been handled, so it sinks to the
// bottom of whichever list it appears in.
const PRIORITY_RANK: Record<string, number> = { X1: 0, X2: 1, X3: 2, X4: 3, X5: 4 };

function priorityRank(priority: string): number {
  const rank = PRIORITY_RANK[priority];
  return rank === undefined ? 99 : rank;
}

// Orders the lineup by priority tier first (X1 -> X2 -> X3 -> X4 -> X5, with
// any unrecognised tier pushed to the end), then within each tier keeps
// pending items ahead of the ones already marked Done. Uses a stable sort
// so items that tie on both keys keep whatever order they arrived in.
function sortPendingFirst(list: TaskAssignment[]): TaskAssignment[] {
  return [...list].sort((a, b) => {
    const tierDiff = priorityRank(a.priority) - priorityRank(b.priority);
    if (tierDiff !== 0) return tierDiff;
    return (a.status === 'Done' ? 1 : 0) - (b.status === 'Done' ? 1 : 0);
  });
}

const Badge = ({ priority }: { priority: string }) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-black uppercase tracking-wider ${PRIORITY_BADGE[priority] || 'bg-gray-50 text-gray-500 border-gray-150'}`}>
    {priority || '—'}
  </span>
);

const PRIORITY_ORDER = ['X1', 'X2', 'X3', 'X4', 'X5'];

// Small "X1 3 · X2 2 · X3 1 · X4 1 · X5 0" style strip showing how many of
// each priority tier are in a given list of assignments. Tiers with a zero
// count are still shown (greyed out) so the full X1-X5 spread is always
// visible at a glance.
const PriorityDistribution = ({ items }: { items: TaskAssignment[] }) => {
  const counts = useMemo(() => {
    const map: Record<string, number> = { X1: 0, X2: 0, X3: 0, X4: 0, X5: 0 };
    items.forEach((a) => {
      if (map[a.priority] !== undefined) map[a.priority] += 1;
    });
    return map;
  }, [items]);

  return (
    <div className="flex items-center gap-1 shrink-0">
      {PRIORITY_ORDER.map((tier) => (
        <span
          key={tier}
          title={`${tier}: ${counts[tier]}`}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-black uppercase tracking-wider ${
            counts[tier] > 0
              ? PRIORITY_BADGE[tier] || 'bg-gray-50 text-gray-600 border-gray-150'
              : 'bg-gray-50 text-gray-300 border-gray-100'
          }`}
        >
          {tier}:
          <span className="font-mono font-black text-[12px]">{counts[tier]}</span>
        </span>
      ))}
    </div>
  );
};

// "Done" is renamed to "Submitted" for display only — the underlying status
// value in the data model is still 'Done'. When a task's owner is currently
// paused, a still-pending task shows "Paused" instead of "Pending" so admins
// can tell at a glance why it isn't moving.
const StatusBadge = ({ status, isPaused }: { status: string; isPaused?: boolean }) => (
  status === 'Done' ? (
    <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700">
      <CheckCircle2 size={13} /> Submitted
    </span>
  ) : isPaused ? (
    <span className="inline-flex items-center gap-1 text-xs font-bold text-gray-500">
      <Pause size={13} /> Paused
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-700">
      <Clock size={13} /> Pending
    </span>
  )
);

// Small reusable "list of pending projects" block used for both Yesterday
// Pending and Today Pending — project names, not just a bare count.
// `getOwner`, when passed (admin/History view), shows whose task it is.
const PendingProjectList = ({ items, getOwner }: { items: TaskAssignment[]; getOwner?: (a: TaskAssignment) => string }) => (
  items.length === 0 ? (
    <p className="text-xs font-semibold text-gray-400">Nothing pending — all caught up.</p>
  ) : (
    <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
      {sortPendingFirst(items).map((a) => (
        <div key={a.id} className="flex items-center justify-between text-sm font-bold text-gray-700">
          <span className="truncate pr-2">
            {a.projectName}
            {getOwner && <span className="block text-[10px] text-gray-400 font-semibold">{getOwner(a)}</span>}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <Badge priority={a.priority} />
            <span className="text-[10px] text-gray-400 font-semibold">{a.date}</span>
          </div>
        </div>
      ))}
    </div>
  )
);

export default function TaskLineup({
  isAdmin,
  currentUserEmail,
  allowedUsers,
  onSetAllowedUsers,
  onJumpToWorkLog,
}: TaskLineupProps) {
  // Local sub-navigation: "Task Lineup" (today's / a chosen day's projects)
  // vs "History" (Yesterday Pending + Today Pending), styled the same way
  // the top-level Work Log / Work Log History tabs are.
  const [view, setView] = useState<'lineup' | 'history'>('lineup');

  const [date, setDate] = useState<string>(''); // optional filter — empty means "just show the current lineup"
  const [assignments, setAssignments] = useState<TaskAssignment[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateMsg, setGenerateMsg] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [yesterdayPending, setYesterdayPending] = useState<TaskAssignment[]>([]);
  const [totalPending, setTotalPending] = useState<TaskAssignment[]>([]);
  const [totalPendingCount, setTotalPendingCount] = useState<number>(0);

  // History tab: today's still-pending tasks, loaded independently of the
  // date filter above so History always reflects "today", not whatever day
  // is currently selected on the Task Lineup tab.
  const [todayPending, setTodayPending] = useState<TaskAssignment[]>([]);
  const [todayPendingLoading, setTodayPendingLoading] = useState(false);

  // Lifetime engine controls (admin) — once started, the cycle never needs
  // a manual daily click again; "paused" is the long-vacation switch.
  const [engineActive, setEngineActive] = useState(false);
  const [enginePaused, setEnginePaused] = useState(false);
  const [engineBusy, setEngineBusy] = useState(false);

  // Admin "Check Pendings" drill-down — one button per user, everyone's
  // totals + yesterday/total pending lists in one panel.
  const [showCheckPendings, setShowCheckPendings] = useState(false);
  const [pendingAllUsers, setPendingAllUsers] = useState<UserPendingSummary[]>([]);
  const [pendingAllLoading, setPendingAllLoading] = useState(false);
  const [selectedPendingEmail, setSelectedPendingEmail] = useState<string | null>(null);

  // History tab: day-by-day assignment calendar — click any past/today date
  // to see every user's assigned projects for that day and whether each one
  // was Submitted or Not Submitted. Separate from the main "lineup" state
  // above so browsing the calendar never disturbs the Task Lineup tab.
  const [historyCalMonth, setHistoryCalMonth] = useState(() => new Date().getMonth());
  const [historyCalYear, setHistoryCalYear] = useState(() => new Date().getFullYear());
  const [historyCalDay, setHistoryCalDay] = useState<string | null>(null);
  const [historyCalAssignments, setHistoryCalAssignments] = useState<TaskAssignment[]>([]);
  const [historyCalLoading, setHistoryCalLoading] = useState(false);

  const activeDate = date || todayStr();

  const authHeaders = useMemo(() => ({
    'Content-Type': 'application/json',
    'x-user-email': currentUserEmail || '',
    'x-user-role': isAdmin ? 'admin' : 'user',
  }), [currentUserEmail, isAdmin]);

  const loadLineup = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/task-lineup?date=${encodeURIComponent(d)}`, { headers: authHeaders });
      const data = await res.json();
      setAssignments(Array.isArray(data.assignments) ? data.assignments : []);
    } catch (err) {
      console.error('Failed to load Task Lineup:', err);
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  const loadPendingSummary = useCallback(async () => {
    try {
      const url = isAdmin ? '/api/task-lineup/pending-summary' : `/api/task-lineup/pending-summary?userEmail=${encodeURIComponent(currentUserEmail || '')}`;
      const res = await fetch(url, { headers: authHeaders });
      const data = await res.json();
      setYesterdayPending(Array.isArray(data.yesterdayPending) ? data.yesterdayPending : []);
      setTotalPending(Array.isArray(data.totalPending) ? data.totalPending : []);
      setTotalPendingCount(typeof data.totalPendingCount === 'number' ? data.totalPendingCount : 0);
    } catch (err) {
      console.error('Failed to load pending summary:', err);
    }
  }, [authHeaders, isAdmin, currentUserEmail]);

  // Today's still-pending tasks — for History. Non-admins only see their own;
  // admins see everyone's.
  const loadTodayPending = useCallback(async () => {
    setTodayPendingLoading(true);
    try {
      const res = await fetch(`/api/task-lineup?date=${encodeURIComponent(todayStr())}`, { headers: authHeaders });
      const data = await res.json();
      const list: TaskAssignment[] = Array.isArray(data.assignments) ? data.assignments : [];
      const mine = (a: TaskAssignment) => a.userEmail.trim().toLowerCase() === (currentUserEmail || '').trim().toLowerCase();
      setTodayPending(list.filter(a => a.status === 'Pending' && (isAdmin || mine(a))));
    } catch (err) {
      console.error('Failed to load today pending:', err);
    } finally {
      setTodayPendingLoading(false);
    }
  }, [authHeaders, isAdmin, currentUserEmail]);

  const loadEngineStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/task-lineup/engine-status', { headers: authHeaders });
      const data = await res.json();
      setEngineActive(!!data.active);
      setEnginePaused(!!data.paused);
    } catch (err) {
      console.error('Failed to load engine status:', err);
    }
  }, [authHeaders]);

  const loadPendingAllUsers = useCallback(async () => {
    setPendingAllLoading(true);
    try {
      const res = await fetch('/api/task-lineup/pending-summary/all', { headers: authHeaders });
      const data = await res.json();
      setPendingAllUsers(Array.isArray(data.users) ? data.users : []);
    } catch (err) {
      console.error('Failed to load per-user pending summary:', err);
    } finally {
      setPendingAllLoading(false);
    }
  }, [authHeaders]);

  // Fetch every user's assignments for one specific calendar day (History tab).
  const loadHistoryCalDay = useCallback(async (d: string) => {
    setHistoryCalLoading(true);
    try {
      const res = await fetch(`/api/task-lineup?date=${encodeURIComponent(d)}`, { headers: authHeaders });
      const data = await res.json();
      setHistoryCalAssignments(Array.isArray(data.assignments) ? data.assignments : []);
    } catch (err) {
      console.error('Failed to load calendar day assignments:', err);
      setHistoryCalAssignments([]);
    } finally {
      setHistoryCalLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    loadLineup(activeDate);
    if (!isAdmin) loadPendingSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDate, loadLineup, isAdmin, loadPendingSummary]);

  useEffect(() => {
    if (isAdmin) {
      loadEngineStatus();
      loadPendingAllUsers();
    }
  }, [isAdmin, loadEngineStatus, loadPendingAllUsers]);

  // Load History data lazily, only once the History tab is opened.
  useEffect(() => {
    if (view === 'history') {
      loadTodayPending();
      if (isAdmin) loadPendingAllUsers();
      else loadPendingSummary();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const handleStartEngine = async () => {
    setEngineBusy(true);
    setGenerateMsg(null);
    try {
      const res = await fetch('/api/task-lineup/engine/start', { method: 'POST', headers: authHeaders });
      const data = await res.json();
      // The server now reports real failures with a non-OK status instead of
      // always returning success — treat that as an error instead of
      // silently accepting whatever came back.
      if (!res.ok) throw new Error(data?.error || 'Failed to start the cycle.');
      setEngineActive(!!data.active);
      setEnginePaused(!!data.paused);
      setGenerateMsg('Cycle started — it now runs on its own every day going forward. Use Pause below for long vacations.');
      await loadLineup(activeDate);
      await loadPendingAllUsers();
    } catch (err: any) {
      console.error('Failed to start engine:', err);
      setGenerateMsg(`Couldn't start the cycle: ${err?.message || 'check server logs.'}`);
      // Re-sync with whatever the DB actually has rather than leaving the
      // button in a state that doesn't match reality.
      await loadEngineStatus();
    } finally {
      setEngineBusy(false);
    }
  };

  const handleToggleEnginePause = async () => {
    setEngineBusy(true);
    setGenerateMsg(null);
    const nextPaused = !enginePaused;
    try {
      const res = await fetch('/api/task-lineup/engine/pause', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ paused: nextPaused }),
      });
      const data = await res.json();
      // Same fix as Start: previously this always read `data.paused` and
      // showed a success message even when the save failed server-side,
      // which is why Stop Cycle looked like it worked but reverted after
      // relogin. Now a failed save throws and gets surfaced to the admin.
      if (!res.ok) throw new Error(data?.error || 'Failed to update the cycle state.');
      setEnginePaused(!!data.paused);
      setGenerateMsg(nextPaused ? 'Cycle paused — nothing will auto-generate until you resume.' : 'Cycle resumed.');
      if (!nextPaused) {
        await loadLineup(activeDate);
        await loadPendingAllUsers();
      }
    } catch (err: any) {
      console.error('Failed to toggle engine pause:', err);
      setGenerateMsg(`Couldn't ${nextPaused ? 'pause' : 'resume'} the cycle: ${err?.message || 'check server logs.'} Reverting to the actual saved state.`);
      // Don't leave the button showing a state the DB doesn't actually have —
      // pull the real value back down.
      await loadEngineStatus();
    } finally {
      setEngineBusy(false);
    }
  };

  const handleDelete = async () => {
    const confirmed = window.confirm(
      `Full reset: this deletes EVERY task assignment for EVERY user on EVERY date (not just ${activeDate}), clears Yesterday Pending and Total Pending back to 0, and stops the cycle — you'll need to hit "Start Cycle" again afterwards. This cannot be undone. Continue?`
    );
    if (!confirmed) return;

    setDeleting(true);
    setGenerateMsg(null);
    try {
      const res = await fetch('/api/task-lineup/delete', {
        method: 'POST',
        headers: authHeaders,
      });
      const data = await res.json();
      setGenerateMsg(
        data.success
          ? `Full reset complete — deleted ${data.deletedCount} assignment${data.deletedCount === 1 ? '' : 's'}. All pending counts are back to 0. Hit "Start Cycle" to begin again.`
          : 'Failed to reset — check server logs.'
      );
      // Refresh everything the screen shows, not just the lineup list —
      // otherwise the pending counts and the Start/Resume button would keep
      // showing stale numbers until a full page reload.
      await Promise.all([
        loadLineup(activeDate),
        loadEngineStatus(),
        isAdmin ? loadPendingAllUsers() : loadPendingSummary(),
        loadTodayPending(),
      ]);
    } catch (err) {
      console.error('Failed to reset lineup:', err);
      setGenerateMsg('Something went wrong resetting the lineup — check server logs.');
    } finally {
      setDeleting(false);
    }
  };

  const togglePause = async (userEmail: string, paused: boolean) => {
    const previous = allowedUsers;
    // Optimistic update
    onSetAllowedUsers(allowedUsers.map(u => u.email === userEmail ? { ...u, paused } : u));
    try {
      const res = await fetch('/api/task-lineup/pause', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ userEmail, paused }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        // The server didn't actually persist it (e.g. no matching user row) —
        // roll the optimistic UI change back instead of showing a paused
        // state that isn't real and will just revert on the next refresh.
        onSetAllowedUsers(previous);
        setGenerateMsg('Could not update pause state — please try again.');
        return;
      }
      // Pausing clears today's pending queue for this user; resuming tops it
      // right back up. Refresh what's on screen so it doesn't look stale.
      await Promise.all([
        loadLineup(activeDate),
        loadPendingAllUsers(),
      ]);
    } catch (err) {
      console.error('Failed to toggle pause:', err);
      onSetAllowedUsers(previous);
      setGenerateMsg('Could not update pause state — please try again.');
    }
  };

  const nameFor = (email: string) => allowedUsers.find(u => u.email.trim().toLowerCase() === email.trim().toLowerCase())?.name || email;

  // Quick lookup: is this person currently paused? Checked by display NAME,
  // not raw email — same reasoning as groupedByUser below: the same person
  // can have two different app_users rows (a known duplicate-account issue),
  // and a task's userEmail might belong to whichever of their accounts
  // *isn't* the one that got paused. Matching by name means pausing someone
  // (any of their accounts) correctly marks ALL of their listed tasks as
  // Paused, not just the ones tied to that one exact email.
  const isNamePaused = (displayName: string) =>
    allowedUsers.some(u => u.name.trim().toLowerCase() === displayName.trim().toLowerCase() && !!u.paused);

  // Grouped by display NAME (not raw email). Two app_users rows can share the
  // same name with different emails (a known duplicate-account issue — see
  // Admin Settings > Users) which used to render as two separate cards for
  // the same person. We first group each account's assignments separately
  // (so every account's list stays exactly as the lineup engine generated
  // it), then for each name we keep ONLY the one account whose list is the
  // day's real generated lineup — the one with the most rows (ties broken by
  // whichever has more still-Pending items). Previously this unioned every
  // duplicate account's items together by project, which could pull in a
  // second, stale account's rows and inflate a person's card well past the
  // daily cap (e.g. showing 16-17 when the person themself only ever saw
  // their own capped lineup). Picking a single account's list instead means
  // admin sees exactly what that person sees when they're logged in.
  const groupedByUser = useMemo(() => {
    const byEmail = new Map<string, TaskAssignment[]>();
    assignments.forEach(a => {
      const emailKey = a.userEmail.trim().toLowerCase();
      if (!byEmail.has(emailKey)) byEmail.set(emailKey, []);
      byEmail.get(emailKey)!.push(a);
    });

    const byName = new Map<string, { displayName: string; items: TaskAssignment[] }>();
    byEmail.forEach((items, emailKey) => {
      const displayName = nameFor(emailKey);
      const key = displayName.trim().toLowerCase();
      const existing = byName.get(key);
      if (!existing) {
        byName.set(key, { displayName, items });
        return;
      }
      const existingPending = existing.items.filter(a => a.status !== 'Done').length;
      const candidatePending = items.filter(a => a.status !== 'Done').length;
      const candidateIsBetter =
        items.length > existing.items.length ||
        (items.length === existing.items.length && candidatePending > existingPending);
      if (candidateIsBetter) byName.set(key, { displayName, items });
    });

    return Array.from(byName.values())
      .map((v) => [v.displayName, sortPendingFirst(v.items)] as [string, TaskAssignment[]])
      .sort((a, b) => a[0].localeCompare(b[0]));
  }, [assignments, allowedUsers]);

  const myAssignments = useMemo(
    () => sortPendingFirst(assignments.filter(a => a.userEmail.trim().toLowerCase() === (currentUserEmail || '').trim().toLowerCase())),
    [assignments, currentUserEmail]
  );

  const isSunday = new Date(activeDate + 'T00:00:00Z').getUTCDay() === 0;

  const pendingStatsByEmail = useMemo(() => {
    const map = new Map<string, UserPendingSummary>();
    pendingAllUsers.forEach(u => map.set(u.email.trim().toLowerCase(), u));
    return map;
  }, [pendingAllUsers]);

  const selectedPendingSummary = useMemo(
    () => selectedPendingEmail ? pendingAllUsers.find(u => u.email.trim().toLowerCase() === selectedPendingEmail.trim().toLowerCase()) : null,
    [selectedPendingEmail, pendingAllUsers]
  );

  // History tab's "Yesterday Pending" — pooled across everyone for admins,
  // just the current user's for everyone else.
  const historyYesterdayPending = useMemo(
    () => (isAdmin ? pendingAllUsers.flatMap(u => u.yesterdayPending) : yesterdayPending),
    [isAdmin, pendingAllUsers, yesterdayPending]
  );

  // Calendar grid cells (blank leading slots + actual day numbers) for the
  // History tab's assignment-status calendar.
  const historyCalMonthDays = useMemo(() => {
    const firstDayOfWeek = new Date(historyCalYear, historyCalMonth, 1).getDay();
    const daysInMonth = new Date(historyCalYear, historyCalMonth + 1, 0).getDate();
    return {
      blanks: Array.from({ length: firstDayOfWeek }),
      days: Array.from({ length: daysInMonth }, (_, i) => i + 1),
    };
  }, [historyCalMonth, historyCalYear]);

  // Assignments for the currently selected calendar day, grouped by display
  // name — admins see every user's projects for that day, non-admins see
  // just their own (the backend already scopes the response accordingly).
  // Shown directly, no dropdown to pick a user first.
  const historyCalGroupedByUser = useMemo(() => {
    const map = new Map<string, TaskAssignment[]>();
    historyCalAssignments.forEach((a) => {
      const displayName = nameFor(a.userEmail);
      if (!map.has(displayName)) map.set(displayName, []);
      map.get(displayName)!.push(a);
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [historyCalAssignments, allowedUsers]);

  const maxDate = todayStr();

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-150 pb-6">
        {/* Page-level heading toggle — same "Submission | History" treatment
            used on the Work Log tab, available to admin and non-admin alike. */}
        <h1 className="text-xl font-black tracking-tight sm:text-2xl flex items-center gap-2">
          <button
            type="button"
            onClick={() => setView('lineup')}
            className={`text-xl font-black tracking-tight sm:text-2xl transition cursor-pointer ${
              view === 'lineup' ? 'text-gray-900' : 'text-gray-400 hover:text-indigo-600'
            }`}
          >
            Task Lineup
          </button>
          <span className="text-gray-400">|</span>
          <button
            type="button"
            onClick={() => setView('history')}
            className={`text-xl font-black tracking-tight sm:text-2xl transition cursor-pointer ${
              view === 'history' ? 'text-gray-900' : 'text-gray-400 hover:text-indigo-600'
            }`}
          >
            History
          </button>
        </h1>

        <div className="flex flex-col items-end gap-2">
          {isAdmin && (
            <div className="flex flex-wrap items-center gap-2">
              {!engineActive ? (
                <button
                  onClick={handleStartEngine}
                  disabled={engineBusy}
                  className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl transition cursor-pointer"
                >
                  <Play size={13} />
                  Start Cycle
                </button>
              ) : (
                <button
                  onClick={handleToggleEnginePause}
                  disabled={engineBusy}
                  className={`flex items-center gap-1.5 px-4 py-2 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-bold rounded-xl transition cursor-pointer ${
                    enginePaused ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700' : 'bg-amber-50 hover:bg-amber-100 text-amber-700'
                  }`}
                  title="The cycle runs every day on its own. Pause it only for long vacations."
                >
                  {enginePaused ? <Play size={13} /> : <Pause size={13} />}
                  {enginePaused ? 'Run Cycle' : 'Stop Cycle'}
                </button>
              )}
              <button
                onClick={handleDelete}
                disabled={deleting || generating}
                className="flex items-center gap-1.5 px-3 py-2 bg-red-50 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed text-red-700 text-xs font-bold rounded-xl transition cursor-pointer"
                title="Full reset: deletes every assignment for every user on every date and stops the cycle (Start Cycle required again)"
              >
                <Trash2 size={13} />
                Delete
              </button>
              {view === 'lineup' && (
                <button
                  onClick={() => setShowCheckPendings(v => !v)}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-xl transition cursor-pointer ${
                    showCheckPendings ? 'bg-indigo-600 text-white' : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700'
                  }`}
                  title="Check every user's total and yesterday's pending tasks"
                >
                  <ListChecks size={13} />
                  Check Pendings
                  {showCheckPendings ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </button>
              )}
              {view === 'lineup' && (
                <div className="flex items-center gap-1.5 pl-1">
                  <CalendarDays size={14} className="text-gray-400" />
                  <input
                    type="date"
                    value={date}
                    max={maxDate}
                    onChange={(e) => setDate(e.target.value)}
                    className="px-2.5 py-2 text-xs font-bold border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-200"
                  />
                  {date && (
                    <button
                      onClick={() => setDate('')}
                      className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {isSunday && view === 'lineup' && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-100 text-amber-800 text-xs font-bold px-3 py-2 rounded-xl">
          <AlertTriangle size={14} />
          Sundays are a rest day — the lineup engine doesn't generate assignments for this date.
        </div>
      )}

      {generateMsg && (
        <div className="text-xs font-bold text-gray-600 bg-gray-50 border border-gray-150 px-3 py-2 rounded-xl">
          {generateMsg}
        </div>
      )}

      {/* ================= TASK LINEUP TAB ================= */}
      {view === 'lineup' && (
        <>
          {/* Admin: "Check Pendings" drill-down — one button per user; pick
              someone to see their total + yesterday pending lists. */}
          {isAdmin && showCheckPendings && (
            <div className="bg-white rounded-2xl border border-gray-150 overflow-hidden shadow-xs">
              <div className="px-5 py-3 bg-gray-50 border-b border-gray-150">
                <p className="text-xs font-black text-gray-900">Check Pendings — by user</p>
                <p className="text-[10px] font-bold text-gray-400 mt-0.5">Pick a user to see their total and yesterday's pending tasks.</p>
              </div>
              <div className="p-4 flex flex-wrap gap-2 border-b border-gray-100">
                {pendingAllLoading ? (
                  <p className="text-xs font-bold text-gray-400 px-1">Loading users…</p>
                ) : pendingAllUsers.length === 0 ? (
                  <p className="text-xs font-bold text-gray-400 px-1">No users configured yet.</p>
                ) : (
                  [...pendingAllUsers].sort((a, b) => a.name.localeCompare(b.name)).map(u => (
                    <button
                      key={u.email}
                      onClick={() => setSelectedPendingEmail(u.email)}
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                        selectedPendingEmail && selectedPendingEmail.trim().toLowerCase() === u.email.trim().toLowerCase()
                          ? 'bg-indigo-600 text-white'
                          : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                      }`}
                    >
                      {u.name} · {u.totalPendingCount} pending
                    </button>
                  ))
                )}
              </div>
              {selectedPendingSummary && (
                <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                      {selectedPendingSummary.name} — Yesterday Pending ({selectedPendingSummary.yesterdayPendingCount})
                    </p>
                    <PendingProjectList items={selectedPendingSummary.yesterdayPending} />
                  </div>
                  <div>
                    <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                      {selectedPendingSummary.name} — Total Pending ({selectedPendingSummary.totalPendingCount})
                    </p>
                    <PendingProjectList items={selectedPendingSummary.totalPending} />
                  </div>
                  <div className="sm:col-span-2 text-[11px] text-gray-400 font-semibold">
                    Total tasks ever assigned to {selectedPendingSummary.name}: <span className="text-gray-600 font-bold">{selectedPendingSummary.totalTasks}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Non-admin: Today's Lineup — the date filter now lives in this
              card's own header, right-aligned, capped so a future date can't
              be picked. */}
          {!isAdmin && (
            <div className="bg-white rounded-2xl border border-gray-150 overflow-hidden shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 bg-gray-50 border-b border-gray-150">
                <p className="text-sm font-black text-gray-900">Today's Lineup</p>
                <div className="flex items-center gap-3">
                  <PriorityDistribution items={myAssignments} />
                  <div className="flex items-center gap-2">
                    <CalendarDays size={13} className="text-gray-400" />
                    <input
                      type="date"
                      value={date}
                      max={maxDate}
                      onChange={(e) => setDate(e.target.value)}
                      className="px-2.5 py-1.5 text-xs font-bold border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200"
                    />
                    {date && (
                      <button
                        onClick={() => setDate('')}
                        className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 cursor-pointer"
                      >
                        Today
                      </button>
                    )}
                  </div>
                </div>
              </div>
              {loading ? (
                <p className="px-5 py-6 text-xs font-bold text-gray-400">Loading…</p>
              ) : myAssignments.length === 0 ? (
                <p className="px-5 py-6 text-xs font-bold text-gray-400">No tasks assigned to you for this date yet.</p>
              ) : (
                <div className="divide-y divide-gray-100">
                  {myAssignments.map((a, idx) => (
                    <div key={a.id} className="flex items-center justify-between px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono font-bold text-gray-400 w-5 shrink-0">{idx + 1}.</span>
                        <span className="text-sm font-bold text-gray-700">{a.projectName}</span>
                        <Badge priority={a.priority} />
                      </div>
                      <div className="flex items-center gap-3">
                        <StatusBadge status={a.status} />
                        {a.status === 'Pending' && (
                          <button
                            onClick={() => onJumpToWorkLog(a.projectId, a.date)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-black rounded-lg transition cursor-pointer"
                          >
                            <PenTool size={12} />
                            Log Work
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Admin: standalone pause controls — always visible, independent of
              whether a lineup has been generated for the selected date yet.
              Pausing a user clears today's still-pending queue for them
              (already-Submitted work today is untouched) and excludes them
              from the next cycle; resuming immediately tops today's lineup
              back up with the same queue, in order, so nothing gets skipped.
              Each row now also shows total tasks, yesterday pending, and
              total pending. */}
          {isAdmin && (
            <div className="bg-white rounded-2xl border border-gray-150 overflow-hidden shadow-xs">
              <div className="px-5 py-3 bg-gray-50 border-b border-gray-150">
                <p className="text-xs font-black text-gray-900"> Controls</p>
              </div>
              {allowedUsers.length === 0 ? (
                <p className="px-5 py-4 text-xs font-bold text-gray-400">No users configured yet.</p>
              ) : (
                <div className="divide-y divide-gray-100">
                  {[...allowedUsers].sort((a, b) => a.name.localeCompare(b.name)).map((u) => {
                    const paused = !!u.paused;
                    const stats = pendingStatsByEmail.get(u.email.trim().toLowerCase());
                    return (
                      <div key={u.email} className="flex items-center justify-between px-5 py-2.5 gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-gray-800 truncate">{u.name}</p>
                          <p className="text-[10px] text-gray-400 font-semibold truncate">{u.email}</p>
                        </div>
                        <div className="flex items-center gap-4 shrink-0">
                          {stats && (
                            <div className="hidden md:flex items-center gap-3 text-[10px] font-bold text-gray-500">
                              <span title="Total tasks ever assigned">Total: <span className="text-gray-800">{stats.totalTasks}</span></span>
                              <span title="Still pending from yesterday">Yesterday: <span className="text-amber-700">{stats.yesterdayPendingCount}</span></span>
                              <span title="All-time pending">Pending: <span className="text-red-700">{stats.totalPendingCount}</span></span>
                            </div>
                          )}
                          <button
                            onClick={() => togglePause(u.email, !paused)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition cursor-pointer ${
                              paused ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                            }`}
                          >
                            {paused ? <Play size={12} /> : <Pause size={12} />}
                            {paused ? 'Resume' : 'Pause'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Admin: per-user grouped lineup for the selected date — Pending
              tasks list first, Submitted ones last. */}
          {isAdmin && (
            <div className="space-y-4">
              {loading ? (
                <p className="text-xs font-bold text-gray-400">Loading lineup…</p>
              ) : groupedByUser.length === 0 ? (
                <div className="bg-white rounded-2xl border border-gray-150 p-8 text-center">
                  <p className="text-sm font-bold text-gray-500">No lineup generated for this date yet.</p>
                </div>
              ) : (
                groupedByUser.map(([displayName, list]) => {
                  const doneCount = list.filter(a => a.status === 'Done').length;
                  return (
                    <div key={displayName} className="bg-white rounded-2xl border border-gray-150 overflow-hidden shadow-xs">
                      <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b border-gray-150 gap-3">
                        <div>
                          <p className="text-xs font-black text-gray-900">{displayName}</p>
                          <p className="text-[10px] font-bold text-gray-400">{doneCount}/{list.length} completed today</p>
                        </div>
                        <PriorityDistribution items={list} />
                      </div>
                      <div className="divide-y divide-gray-100">
                        {list.map((a, idx) => (
                          <div key={a.id} className="flex items-center justify-between px-5 py-2.5">
                            <div className="flex items-center gap-3">
                              <span className="text-xs font-mono font-bold text-gray-400 w-5 shrink-0">{idx + 1}.</span>
                              <span className="text-sm font-bold text-gray-700">{a.projectName}</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <Badge priority={a.priority} />
                              <StatusBadge status={a.status} isPaused={isNamePaused(displayName)} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </>
      )}

      {/* ================= HISTORY TAB ================= */}
      {view === 'history' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-white rounded-2xl border border-gray-150 p-4 shadow-xs">
              <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                Yesterday Pending ({historyYesterdayPending.length})
              </p>
              <PendingProjectList
                items={historyYesterdayPending}
                getOwner={isAdmin ? (a) => nameFor(a.userEmail) : undefined}
              />
            </div>
            <div className="bg-white rounded-2xl border border-gray-150 p-4 shadow-xs">
              <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                Today Pending ({todayPending.length})
              </p>
              {todayPendingLoading ? (
                <p className="text-xs font-semibold text-gray-400">Loading…</p>
              ) : (
                <PendingProjectList
                  items={todayPending}
                  getOwner={isAdmin ? (a) => nameFor(a.userEmail) : undefined}
                />
              )}
            </div>
          </div>

          {/* Day-by-day assignment status calendar — pick any date, see all
              of that day's assigned projects (everyone's, for admins; just
              your own, for everyone else) and whether each was Submitted or
              Not Submitted. Available to every user, not just admins. */}
          {(
            <div className="bg-white rounded-2xl border border-gray-150 shadow-xs overflow-hidden">
              <div className="p-4 bg-gray-50/50 border-b border-gray-150 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider flex items-center gap-1.5">
                  <CalendarDays size={14} className="text-indigo-600" />
                  Daily Assignment Status
                </h3>

                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200/60 shadow-inner h-[32px] self-start sm:self-center">
                  <button
                    type="button"
                    onClick={() => {
                      if (historyCalMonth === 0) {
                        setHistoryCalMonth(11);
                        setHistoryCalYear((y) => y - 1);
                      } else {
                        setHistoryCalMonth((m) => m - 1);
                      }
                    }}
                    className="px-2 py-1 text-slate-500 hover:text-indigo-600 transition-colors cursor-pointer"
                  >
                    <ChevronDown className="rotate-90" size={13} />
                  </button>
                  <span className="font-extrabold text-[11px] uppercase tracking-wider text-slate-700 min-w-[110px] text-center select-none">
                    {MONTH_NAMES[historyCalMonth]} {historyCalYear}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (historyCalMonth === 11) {
                        setHistoryCalMonth(0);
                        setHistoryCalYear((y) => y + 1);
                      } else {
                        setHistoryCalMonth((m) => m + 1);
                      }
                    }}
                    className="px-2 py-1 text-slate-500 hover:text-indigo-600 transition-colors cursor-pointer"
                  >
                    <ChevronUp className="rotate-90" size={13} />
                  </button>
                </div>
              </div>

              <div className="p-5 grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Left: calendar grid */}
                <div className="lg:col-span-7 bg-slate-50/50 p-5 rounded-2xl border border-slate-150/60 shadow-inner">
                  <div className="grid grid-cols-7 gap-2 mb-3 text-center text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    <div>Sun</div><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div>
                  </div>
                  <div className="grid grid-cols-7 gap-2">
                    {historyCalMonthDays.blanks.map((_, idx) => (
                      <div
                        key={`hcal-blank-${idx}`}
                        className="aspect-square bg-slate-50/30 rounded-xl border border-dashed border-slate-200/20 opacity-20 select-none"
                      />
                    ))}
                    {historyCalMonthDays.days.map((day) => {
                      const dateStr = `${historyCalYear}-${String(historyCalMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                      const isSelected = historyCalDay === dateStr;
                      const isFuture = dateStr > todayStr();
                      return (
                        <button
                          key={`hcal-day-${day}`}
                          type="button"
                          disabled={isFuture}
                          onClick={() => {
                            setHistoryCalDay(dateStr);
                            loadHistoryCalDay(dateStr);
                          }}
                          className={`aspect-square rounded-2xl flex items-center justify-center text-[12px] font-black transition-all duration-200 select-none ${
                            isFuture
                              ? 'bg-slate-50 text-slate-300 cursor-not-allowed'
                              : isSelected
                              ? 'bg-indigo-600 text-white shadow-xs ring-2 ring-indigo-300 ring-offset-1 scale-105 cursor-pointer'
                              : 'bg-white border border-slate-200 text-slate-600 hover:bg-indigo-50 hover:border-indigo-200 cursor-pointer'
                          }`}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-4 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Click any day to see every user's assigned projects and submission status.
                  </p>
                </div>

                {/* Right: all of that day's data, shown directly — no dropdown */}
                <div className="lg:col-span-5 flex flex-col">
                  {!historyCalDay ? (
                    <div className="flex-1 flex items-center justify-center text-center p-8 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200 min-h-[220px]">
                      <p className="text-xs font-bold text-slate-400">Select a day from the calendar to view assignment status.</p>
                    </div>
                  ) : historyCalLoading ? (
                    <p className="text-xs font-bold text-gray-400 p-4">Loading…</p>
                  ) : historyCalAssignments.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center text-center p-8 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200 min-h-[220px]">
                      <p className="text-xs font-bold text-slate-400">No assignments found for {historyCalDay}.</p>
                    </div>
                  ) : (
                    <div className="space-y-4 max-h-[420px] overflow-y-auto pr-1">
                      {historyCalGroupedByUser.map(([userName, items]) => (
                        <div key={userName} className="bg-white rounded-xl border border-gray-150 overflow-hidden">
                          {isAdmin && (
                            <div className="px-3.5 py-2 bg-gray-50 border-b border-gray-150">
                              <p className="text-[11px] font-black text-gray-900">{userName}</p>
                            </div>
                          )}
                          <div className="divide-y divide-gray-100">
                            {items.map((a) => (
                              <div key={a.id} className="flex items-center justify-between px-3.5 py-2">
                                <span className="text-xs font-bold text-gray-700 truncate pr-2">{a.projectName}</span>
                                {a.status === 'Done' ? (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 shrink-0">
                                    <CheckCircle2 size={12} /> Submitted
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-red-600 shrink-0">
                                    <Clock size={12} /> Not Submitted
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
