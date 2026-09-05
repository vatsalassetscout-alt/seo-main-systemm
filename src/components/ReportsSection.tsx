/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ============================================================================
// REPORTS — 3-level customizable report builder.
//
// Level 1 (scope, multi-select): Location / Zone / Users — narrows down
//   which projects the whole report is built from.
// Level 2 (keyword rankings only): "domains with up to N keywords" +
//   "only projects with improvement" / "only projects with decrement".
// Level 3 (toggles, no dropdowns): Project Table / Idle Projects — when
//   checked, their FULL current data is appended to the report as-is.
//
// Nothing is mandatory — any combination (including none) is valid.
// "Send Report" / "Download Excel" build the report from whatever is
// currently selected. "Send Report without customizing" (left button,
// outside the filter block) ignores all of the above and sends exactly
// what the old admin-settings "Send Report" button used to send.
// ============================================================================

import React, { useEffect, useMemo, useState } from 'react';
import { Project } from '../types';
import { AppUserRow } from './UserManagement';
import {
  ChevronDown,
  Check,
  Send,
  FileSpreadsheet,
  Download,
  MapPin,
  Globe2,
  Users as UsersIcon,
  TrendingUp,
  TrendingDown,
  Table2,
  FolderOpen,
} from 'lucide-react';
import { motion } from 'motion/react';

interface ReportsSectionProps {
  projects: Project[];
  registeredUsers: AppUserRow[];
  currentUserEmail: string | null;
}

const KEYWORD_LIMIT_OPTIONS = [2, 3, 4, 5];

// ---------------------------------------------------------------------------
// Small reusable multi-select dropdown (checkboxes) for Level 1 filters.
// ---------------------------------------------------------------------------
function MultiSelectDropdown({
  label,
  icon,
  options,
  selected,
  onChange,
}: {
  label: string;
  icon: React.ReactNode;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };

  const summary = selected.length === 0 ? 'All' : selected.length === 1 ? selected[0] : `${selected.length} selected`;

  return (
    <div className="relative" ref={ref}>
      <label className="text-[11px] font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
        {icon}
        {label}
      </label>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 bg-white dark:bg-ink-900 border border-gray-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-gray-800 dark:text-slate-100 hover:border-indigo-300 dark:hover:border-blue-500/40 transition cursor-pointer"
      >
        <span className="truncate">{summary}</span>
        <ChevronDown size={14} className={`shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-20 mt-1.5 w-full max-h-64 overflow-y-auto bg-white dark:bg-ink-800 border border-gray-200 dark:border-slate-800 rounded-xl shadow-lg py-1.5">
          {options.length === 0 && (
            <p className="px-3.5 py-2 text-[11px] text-gray-400 dark:text-slate-500">Nothing to choose from yet.</p>
          )}
          {options.map((opt) => {
            const checked = selected.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggle(opt.value)}
                className="w-full flex items-center gap-2.5 px-3.5 py-2 text-left text-xs font-medium text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-800/60 cursor-pointer"
              >
                <span
                  className={`w-4 h-4 rounded-md border flex items-center justify-center shrink-0 ${
                    checked
                      ? 'bg-indigo-600 border-indigo-600 dark:bg-blue-500 dark:border-blue-500'
                      : 'border-gray-300 dark:border-slate-600'
                  }`}
                >
                  {checked && <Check size={11} className="text-white" />}
                </span>
                <span className="truncate">{opt.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ReportsSection({ projects, registeredUsers, currentUserEmail }: ReportsSectionProps) {
  // ---- Level 1: scope ----
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [selectedZones, setSelectedZones] = useState<string[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

  // ---- Level 2: keyword rankings only ----
  const [keywordLimit, setKeywordLimit] = useState<number | null>(null);
  const [changeFilter, setChangeFilter] = useState<'improvement' | 'decrement' | null>(null);

  // ---- Level 3: toggles ----
  const [includeProjectTable, setIncludeProjectTable] = useState(false);
  const [includeIdleProjects, setIncludeIdleProjects] = useState(false);

  const [sending, setSending] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [sendingPlain, setSendingPlain] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const triggerAlert = (type: 'success' | 'error', text: string) => {
    setStatusMsg({ type, text });
    setTimeout(() => setStatusMsg(null), 5000);
  };

  const authHeaders = useMemo(
    () => ({
      'Content-Type': 'application/json',
      ...(currentUserEmail ? { 'x-user-email': currentUserEmail } : {}),
    }),
    [currentUserEmail]
  );

  const locationOptions = useMemo(() => {
    const set = new Set<string>();
    projects.forEach((p) => p.location && set.add(p.location));
    return Array.from(set).sort().map((v) => ({ value: v, label: v }));
  }, [projects]);

  const zoneOptions = useMemo(() => {
    const set = new Set<string>();
    projects.forEach((p) => p.region && set.add(p.region));
    return Array.from(set).sort().map((v) => ({ value: v, label: v }));
  }, [projects]);

  const userOptions = useMemo(
    () => registeredUsers.map((u) => ({ value: u.email, label: u.name || u.email })),
    [registeredUsers]
  );

  const buildFilterPayload = () => ({
    locations: selectedLocations,
    zones: selectedZones,
    userIds: selectedUserIds,
    keywordLimit,
    changeFilter,
    includeProjectTable,
    includeIdleProjects,
  });

  const handleSendCustomReport = async () => {
    setSending(true);
    try {
      const res = await fetch('/api/rankings/send-custom-report', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(buildFilterPayload()),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send report.');
      if (data.email?.sent) {
        triggerAlert('success', 'Custom report sent.');
      } else {
        triggerAlert('error', data.email?.reason || 'Report was not sent.');
      }
    } catch (err: any) {
      triggerAlert('error', err.message || 'Something went wrong sending the report.');
    } finally {
      setSending(false);
    }
  };

  const handleDownloadExcel = async () => {
    setDownloading(true);
    try {
      const res = await fetch('/api/rankings/export-report-excel', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(buildFilterPayload()),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to generate the Excel file.');
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Custom-SEO-Report-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      triggerAlert('error', err.message || 'Something went wrong downloading the report.');
    } finally {
      setDownloading(false);
    }
  };

  const handleSendWithoutCustomizing = async () => {
    setSendingPlain(true);
    try {
      const res = await fetch('/api/rankings/send-report', { method: 'POST', headers: authHeaders });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send report.');
      if (data.email?.sent) {
        triggerAlert('success', `Report sent (${data.keywordsInReport} keyword(s)).`);
      } else {
        triggerAlert('error', data.email?.reason || data.reason || 'Report was not sent.');
      }
    } catch (err: any) {
      triggerAlert('error', err.message || 'Something went wrong sending the report.');
    } finally {
      setSendingPlain(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in text-left">
      {statusMsg && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`p-4 rounded-xl text-xs font-bold flex items-center gap-2 shadow-xs ${
            statusMsg.type === 'success'
              ? 'bg-emerald-55 text-emerald-900 border border-emerald-100 dark:border-emerald-500/20'
              : 'bg-rose-50 dark:bg-rose-500/10 text-rose-900 border border-rose-100'
          }`}
        >
          <span>{statusMsg.type === 'success' ? '🟢' : '🔴'}</span>
          <span>{statusMsg.text}</span>
        </motion.div>
      )}

      {/* ================= CUSTOMIZATION BLOCK ================= */}
      <div className="border border-gray-150 dark:border-slate-800 rounded-2xl bg-white dark:bg-ink-900 p-5 sm:p-6 space-y-6">
        {/* Level 1 */}
        <div className="space-y-2">
          <p className="text-[11px] font-black text-indigo-500 dark:text-blue-400 uppercase tracking-wider">Level 1 · Scope</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <MultiSelectDropdown
              label="Location"
              icon={<MapPin size={12} />}
              options={locationOptions}
              selected={selectedLocations}
              onChange={setSelectedLocations}
            />
            <MultiSelectDropdown
              label="Zone"
              icon={<Globe2 size={12} />}
              options={zoneOptions}
              selected={selectedZones}
              onChange={setSelectedZones}
            />
            <MultiSelectDropdown
              label="Users"
              icon={<UsersIcon size={12} />}
              options={userOptions}
              selected={selectedUserIds}
              onChange={setSelectedUserIds}
            />
          </div>
        </div>

        <div className="border-t border-gray-100 dark:border-slate-800/60" />

        {/* Level 2 */}
        <div className="space-y-2">
          <p className="text-[11px] font-black text-indigo-500 dark:text-blue-400 uppercase tracking-wider">Level 2 · Keyword Rankings</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-[11px] font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-1.5 block">
                Domains with
              </label>
              <select
                value={keywordLimit ?? ''}
                onChange={(e) => setKeywordLimit(e.target.value ? Number(e.target.value) : null)}
                className="w-full px-3.5 py-2.5 bg-white dark:bg-ink-900 border border-gray-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-gray-800 dark:text-slate-100 cursor-pointer"
              >
                <option value="">Any number of keywords</option>
                {KEYWORD_LIMIT_OPTIONS.map((n) => (
                  <option key={n} value={n}>Up to {n} keywords</option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={() => setChangeFilter((c) => (c === 'improvement' ? null : 'improvement'))}
              className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold border transition cursor-pointer ${
                changeFilter === 'improvement'
                  ? 'bg-emerald-600 border-emerald-600 text-white'
                  : 'bg-white dark:bg-ink-900 border-gray-200 dark:border-slate-800 text-gray-700 dark:text-slate-200 hover:border-emerald-300'
              }`}
            >
              <TrendingUp size={14} />
              Only projects with improvement
            </button>

            <button
              type="button"
              onClick={() => setChangeFilter((c) => (c === 'decrement' ? null : 'decrement'))}
              className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold border transition cursor-pointer ${
                changeFilter === 'decrement'
                  ? 'bg-rose-600 border-rose-600 text-white'
                  : 'bg-white dark:bg-ink-900 border-gray-200 dark:border-slate-800 text-gray-700 dark:text-slate-200 hover:border-rose-300'
              }`}
            >
              <TrendingDown size={14} />
              Only projects with decrement
            </button>
          </div>
        </div>

        <div className="border-t border-gray-100 dark:border-slate-800/60" />

        {/* Level 3 */}
        <div className="space-y-2">
          <p className="text-[11px] font-black text-indigo-500 dark:text-blue-400 uppercase tracking-wider">Level 3 · Sections</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex items-center gap-2.5 px-3.5 py-2.5 bg-white dark:bg-ink-900 border border-gray-200 dark:border-slate-800 rounded-xl text-xs font-bold text-gray-700 dark:text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={includeProjectTable}
                onChange={(e) => setIncludeProjectTable(e.target.checked)}
                className="w-4 h-4 rounded accent-indigo-600 dark:accent-blue-500 cursor-pointer"
              />
              <Table2 size={14} className="text-indigo-500 dark:text-blue-400" />
              Project Table
            </label>
            <label className="flex items-center gap-2.5 px-3.5 py-2.5 bg-white dark:bg-ink-900 border border-gray-200 dark:border-slate-800 rounded-xl text-xs font-bold text-gray-700 dark:text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={includeIdleProjects}
                onChange={(e) => setIncludeIdleProjects(e.target.checked)}
                className="w-4 h-4 rounded accent-indigo-600 dark:accent-blue-500 cursor-pointer"
              />
              <FolderOpen size={14} className="text-indigo-500 dark:text-blue-400" />
              Idle Projects
            </label>
          </div>
          <p className="text-[11px] text-gray-400 dark:text-slate-500">
            When checked, the full Project Table / Idle Projects data goes into the report exactly as it stands — nothing is trimmed.
          </p>
        </div>

        {/* Buttons */}
        <div className="border-t border-gray-100 dark:border-slate-800/60 pt-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3">
          <button
            onClick={handleSendCustomReport}
            disabled={sending}
            className="flex items-center justify-center gap-1.5 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl text-xs transition shadow-xs cursor-pointer whitespace-nowrap"
          >
            <Send size={14} />
            {sending ? 'Sending…' : 'Send Report'}
          </button>
          <button
            onClick={handleDownloadExcel}
            disabled={downloading}
            className="flex items-center justify-center gap-1.5 px-4 py-2.5 bg-gray-800 dark:bg-slate-700 hover:bg-gray-900 dark:hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl text-xs transition shadow-xs cursor-pointer whitespace-nowrap"
          >
            <FileSpreadsheet size={14} />
            {downloading ? 'Preparing…' : 'Download Excel'}
          </button>
        </div>
      </div>

      {/* ================= SEND WITHOUT CUSTOMIZING ================= */}
      <div className="border border-gray-150 dark:border-slate-800 rounded-2xl bg-white dark:bg-ink-900 p-5 flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
        <div className="flex-1 space-y-1">
          <p className="text-xs font-bold text-gray-800 dark:text-slate-100">Send Report without customizing</p>
          <p className="text-[11px] text-gray-400 dark:text-slate-500">
            Ignores every filter above and sends the report exactly as it's currently set up (same as the automatic Sunday report).
          </p>
        </div>
        <button
          onClick={handleSendWithoutCustomizing}
          disabled={sendingPlain}
          className="flex items-center justify-center gap-1.5 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl text-xs transition shadow-xs cursor-pointer whitespace-nowrap"
        >
          <Download size={14} />
          {sendingPlain ? 'Sending…' : 'Send Report without customizing'}
        </button>
      </div>
    </div>
  );
}
