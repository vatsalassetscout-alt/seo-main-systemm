/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { AppUser, TaskAssignment } from '../types';
import {
  Sparkles,
  RefreshCw,
  Play,
  Pause,
  CheckCircle2,
  Clock,
  AlertTriangle,
  PenTool
} from 'lucide-react';

interface TaskLineupProps {
  isAdmin: boolean;
  currentUserEmail: string;
  allowedUsers: AppUser[];
  onSetAllowedUsers: (users: AppUser[]) => void;
  onJumpToWorkLog: (projectId: string, date: string) => void;
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

export default function TaskLineup({
  isAdmin,
  currentUserEmail,
  allowedUsers,
  onSetAllowedUsers,
  onJumpToWorkLog,
}: TaskLineupProps) {
  const [date, setDate] = useState<string>(todayStr());
  const [assignments, setAssignments] = useState<TaskAssignment[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateMsg, setGenerateMsg] = useState<string | null>(null);
  const [yesterdayPending, setYesterdayPending] = useState<TaskAssignment[]>([]);
  const [totalPendingCount, setTotalPendingCount] = useState<number>(0);

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
      setTotalPendingCount(typeof data.totalPendingCount === 'number' ? data.totalPendingCount : 0);
    } catch (err) {
      console.error('Failed to load pending summary:', err);
    }
  }, [authHeaders, isAdmin, currentUserEmail]);

  useEffect(() => {
    loadLineup(date);
    if (!isAdmin) loadPendingSummary();
  }, [date, loadLineup, isAdmin, loadPendingSummary]);

  const handleGenerate = async (force: boolean) => {
    setGenerating(true);
    setGenerateMsg(null);
    try {
      const res = await fetch('/api/task-lineup/generate', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ date, force }),
      });
      const data = await res.json();
      if (data.generated) {
        setGenerateMsg(`Lineup ready — ${data.count} task${data.count === 1 ? '' : 's'} assigned across the team.`);
      } else {
        setGenerateMsg(data.reason || 'Nothing to generate.');
      }
      await loadLineup(date);
    } catch (err) {
      console.error('Failed to generate lineup:', err);
      setGenerateMsg('Something went wrong generating the lineup — check server logs.');
    } finally {
      setGenerating(false);
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

  const groupedByUser = useMemo(() => {
    const map = new Map<string, TaskAssignment[]>();
    assignments.forEach(a => {
      if (!map.has(a.userEmail)) map.set(a.userEmail, []);
      map.get(a.userEmail)!.push(a);
    });
    return Array.from(map.entries()).sort((a, b) => nameFor(a[0]).localeCompare(nameFor(b[0])));
  }, [assignments, allowedUsers]);

  const myAssignments = useMemo(
    () => assignments.filter(a => a.userEmail.trim().toLowerCase() === (currentUserEmail || '').trim().toLowerCase()),
    [assignments, currentUserEmail]
  );

  const isSunday = new Date(date + 'T00:00:00Z').getUTCDay() === 0;

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
              <p className="text-[11px] text-gray-500 font-semibold">
                Auto-assigned daily work, weighted by X1–X5 priority. No lineup runs on Sundays.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="px-3 py-2 text-xs font-bold border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />
            {isAdmin && (
              <>
                <button
                  onClick={() => handleGenerate(false)}
                  disabled={generating || isSunday}
                  className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl transition cursor-pointer"
                >
                  <Play size={13} />
                  Start Cycle
                </button>
                <button
                  onClick={() => handleGenerate(true)}
                  disabled={generating || isSunday}
                  className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed text-gray-700 text-xs font-bold rounded-xl transition cursor-pointer"
                  title="Delete and regenerate this date's lineup from scratch"
                >
                  <RefreshCw size={13} className={generating ? 'animate-spin' : ''} />
                  Regenerate
                </button>
              </>
            )}
          </div>
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

      {/* Non-admin: personal pending summary */}
      {!isAdmin && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-white rounded-2xl border border-gray-150 p-4 shadow-xs">
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">Yesterday Pending</p>
            {yesterdayPending.length === 0 ? (
              <p className="text-xs font-semibold text-gray-400">Nothing carried over — you're all caught up.</p>
            ) : (
              <div className="space-y-1.5">
                {yesterdayPending.map((a) => (
                  <div key={a.id} className="flex items-center justify-between text-xs font-bold text-gray-700">
                    <span>{a.projectName}</span>
                    <Badge priority={a.priority} />
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="bg-white rounded-2xl border border-gray-150 p-4 shadow-xs flex flex-col justify-center">
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Total Pending</p>
            <p className="text-2xl font-black text-gray-900">{totalPendingCount}</p>
            <p className="text-[11px] text-gray-400 font-semibold">Assignments across all dates still awaiting a work log.</p>
          </div>
        </div>
      )}

      {/* Admin: per-user grouped lineup with pause controls */}
      {isAdmin ? (
        <div className="space-y-4">
          {loading ? (
            <p className="text-xs font-bold text-gray-400">Loading lineup…</p>
          ) : groupedByUser.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-150 p-8 text-center">
              <p className="text-sm font-bold text-gray-500">No lineup generated for this date yet.</p>
              <p className="text-xs text-gray-400 mt-1">Hit "Start Cycle" above to auto-assign today's work.</p>
            </div>
          ) : (
            groupedByUser.map(([userEmail, list]) => {
              const user = allowedUsers.find(u => u.email.trim().toLowerCase() === userEmail.trim().toLowerCase());
              const paused = !!user?.paused;
              const doneCount = list.filter(a => a.status === 'Done').length;
              return (
                <div key={userEmail} className="bg-white rounded-2xl border border-gray-150 overflow-hidden shadow-xs">
                  <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b border-gray-150">
                    <div>
                      <p className="text-xs font-black text-gray-900">{nameFor(userEmail)}</p>
                      <p className="text-[10px] font-bold text-gray-400">{doneCount}/{list.length} completed today</p>
                    </div>
                    <button
                      onClick={() => togglePause(userEmail, !paused)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition cursor-pointer ${
                        paused ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}
                    >
                      {paused ? <Play size={12} /> : <Pause size={12} />}
                      {paused ? 'Paused' : 'Pause'}
                    </button>
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
      ) : (
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
    </div>
  );
}
