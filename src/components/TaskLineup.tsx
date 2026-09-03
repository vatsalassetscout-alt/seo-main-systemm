/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { AppUser, TaskAssignment } from '../types';
import { numericIdCompare } from '../lib/userUtils';
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
  RotateCcw,
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
  X1: 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-100 dark:border-red-500/20',
  X2: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-100 dark:border-amber-500/20',
  X3: 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-100 dark:border-blue-500/20',
  X4: 'bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-100 dark:border-purple-500/20',
  X5: 'bg-gray-50 dark:bg-ink-800/60 text-gray-700 dark:text-slate-200 border-gray-150 dark:border-slate-800',
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

// Groups a list of assignments into X1 -> X2 -> X3 -> X4 -> X5 buckets (any
// unrecognised tier falls into its own trailing bucket). Shared by the
// user-side "Today's Lineup" card and the admin per-user cards so both lay
// tasks out as priority columns instead of one long vertical list.
function groupByPriorityTier(list: TaskAssignment[]): [string, TaskAssignment[]][] {
  const byTier = new Map<string, TaskAssignment[]>();
  list.forEach((a) => {
    const tier = a.priority || '—';
    if (!byTier.has(tier)) byTier.set(tier, []);
    byTier.get(tier)!.push(a);
  });
  return Array.from(byTier.entries()).sort((a, b) => priorityRank(a[0]) - priorityRank(b[0]));
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

// Green → red heatmap for the History tab's "Daily Assignment Status"
// calendar. A day only earns full green once every assignment on it was
// Submitted — the moment even one item is still Pending, it steps down to a
// clearly lighter/different shade (never stays indistinguishable from a
// fully-clean day), sliding through yellow/orange as the pending share
// grows, all the way to full red once everything on that day is Pending.
// Days with no assignments at all are left uncolored (no data to show).
function heatmapClassesForDay(stat?: { total: number; pending: number }): { cell: string; ring: string; dot: string } | null {
  if (!stat || stat.total === 0) return null;
  const pendingRatio = stat.pending / stat.total;
  if (pendingRatio === 0) return { cell: 'bg-green-500 border-green-600 text-white', ring: 'ring-green-300 dark:ring-emerald-500/35', dot: 'bg-green-500 border-green-600' };
  if (pendingRatio <= 0.25) return { cell: 'bg-green-300 border-green-400 text-green-900', ring: 'ring-green-200 dark:ring-emerald-500/25', dot: 'bg-green-300 border-green-400' };
  if (pendingRatio <= 0.5) return { cell: 'bg-yellow-300 border-yellow-400 text-yellow-900', ring: 'ring-yellow-200 dark:ring-amber-500/30', dot: 'bg-yellow-300 border-yellow-400' };
  if (pendingRatio <= 0.75) return { cell: 'bg-orange-300 border-orange-400 text-orange-900', ring: 'ring-orange-200 dark:ring-orange-500/25', dot: 'bg-orange-300 border-orange-400' };
  if (pendingRatio < 1) return { cell: 'bg-red-300 border-red-400 text-red-900', ring: 'ring-red-200 dark:ring-red-500/25', dot: 'bg-red-300 border-red-400' };
  return { cell: 'bg-red-500 border-red-600 text-white', ring: 'ring-red-300 dark:ring-red-500/35', dot: 'bg-red-500 border-red-600' };
}

const Badge = ({ priority }: { priority: string }) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-black uppercase tracking-wider ${PRIORITY_BADGE[priority] || 'bg-gray-50 dark:bg-ink-800/60 text-gray-500 dark:text-slate-400 border-gray-150 dark:border-slate-800'}`}>
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
              ? PRIORITY_BADGE[tier] || 'bg-gray-50 dark:bg-ink-800/60 text-gray-600 dark:text-slate-300 border-gray-150 dark:border-slate-800'
              : 'bg-gray-50 dark:bg-ink-800/60 text-gray-300 dark:text-slate-500 border-gray-100 dark:border-slate-800/60'
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
    <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 dark:text-emerald-400">
      <CheckCircle2 size={13} /> Submitted
    </span>
  ) : isPaused ? (
    <span className="inline-flex items-center gap-1 text-xs font-bold text-gray-500 dark:text-slate-400">
      <Pause size={13} /> Paused
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-700 dark:text-amber-400">
      <Clock size={13} /> Pending
    </span>
  )
);

// Small reusable "list of pending projects" block used for both Yesterday
// Pending and Total Pending — project names, not just a bare count.
// Columns run Project Name -> User (admin view only) -> Priority -> Date,
// with Project Name and Date sharing the same larger text size so both
// read as the two "headline" pieces of info in the row.
// `getOwner`, when passed (admin/History view), shows whose task it is.
// `showDate` hides the Date column entirely (used for Yesterday Pending,
// where every row is implicitly "yesterday" so a date is redundant).
// `onLogWork`, when passed, adds a "Log Work" button that jumps straight to
// the Work Log pre-filled for that date.
const PendingProjectList = ({
  items,
  getOwner,
  onLogWork,
  showDate = true,
}: {
  items: TaskAssignment[];
  getOwner?: (a: TaskAssignment) => string;
  onLogWork?: (a: TaskAssignment) => void;
  showDate?: boolean;
}) => (
  items.length === 0 ? (
    <p className="text-xs font-semibold text-gray-400 dark:text-slate-500">Nothing pending — all caught up.</p>
  ) : (
    <div className="max-h-80 overflow-y-auto pr-1">
      <div className="flex items-center gap-3 px-2.5 pb-2 mb-1.5 border-b border-gray-100 dark:border-slate-800/60">
        <span className="flex-1 min-w-0 text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-wider">Project</span>
        {getOwner && (
          <span className="w-24 shrink-0 text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-wider text-right">User</span>
        )}
        <span className="w-12 shrink-0 text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-wider text-center">Priority</span>
        {showDate && (
          <span className="w-[84px] shrink-0 text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-wider text-right">Date</span>
        )}
      </div>
      <div className="space-y-1">
        {sortPendingFirst(items).map((a) => (
          <div key={a.id} className="flex items-center gap-3 px-2.5 py-2 rounded-xl hover:bg-gray-50 hover:dark:bg-ink-800/60 transition-colors">
            <span className="flex-1 min-w-0 truncate text-[15px] font-black text-gray-800 dark:text-slate-100">{a.projectName}</span>
            {getOwner && (
              <span className="w-24 shrink-0 truncate text-[11px] font-bold text-gray-500 dark:text-slate-400 text-right" title={getOwner(a)}>
                {getOwner(a)}
              </span>
            )}
            <div className="w-12 shrink-0 flex justify-center">
              <Badge priority={a.priority} />
            </div>
            {showDate && (
              <span className="w-[84px] shrink-0 text-[15px] font-black text-gray-800 dark:text-slate-100 text-right whitespace-nowrap">
                {a.date}
              </span>
            )}
            {onLogWork && (
              <button
                type="button"
                onClick={() => onLogWork(a)}
                className="flex items-center gap-1 px-2 py-1 bg-indigo-600 dark:bg-blue-600 hover:bg-indigo-700 hover:dark:bg-blue-500 text-white text-[10px] font-black rounded-lg transition cursor-pointer shrink-0"
              >
                <PenTool size={11} />
                Log Work
              </button>
            )}
          </div>
        ))}
      </div>
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

  // History tab: loading flag for the pooled "Total Pending" list — reused
  // from loadPendingSummary (non-admin) below.
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

  // Per-day { total, pending } counts for every day in the visible month —
  // powers the calendar's green (all Submitted) → red (all Pending)
  // heatmap shading. Keyed by "YYYY-MM-DD".
  const [historyCalMonthSummary, setHistoryCalMonthSummary] = useState<Record<string, { total: number; pending: number }>>({});

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
    setTodayPendingLoading(true);
    try {
      const url = isAdmin ? '/api/task-lineup/pending-summary' : `/api/task-lineup/pending-summary?userEmail=${encodeURIComponent(currentUserEmail || '')}`;
      const res = await fetch(url, { headers: authHeaders });
      const data = await res.json();
      setYesterdayPending(Array.isArray(data.yesterdayPending) ? data.yesterdayPending : []);
      setTotalPending(Array.isArray(data.totalPending) ? data.totalPending : []);
      setTotalPendingCount(typeof data.totalPendingCount === 'number' ? data.totalPendingCount : 0);
    } catch (err) {
      console.error('Failed to load pending summary:', err);
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

  // Fetch the whole visible month's per-day submitted/pending counts in one
  // request, for the History tab's heatmap calendar.
  const loadHistoryCalMonthSummary = useCallback(async (year: number, monthIndex: number) => {
    try {
      const res = await fetch(`/api/task-lineup/month-summary?year=${year}&month=${monthIndex + 1}`, { headers: authHeaders });
      const data = await res.json();
      setHistoryCalMonthSummary(data && typeof data.days === 'object' && data.days ? data.days : {});
    } catch (err) {
      console.error('Failed to load month summary:', err);
      setHistoryCalMonthSummary({});
    }
  }, [authHeaders]);

  useEffect(() => {
    loadLineup(activeDate);
    if (!isAdmin) loadPendingSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDate, loadLineup, isAdmin, loadPendingSummary]);

  // Refresh the heatmap whenever the History tab's calendar month changes
  // (including the first time it's opened).
  useEffect(() => {
    if (view === 'history') {
      loadHistoryCalMonthSummary(historyCalYear, historyCalMonth);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, historyCalYear, historyCalMonth]);

  useEffect(() => {
    if (isAdmin) {
      loadEngineStatus();
      loadPendingAllUsers();
    }
  }, [isAdmin, loadEngineStatus, loadPendingAllUsers]);

  // Load History data lazily, only once the History tab is opened.
  useEffect(() => {
    if (view === 'history') {
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

  const handleRestoreToday = async () => {
    setEngineBusy(true);
    setGenerateMsg(null);
    try {
      const res = await fetch('/api/task-lineup/restore', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ date: activeDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to restore the lineup.');
      const count = Array.isArray(data.restoredUsers) ? data.restoredUsers.length : 0;
      setGenerateMsg(
        count > 0
          ? `Restored ${count} user${count === 1 ? '' : 's'}' lineup for ${activeDate} (${data.totalInserted} project${data.totalInserted === 1 ? '' : 's'}).`
          : `Nothing to restore for ${activeDate} — everyone already has a lineup.`
      );
      await Promise.all([loadLineup(activeDate), loadPendingAllUsers()]);
    } catch (err: any) {
      console.error('Failed to restore lineup:', err);
      setGenerateMsg(`Couldn't restore the lineup: ${err?.message || 'check server logs.'}`);
    } finally {
      setEngineBusy(false);
    }
  };

  const handleTrimToday = async () => {
    setEngineBusy(true);
    setGenerateMsg(null);
    try {
      const res = await fetch('/api/task-lineup/trim', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ date: activeDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to trim the lineup.');
      const count = Array.isArray(data.trimmedUsers) ? data.trimmedUsers.length : 0;
      setGenerateMsg(
        count > 0
          ? `Trimmed ${data.totalRemoved} extra project${data.totalRemoved === 1 ? '' : 's'} across ${count} user${count === 1 ? '' : 's'} for ${activeDate} — everyone's back to 15.`
          : `Nothing to trim for ${activeDate} — nobody's over the daily cap.`
      );
      await Promise.all([loadLineup(activeDate), loadPendingAllUsers()]);
    } catch (err: any) {
      console.error('Failed to trim lineup:', err);
      setGenerateMsg(`Couldn't trim the lineup: ${err?.message || 'check server logs.'}`);
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

  // Quick lookup: is this person currently paused? Checked by EMAIL — not
  // display name. Two different real accounts can legitimately share the
  // exact same display name (e.g. two team members both named "Kavita
  // Mishra"); matching by name would wrongly mark BOTH of them as paused
  // the moment either one's account gets paused.
  const isEmailPaused = (email: string) =>
    allowedUsers.some(u => u.email.trim().toLowerCase() === email.trim().toLowerCase() && !!u.paused);

  // Grouped by canonical EMAIL — one card per real account. The backend
  // (`/api/task-lineup`) already collapses duplicate-account rows onto a
  // single canonical email before this data ever reaches the client, so
  // there is exactly one row-set per real person in `assignments` already.
  // This used to re-merge rows by display NAME and then pick whichever
  // duplicate account's list "looked more complete" — that extra picking
  // step is what caused admin's per-user card to sometimes show a
  // different set of projects than what the user themself sees on their
  // own Task Lineup page. Grouping straight from email with the exact same
  // filter+sort used for `myAssignments` below guarantees admin's card for
  // a user is byte-for-byte identical to what that user sees when logged
  // in themselves.
  const groupedByUser = useMemo(() => {
    const byEmail = new Map<string, TaskAssignment[]>();
    assignments.forEach(a => {
      const emailKey = a.userEmail.trim().toLowerCase();
      if (!byEmail.has(emailKey)) byEmail.set(emailKey, []);
      byEmail.get(emailKey)!.push(a);
    });

    // Ordered by numeric user ID (not alphabetically by name) so each
    // user's card sits in a predictable, ID-ordered sequence on the admin
    // side.
    return Array.from(byEmail.entries())
      .map(([emailKey, items]) => [nameFor(emailKey), emailKey, sortPendingFirst(items)] as [string, string, TaskAssignment[]])
      .sort((a, b) => numericIdCompare(a[1], b[1]));
  }, [assignments, allowedUsers]);

  const myAssignments = useMemo(
    () => sortPendingFirst(assignments.filter(a => a.userEmail.trim().toLowerCase() === (currentUserEmail || '').trim().toLowerCase())),
    [assignments, currentUserEmail]
  );

  // Groups `myAssignments` into X1 -> X2 -> X3 -> X4 -> X5 buckets (any
  // unrecognised tier falls into its own trailing bucket) so the "Today's
  // Lineup" card can lay each tier out as its own horizontal, wrapping row
  // instead of one long vertical list — keeps the card short no matter how
  // many tasks are assigned.
  const myAssignmentsByPriority = useMemo(
    () => groupByPriorityTier(myAssignments),
    [myAssignments]
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

  // History tab's "Yesterday Pending" / "Total Pending" blocks — pooled
  // across every user for admins (so admin sees everyone's combined
  // total), and scoped to just the signed-in person for everyone else (so
  // a regular user only ever sees their own total, never anyone else's).
  const historyYesterdayPending = useMemo(
    () => (isAdmin ? pendingAllUsers.flatMap(u => u.yesterdayPending) : yesterdayPending),
    [isAdmin, pendingAllUsers, yesterdayPending]
  );
  const historyTotalPending = useMemo(
    () => (isAdmin ? pendingAllUsers.flatMap(u => u.totalPending) : totalPending),
    [isAdmin, pendingAllUsers, totalPending]
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
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-150 dark:border-slate-800 pb-6">
        {/* Page-level heading toggle — same "Submission | History" treatment
            used on the Work Log tab, available to admin and non-admin alike. */}
        <h1 className="text-xl font-black tracking-tight sm:text-2xl flex items-center gap-2">
          <button
            type="button"
            onClick={() => setView('lineup')}
            className={`text-xl font-black tracking-tight sm:text-2xl transition cursor-pointer ${
              view === 'lineup' ? 'text-gray-900 dark:text-slate-50' : 'text-gray-400 dark:text-slate-500 hover:text-indigo-600 hover:dark:text-blue-400'
            }`}
          >
            Task Lineup
          </button>
          <span className="text-gray-400 dark:text-slate-500">|</span>
          <button
            type="button"
            onClick={() => setView('history')}
            className={`text-xl font-black tracking-tight sm:text-2xl transition cursor-pointer ${
              view === 'history' ? 'text-gray-900 dark:text-slate-50' : 'text-gray-400 dark:text-slate-500 hover:text-indigo-600 hover:dark:text-blue-400'
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
                  className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 dark:bg-blue-600 hover:bg-indigo-700 hover:dark:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl transition cursor-pointer"
                >
                  <Play size={13} />
                  Start Cycle
                </button>
              ) : (
                <button
                  onClick={handleToggleEnginePause}
                  disabled={engineBusy}
                  className={`flex items-center gap-1.5 px-4 py-2 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-bold rounded-xl transition cursor-pointer ${
                    enginePaused ? 'bg-emerald-50 dark:bg-emerald-500/10 hover:bg-emerald-100 text-emerald-700 dark:text-emerald-400' : 'bg-amber-50 dark:bg-amber-500/10 hover:bg-amber-100 text-amber-700 dark:text-amber-400'
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
                className="flex items-center gap-1.5 px-3 py-2 bg-red-50 dark:bg-red-500/10 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed text-red-700 dark:text-red-400 text-xs font-bold rounded-xl transition cursor-pointer"
                title="Full reset: deletes every assignment for every user on every date and stops the cycle (Start Cycle required again)"
              >
                <Trash2 size={13} />
                Delete
              </button>
              {view === 'lineup' && (
                <button
                  onClick={() => setShowCheckPendings(v => !v)}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-xl transition cursor-pointer ${
                    showCheckPendings ? 'bg-indigo-600 dark:bg-blue-600 text-white' : 'bg-indigo-50 dark:bg-blue-500/10 hover:bg-indigo-100 hover:dark:bg-blue-500/15 text-indigo-700 dark:text-blue-400'
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
                  <CalendarDays size={14} className="text-gray-400 dark:text-slate-500" />
                  <input
                    type="date"
                    value={date}
                    max={maxDate}
                    onChange={(e) => setDate(e.target.value)}
                    className="px-2.5 py-2 text-xs font-bold border border-gray-200 dark:border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:dark:ring-blue-500/25"
                  />
                  {date && (
                    <button
                      onClick={() => setDate('')}
                      className="text-[11px] font-bold text-indigo-600 dark:text-blue-400 hover:text-indigo-800 hover:dark:text-blue-300 cursor-pointer"
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
        <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/20 text-amber-800 dark:text-amber-300 text-xs font-bold px-3 py-2 rounded-xl">
          <AlertTriangle size={14} />
          Sundays are a rest day — the lineup engine doesn't generate assignments for this date.
        </div>
      )}

      {generateMsg && (
        <div className="text-xs font-bold text-gray-600 dark:text-slate-300 bg-gray-50 dark:bg-ink-800/60 border border-gray-150 dark:border-slate-800 px-3 py-2 rounded-xl">
          {generateMsg}
        </div>
      )}

      {/* ================= TASK LINEUP TAB ================= */}
      {view === 'lineup' && (
        <>
          {/* Admin: "Check Pendings" drill-down — one button per user; pick
              someone to see their total + yesterday pending lists. */}
          {isAdmin && showCheckPendings && (
            <div className="bg-white dark:bg-ink-900 rounded-2xl border border-gray-150 dark:border-slate-800 overflow-hidden shadow-xs">
              <div className="px-5 py-3 bg-gray-50 dark:bg-ink-800/60 border-b border-gray-150 dark:border-slate-800">
                <p className="text-xs font-black text-gray-900 dark:text-slate-50">Check Pendings — by user</p>
                <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 mt-0.5">Pick a user to see their total and yesterday's pending tasks.</p>
              </div>
              <div className="p-4 flex flex-wrap gap-2 border-b border-gray-100 dark:border-slate-800/60">
                {pendingAllLoading ? (
                  <p className="text-xs font-bold text-gray-400 dark:text-slate-500 px-1">Loading users…</p>
                ) : pendingAllUsers.length === 0 ? (
                  <p className="text-xs font-bold text-gray-400 dark:text-slate-500 px-1">No users configured yet.</p>
                ) : (
                  [...pendingAllUsers].sort((a, b) => numericIdCompare(a.email, b.email)).map(u => (
                    <button
                      key={u.email}
                      onClick={() => setSelectedPendingEmail(u.email)}
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                        selectedPendingEmail && selectedPendingEmail.trim().toLowerCase() === u.email.trim().toLowerCase()
                          ? 'bg-indigo-600 dark:bg-blue-600 text-white'
                          : 'bg-gray-100 dark:bg-ink-800 hover:bg-gray-200 hover:dark:bg-ink-700 text-gray-700 dark:text-slate-200'
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
                    <p className="text-[11px] font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                      {selectedPendingSummary.name} — Yesterday Pending ({selectedPendingSummary.yesterdayPendingCount})
                    </p>
                    <PendingProjectList items={selectedPendingSummary.yesterdayPending} />
                  </div>
                  <div>
                    <p className="text-[11px] font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                      {selectedPendingSummary.name} — Total Pending ({selectedPendingSummary.totalPendingCount})
                    </p>
                    <PendingProjectList items={selectedPendingSummary.totalPending} />
                  </div>
                  <div className="sm:col-span-2 text-[11px] text-gray-400 dark:text-slate-500 font-semibold">
                    Total tasks ever assigned to {selectedPendingSummary.name}: <span className="text-gray-600 dark:text-slate-300 font-bold">{selectedPendingSummary.totalTasks}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Non-admin: Today's Lineup — the date filter now lives in this
              card's own header, right-aligned, capped so a future date can't
              be picked. */}
          {!isAdmin && (
            <div className="bg-white dark:bg-ink-900 rounded-2xl border border-gray-150 dark:border-slate-800 overflow-hidden shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 bg-gray-50 dark:bg-ink-800/60 border-b border-gray-150 dark:border-slate-800">
                <p className="text-sm font-black text-gray-900 dark:text-slate-50">Today's Lineup</p>
                <div className="flex items-center gap-3">
                  <PriorityDistribution items={myAssignments} />
                  <div className="flex items-center gap-2">
                    <CalendarDays size={13} className="text-gray-400 dark:text-slate-500" />
                    <input
                      type="date"
                      value={date}
                      max={maxDate}
                      onChange={(e) => setDate(e.target.value)}
                      className="px-2.5 py-1.5 text-xs font-bold border border-gray-200 dark:border-slate-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:dark:ring-blue-500/25"
                    />
                    {date && (
                      <button
                        onClick={() => setDate('')}
                        className="text-[11px] font-bold text-indigo-600 dark:text-blue-400 hover:text-indigo-800 hover:dark:text-blue-300 cursor-pointer"
                      >
                        Today
                      </button>
                    )}
                  </div>
                </div>
              </div>
              {loading ? (
                <p className="px-5 py-6 text-xs font-bold text-gray-400 dark:text-slate-500">Loading…</p>
              ) : myAssignments.length === 0 ? (
                <p className="px-5 py-6 text-xs font-bold text-gray-400 dark:text-slate-500">No tasks assigned to you for this date yet.</p>
              ) : (
                <div className="px-5 py-4">
                  <div
                    className="grid gap-5 items-start"
                    style={{ gridTemplateColumns: `repeat(${myAssignmentsByPriority.length}, minmax(0, 1fr))` }}
                  >
                    {myAssignmentsByPriority.map(([tier, items]) => (
                      <div key={tier} className="min-w-0">
                        <div className="flex items-center gap-2 mb-3">
                          <Badge priority={tier} />
                          <span className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider">
                            {items.length} task{items.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                        <div className="space-y-3">
                          {items.map((a) => (
                            <div key={a.id} className="flex items-center justify-between gap-2">
                              <span className="text-sm font-bold text-gray-700 dark:text-slate-200 truncate">{a.projectName}</span>
                              {a.status === 'Done' ? (
                                <StatusBadge status={a.status} />
                              ) : (
                                <button
                                  onClick={() => onJumpToWorkLog(a.projectId, a.date)}
                                  className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 dark:bg-blue-600 hover:bg-indigo-700 hover:dark:bg-blue-500 text-white text-xs font-black rounded-lg transition cursor-pointer whitespace-nowrap shrink-0"
                                >
                                  <PenTool size={13} />
                                  Log
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
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
            <div className="bg-white dark:bg-ink-900 rounded-2xl border border-gray-150 dark:border-slate-800 overflow-hidden shadow-xs">
              <div className="px-5 py-3 bg-gray-50 dark:bg-ink-800/60 border-b border-gray-150 dark:border-slate-800">
                <p className="text-xs font-black text-gray-900 dark:text-slate-50"> Controls</p>
              </div>
              {allowedUsers.length === 0 ? (
                <p className="px-5 py-4 text-xs font-bold text-gray-400 dark:text-slate-500">No users configured yet.</p>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-slate-800/60">
                  {[...allowedUsers].sort((a, b) => numericIdCompare(a.email, b.email)).map((u) => {
                    const paused = !!u.paused;
                    const stats = pendingStatsByEmail.get(u.email.trim().toLowerCase());
                    return (
                      <div key={u.email} className="flex items-center justify-between px-5 py-2.5 gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-gray-800 dark:text-slate-100 truncate">{u.name}</p>
                          <p className="text-[10px] text-gray-400 dark:text-slate-500 font-semibold truncate">{u.email}</p>
                        </div>
                        <div className="flex items-center gap-4 shrink-0">
                          {stats && (
                            <div className="hidden md:flex items-center gap-3 text-[10px] font-bold text-gray-500 dark:text-slate-400">
                              <span title="Total tasks ever assigned">Total: <span className="text-gray-800 dark:text-slate-100">{stats.totalTasks}</span></span>
                              <span title="Still pending from yesterday">Yesterday: <span className="text-amber-700 dark:text-amber-400">{stats.yesterdayPendingCount}</span></span>
                              <span title="All-time pending">Pending: <span className="text-red-700 dark:text-red-400">{stats.totalPendingCount}</span></span>
                            </div>
                          )}
                          <button
                            onClick={() => togglePause(u.email, !paused)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition cursor-pointer ${
                              paused ? 'bg-amber-100 text-amber-700 dark:text-amber-400 hover:bg-amber-200' : 'bg-gray-100 dark:bg-ink-800 text-gray-500 dark:text-slate-400 hover:bg-gray-200 hover:dark:bg-ink-700'
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
            <div>
              {loading ? (
                <p className="text-xs font-bold text-gray-400 dark:text-slate-500">Loading lineup…</p>
              ) : groupedByUser.length === 0 ? (
                <div className="bg-white dark:bg-ink-900 rounded-2xl border border-gray-150 dark:border-slate-800 p-8 text-center">
                  <p className="text-sm font-bold text-gray-500 dark:text-slate-400">No lineup generated for this date yet.</p>
                </div>
              ) : (
                <div
                  className="grid gap-4 items-start"
                  style={{ gridTemplateColumns: `repeat(${groupedByUser.length}, minmax(0, 1fr))` }}
                >
                  {groupedByUser.map(([displayName, emailKey, list]) => {
                    const doneCount = list.filter(a => a.status === 'Done').length;
                    return (
                      <div key={emailKey} className="min-w-0 bg-white dark:bg-ink-900 rounded-2xl border border-gray-150 dark:border-slate-800 overflow-hidden shadow-xs">
                        <div className="px-4 py-3 bg-gray-50 dark:bg-ink-800/60 border-b border-gray-150 dark:border-slate-800">
                          <p className="text-xs font-black text-gray-900 dark:text-slate-50 truncate">
                            {displayName}
                            {/* ID shown alongside the name so two people who
                                happen to share the same display name (a real,
                                legitimate case — not a bug) are always
                                distinguishable at a glance in the admin view. */}
                            <span className="ml-1.5 font-mono font-bold text-gray-400 dark:text-slate-500 normal-case">· {emailKey}</span>
                          </p>
                          <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500">{doneCount}/{list.length} completed today</p>
                          <div className="mt-2">
                            <PriorityDistribution items={list} />
                          </div>
                        </div>
                        <div className="divide-y divide-gray-100 dark:divide-slate-800/60">
                          {list.map((a, idx) => (
                            <div key={a.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <span className="text-xs font-mono font-bold text-gray-400 dark:text-slate-500 w-5 shrink-0">{idx + 1}.</span>
                                <span className="text-sm font-bold text-gray-700 dark:text-slate-200 truncate">{a.projectName}</span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <Badge priority={a.priority} />
                                <StatusBadge status={a.status} isPaused={isEmailPaused(emailKey)} />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ================= HISTORY TAB ================= */}
      {view === 'history' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Left: Yesterday Pending — no Date column since every row here
                is implicitly "yesterday". */}
            <div className="bg-white dark:bg-ink-900 rounded-2xl border border-gray-150 dark:border-slate-800 p-5 shadow-xs min-h-[320px]">
              <p className="text-xs font-black text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-3">
                Yesterday Pending ({historyYesterdayPending.length})
              </p>
              <PendingProjectList
                items={historyYesterdayPending}
                getOwner={isAdmin ? (a) => nameFor(a.userEmail) : undefined}
                onLogWork={!isAdmin ? (a) => onJumpToWorkLog(a.projectId, a.date) : undefined}
                showDate={false}
              />
            </div>
            {/* Right: Total Pending — the signed-in user's own all-time
                total, or, for admins, every user's pooled together. */}
            <div className="bg-white dark:bg-ink-900 rounded-2xl border border-gray-150 dark:border-slate-800 p-5 shadow-xs min-h-[320px]">
              <p className="text-xs font-black text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-3">
                Total Pending ({historyTotalPending.length})
              </p>
              <PendingProjectList
                items={historyTotalPending}
                getOwner={isAdmin ? (a) => nameFor(a.userEmail) : undefined}
              />
            </div>
          </div>

          {/* Day-by-day assignment status calendar — pick any date, see all
              of that day's assigned projects (everyone's, for admins; just
              your own, for everyone else) and whether each was Submitted or
              Not Submitted. Available to every user, not just admins. */}
          {(
            <div className="bg-white dark:bg-ink-900 rounded-2xl border border-gray-150 dark:border-slate-800 shadow-xs overflow-hidden">
              <div className="p-4 bg-gray-50/50 dark:bg-ink-800/40 border-b border-gray-150 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <h3 className="text-xs font-black text-gray-900 dark:text-slate-50 uppercase tracking-wider flex items-center gap-1.5">
                  <CalendarDays size={14} className="text-indigo-600 dark:text-blue-400" />
                  Daily Assignment Status
                </h3>

                <div className="flex items-center gap-1 bg-slate-100 dark:bg-ink-800 p-1 rounded-xl border border-slate-200/60 shadow-inner h-[32px] self-start sm:self-center">
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
                    className="px-2 py-1 text-slate-500 dark:text-slate-400 hover:text-indigo-600 hover:dark:text-blue-400 transition-colors cursor-pointer"
                  >
                    <ChevronDown className="rotate-90" size={13} />
                  </button>
                  <span className="font-extrabold text-[11px] uppercase tracking-wider text-slate-700 dark:text-slate-200 min-w-[110px] text-center select-none">
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
                    className="px-2 py-1 text-slate-500 dark:text-slate-400 hover:text-indigo-600 hover:dark:text-blue-400 transition-colors cursor-pointer"
                  >
                    <ChevronUp className="rotate-90" size={13} />
                  </button>
                </div>
              </div>

              <div className="p-4 grid grid-cols-1 lg:grid-cols-12 gap-4">
                {/* Left: calendar grid, shaded as a green (all Submitted) →
                    red (all Pending) heatmap so the day's status is visible
                    at a glance without clicking in. */}
                <div className="lg:col-span-7 bg-slate-50/50 dark:bg-ink-800/40 p-3.5 rounded-xl border border-slate-150/60 shadow-inner">
                  <div className="grid grid-cols-7 gap-1.5 mb-2 text-center text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                    <div>Sun</div><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div>
                  </div>
                  <div className="grid grid-cols-7 gap-1.5">
                    {historyCalMonthDays.blanks.map((_, idx) => (
                      <div
                        key={`hcal-blank-${idx}`}
                        className="aspect-square bg-slate-50/30 dark:bg-ink-800/30 rounded-lg border border-dashed border-slate-200/20 opacity-20 select-none"
                      />
                    ))}
                    {historyCalMonthDays.days.map((day) => {
                      const dateStr = `${historyCalYear}-${String(historyCalMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                      const isSelected = historyCalDay === dateStr;
                      const isFuture = dateStr > todayStr();
                      const stat = historyCalMonthSummary[dateStr];
                      const heat = !isFuture ? heatmapClassesForDay(stat) : null;
                      return (
                        <button
                          key={`hcal-day-${day}`}
                          type="button"
                          disabled={isFuture}
                          onClick={() => {
                            setHistoryCalDay(dateStr);
                            loadHistoryCalDay(dateStr);
                          }}
                          title={heat && stat ? `${stat.total - stat.pending} submitted · ${stat.pending} pending` : undefined}
                          className={`aspect-square rounded-lg flex items-center justify-center text-[11px] font-black transition-all duration-200 select-none border ${
                            isFuture
                              ? 'bg-slate-50 dark:bg-ink-800/60 text-slate-300 dark:text-slate-500 border-slate-100 cursor-not-allowed'
                              : heat
                              ? `${heat.cell} ${isSelected ? `ring-2 ${heat.ring} ring-offset-1 scale-105 shadow-xs` : 'hover:scale-105 hover:shadow-xs'} cursor-pointer`
                              : isSelected
                              ? 'bg-indigo-600 dark:bg-blue-600 border-indigo-600 dark:border-blue-500/50 text-white shadow-xs ring-2 ring-indigo-300 dark:ring-blue-500/30 ring-offset-1 scale-105 cursor-pointer'
                              : 'bg-white dark:bg-ink-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-indigo-50 hover:dark:bg-blue-500/10 hover:border-indigo-200 hover:dark:border-blue-500/25 cursor-pointer'
                          }`}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-3 pt-2.5 border-t border-slate-200/60 flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-[9px] font-black text-green-700 uppercase tracking-wider">All Submitted</span>
                    <div className="flex items-center gap-1">
                      <div className="w-3 h-3 rounded bg-green-500 border border-green-600" title="All submitted" />
                      <div className="w-3 h-3 rounded bg-green-300 border border-green-400" title="Mostly submitted" />
                      <div className="w-3 h-3 rounded bg-yellow-300 border border-yellow-400" title="About half pending" />
                      <div className="w-3 h-3 rounded bg-orange-300 border border-orange-400" title="Mostly pending" />
                      <div className="w-3 h-3 rounded bg-red-300 border border-red-400" title="Almost all pending" />
                      <div className="w-3 h-3 rounded bg-red-500 border border-red-600" title="All pending" />
                    </div>
                    <span className="text-[9px] font-black text-red-700 dark:text-red-400 uppercase tracking-wider">All Pending</span>
                  </div>
                  <p className="mt-2.5 text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                    Click any day to see every user's assigned projects and submission status.
                  </p>
                </div>

                {/* Right: all of that day's data, shown directly — no dropdown */}
                <div className="lg:col-span-5 flex flex-col">
                  {!historyCalDay ? (
                    <div className="flex-1 flex items-center justify-center text-center p-8 bg-slate-50/50 dark:bg-ink-800/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 min-h-[220px]">
                      <p className="text-xs font-bold text-slate-400 dark:text-slate-500">Select a day from the calendar to view assignment status.</p>
                    </div>
                  ) : historyCalLoading ? (
                    <p className="text-xs font-bold text-gray-400 dark:text-slate-500 p-4">Loading…</p>
                  ) : historyCalAssignments.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center text-center p-8 bg-slate-50/50 dark:bg-ink-800/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 min-h-[220px]">
                      <p className="text-xs font-bold text-slate-400 dark:text-slate-500">No assignments found for {historyCalDay}.</p>
                    </div>
                  ) : (
                    <>
                      {/* Day summary — total lineup for the selected date, split
                          into Submitted vs Pending so it's clear at a glance
                          without having to scroll/count the list below. */}
                      <div className="flex items-center gap-2 mb-3">
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-ink-800/60 border border-slate-150 dark:border-slate-800 text-[11px] font-black text-slate-700 dark:text-slate-200">
                          {historyCalAssignments.length} Total
                        </span>
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 text-[11px] font-black text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 size={12} /> {historyCalAssignments.filter(a => a.status === 'Done').length} Submitted
                        </span>
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-100 text-[11px] font-black text-red-600 dark:text-red-400">
                          <Clock size={12} /> {historyCalAssignments.filter(a => a.status !== 'Done').length} Pending
                        </span>
                      </div>
                      <div className="flex-1 space-y-4 overflow-y-auto pr-1">
                      {historyCalGroupedByUser.map(([userName, items]) => {
                        const submittedCount = items.filter((a) => a.status === 'Done').length;
                        const pendingCount = items.length - submittedCount;
                        return (
                        <div key={userName} className="bg-white dark:bg-ink-900 rounded-xl border border-gray-150 dark:border-slate-800 overflow-hidden">
                          {isAdmin && (
                            <div className="px-3.5 py-2 bg-gray-50 dark:bg-ink-800/60 border-b border-gray-150 dark:border-slate-800 flex items-center justify-between gap-2 flex-wrap">
                              <p className="text-[11px] font-black text-gray-900 dark:text-slate-50">{userName}</p>
                              <div className="flex items-center gap-1.5">
                                <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-ink-800 text-[10px] font-black text-slate-600 dark:text-slate-300">
                                  {items.length} Lineup
                                </span>
                                <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-[10px] font-black text-emerald-700 dark:text-emerald-400">
                                  {submittedCount} Submitted
                                </span>
                                <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-red-50 dark:bg-red-500/10 text-[10px] font-black text-red-600 dark:text-red-400">
                                  {pendingCount} Pending
                                </span>
                              </div>
                            </div>
                          )}
                          <div className="divide-y divide-gray-100 dark:divide-slate-800/60">
                            {items.map((a) => (
                              <div key={a.id} className="flex items-center justify-between px-3.5 py-2">
                                <span className="flex items-center gap-2 min-w-0 pr-2">
                                  <Badge priority={a.priority} />
                                  <span className="text-xs font-bold text-gray-700 dark:text-slate-200 truncate">{a.projectName}</span>
                                </span>
                                {a.status === 'Done' ? (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-400 shrink-0">
                                    <CheckCircle2 size={12} /> Submitted
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-2 shrink-0">
                                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-red-600 dark:text-red-400">
                                      <Clock size={12} /> Not Submitted
                                    </span>
                                    {!isAdmin && (
                                      <button
                                        type="button"
                                        onClick={() => onJumpToWorkLog(a.projectId, a.date)}
                                        className="flex items-center gap-1 px-2 py-1 bg-indigo-600 dark:bg-blue-600 hover:bg-indigo-700 hover:dark:bg-blue-500 text-white text-[10px] font-black rounded-lg transition cursor-pointer"
                                      >
                                        <PenTool size={11} />
                                        Log Work
                                      </button>
                                    )}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                        );
                      })}
                      </div>
                    </>
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
