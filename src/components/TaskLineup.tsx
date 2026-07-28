/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { AppUser, TaskAssignment } from '../types';
import {
  Sparkles,
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

const Badge = ({ priority }: { priority: string }) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-black uppercase tracking-wider ${PRIORITY_BADGE[priority] || 'bg-gray-50 text-gray-500 border-gray-150'}`}>
    {priority || '—'}
  </span>
);

const StatusBadge = ({ status }: { status: string }) => (
  status === 'Done' ? (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700">
      <CheckCircle2 size={12} /> Done
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700">
      <Clock size={12} /> Pending
    </span>
  )
);

// Small reusable "list of pending projects" block used for both Yesterday
// Pending and Total Pending — project names, not just a bare count.
const PendingProjectList = ({ items }: { items: TaskAssignment[] }) => (
  items.length === 0 ? (
    <p className="text-xs font-semibold text-gray-400">Nothing pending — all caught up.</p>
  ) : (
    <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
      {items.map((a) => (
        <div key={a.id} className="flex items-center justify-between text-xs font-bold text-gray-700">
          <span className="truncate pr-2">{a.projectName}</span>
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
  const [date, setDate] = useState<string>(''); // optional filter — empty means "just show the current lineup"
  const [assignments, setAssignments] = useState<TaskAssignment[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateMsg, setGenerateMsg] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [yesterdayPending, setYesterdayPending] = useState<TaskAssignment[]>([]);
  const [totalPending, setTotalPending] = useState<TaskAssignment[]>([]);
  const [totalPendingCount, setTotalPendingCount] = useState<number>(0);

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

  const handleStartEngine = async () => {
    setEngineBusy(true);
    setGenerateMsg(null);
    try {
      const res = await fetch('/api/task-lineup/engine/start', { method: 'POST', headers: authHeaders });
      const data = await res.json();
      setEngineActive(!!data.active);
      setEnginePaused(!!data.paused);
      setGenerateMsg('Cycle started — it now runs on its own every day going forward. Use Pause below for long vacations.');
      await loadLineup(activeDate);
      await loadPendingAllUsers();
    } catch (err) {
      console.error('Failed to start engine:', err);
      setGenerateMsg('Something went wrong starting the cycle — check server logs.');
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
      setEnginePaused(!!data.paused);
      setGenerateMsg(nextPaused ? 'Cycle paused — nothing will auto-generate until you resume.' : 'Cycle resumed.');
      if (!nextPaused) {
        await loadLineup(activeDate);
        await loadPendingAllUsers();
      }
    } catch (err) {
      console.error('Failed to toggle engine pause:', err);
      setGenerateMsg('Something went wrong pausing/resuming the cycle — check server logs.');
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
    // Optimistic update
    onSetAllowedUsers(allowedUsers.map(u => u.email === userEmail ? { ...u, paused } : u));
    try {
      await fetch('/api/task-lineup/pause', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ userEmail, paused }),
      });
    } catch (err) {
      console.error('Failed to toggle pause:', err);
    }
  };

  const nameFor = (email: string) => allowedUsers.find(u => u.email.trim().toLowerCase() === email.trim().toLowerCase())?.name || email;

  // Grouped by display NAME (not raw email). Two app_users rows can share the
  // same name with different emails (a known duplicate-account issue — see
  // Admin Settings > Users) which used to render as two separate cards for
  // the same person. Merging by name here means it self-heals immediately in
  // the UI, even for a lineup that was generated before the account
  // duplication got cleaned up or before the backend fix went in.
  const groupedByUser = useMemo(() => {
    const map = new Map<string, { displayName: string; itemsByProject: Map<string, TaskAssignment> }>();
    assignments.forEach(a => {
      const displayName = nameFor(a.userEmail);
      const key = displayName.trim().toLowerCase();
      if (!map.has(key)) map.set(key, { displayName, itemsByProject: new Map() });
      const bucket = map.get(key)!;
      const existing = bucket.itemsByProject.get(a.projectId);
      // If the same project shows up twice for this person (once per
      // duplicate account), keep whichever copy is further along.
      if (!existing || (a.status === 'Done' && existing.status !== 'Done')) {
        bucket.itemsByProject.set(a.projectId, a);
      }
    });
    return Array.from(map.entries())
      .map(([key, v]) => [v.displayName, Array.from(v.itemsByProject.values())] as [string, TaskAssignment[]])
      .sort((a, b) => a[0].localeCompare(b[0]));
  }, [assignments, allowedUsers]);

  const myAssignments = useMemo(
    () => assignments.filter(a => a.userEmail.trim().toLowerCase() === (currentUserEmail || '').trim().toLowerCase()),
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

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-gray-150 p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600">
              <Sparkles size={18} />
            </div>
            <div>
              <h2 className="text-sm font-black text-gray-900">Task Lineup</h2>
            
            </div>
          </div>

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
                  {enginePaused ? 'Resume Cycle' : 'Cycle Running — Pause'}
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
            </div>
          )}
        </div>

        {isSunday && (
          <div className="mt-4 flex items-center gap-2 bg-amber-50 border border-amber-100 text-amber-800 text-xs font-bold px-3 py-2 rounded-xl">
            <AlertTriangle size={14} />
            Sundays are a rest day — the lineup engine doesn't generate assignments for this date.
          </div>
        )}

        {generateMsg && (
          <div className="mt-4 text-xs font-bold text-gray-600 bg-gray-50 border border-gray-150 px-3 py-2 rounded-xl">
            {generateMsg}
          </div>
        )}
      </div>

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

      {/* Non-admin: Today's Assignments comes first — this is what people
          open the tab to see, so it's the very first thing on screen. */}
      {!isAdmin && (
        <div className="bg-white rounded-2xl border border-gray-150 overflow-hidden shadow-xs">
          <div className="px-5 py-3 bg-gray-50 border-b border-gray-150">
            <p className="text-xs font-black text-gray-900">Today's Assignments</p>
          </div>
          {loading ? (
            <p className="px-5 py-6 text-xs font-bold text-gray-400">Loading…</p>
          ) : myAssignments.length === 0 ? (
            <p className="px-5 py-6 text-xs font-bold text-gray-400">No tasks assigned to you for this date yet.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {myAssignments.map((a) => (
                <div key={a.id} className="flex items-center justify-between px-5 py-3">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-gray-700">{a.projectName}</span>
                    <Badge priority={a.priority} />
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge status={a.status} />
                    {a.status === 'Pending' && (
                      <button
                        onClick={() => onJumpToWorkLog(a.projectId, a.date)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-black rounded-lg transition cursor-pointer"
                      >
                        <PenTool size={11} />
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

      {/* Optional date filter — leave it blank and you just see the current
          lineup (today's projects); only touch this to look at another day. */}
      <div className="bg-white rounded-2xl border border-gray-150 p-4 shadow-xs flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-2 text-gray-500">
          <CalendarDays size={14} />
          <span className="text-[11px] font-bold uppercase tracking-wider">Date filter (optional)</span>
        </div>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="px-3 py-2 text-xs font-bold border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-200"
        />
        {date && (
          <button
            onClick={() => setDate('')}
            className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 cursor-pointer"
          >
            Clear — back to today
          </button>
        )}
        <span className="text-[11px] text-gray-400 font-semibold sm:ml-auto">
          {date ? `Showing ${activeDate}` : "Leave blank to just see today's projects"}
        </span>
      </div>

      {/* Non-admin: personal pending summary — both lists show project
          names, not just a bare count. */}
      {!isAdmin && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-white rounded-2xl border border-gray-150 p-4 shadow-xs">
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">Yesterday Pending ({yesterdayPending.length})</p>
            <PendingProjectList items={yesterdayPending} />
          </div>
          <div className="bg-white rounded-2xl border border-gray-150 p-4 shadow-xs">
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">Total Pending ({totalPendingCount})</p>
            <PendingProjectList items={totalPending} />
          </div>
        </div>
      )}

      {/* Admin: standalone pause controls — always visible, independent of
          whether a lineup has been generated for the selected date yet.
          Pausing a user here excludes them from the NEXT time the cycle
          runs; it doesn't touch assignments already generated. Each row now
          also shows total tasks, yesterday pending, and total pending. */}
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
                        {paused ? 'Paused' : 'Pause'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Admin: per-user grouped lineup for the selected date */}
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
                  <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b border-gray-150">
                    <div>
                      <p className="text-xs font-black text-gray-900">{displayName}</p>
                      <p className="text-[10px] font-bold text-gray-400">{doneCount}/{list.length} completed today</p>
                    </div>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {list.map((a) => (
                      <div key={a.id} className="flex items-center justify-between px-5 py-2.5">
                        <span className="text-xs font-bold text-gray-700">{a.projectName}</span>
                        <div className="flex items-center gap-3">
                          <Badge priority={a.priority} />
                          <StatusBadge status={a.status} />
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
    </div>
  );
}
