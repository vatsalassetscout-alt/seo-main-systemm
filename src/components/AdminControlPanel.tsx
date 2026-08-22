/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { Project } from '../types';
import { AppUserRow } from './UserManagement';
import {
  Plus,
  Trash2,
  Pencil,
  ArrowRightLeft,
  X,
  Tag,
  Search,
  FolderPlus,
  Send,
  BarChart3,
} from 'lucide-react';
import { motion } from 'motion/react';
import { numericIdCompare } from '../lib/userUtils';

interface AdminControlPanelProps {
  projects: Project[];
  currentUserEmail: string | null;
  onUpdateProjects: (projects: Project[]) => void;
  /** Single merged user pipeline (registered + existing/derived) — comes
   *  from UserManagementPanel so the Reassign dropdown always matches the
   *  Users tab exactly. */
  users: AppUserRow[];
}

// Blank template for the Add/Edit Project form
const emptyProjectForm = {
  id: '',
  name: '',
  domain: '',
  location: '',
  region: '',
};

function slugFromDomain(domain: string): string {
  const slug = domain.trim().toLowerCase().replace(/[^a-z0-9]/g, '-');
  return slug || 'new-project';
}

// Strips protocol (http/https), "www.", and any trailing path/slash so the
// project is always stored as a bare domain like "example.com".
function normalizeDomain(raw: string): string {
  if (!raw) return raw;
  let d = raw.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '');
  d = d.replace(/^www\./, '');
  d = d.split('/')[0];
  d = d.split('?')[0];
  return d.trim();
}

export default function AdminControlPanel({
  projects,
  currentUserEmail,
  onUpdateProjects,
  users,
}: AdminControlPanelProps) {
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [showAddProject, setShowAddProject] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [reassigningProject, setReassigningProject] = useState<Project | null>(null);
  const [projectSearch, setProjectSearch] = useState('');
  const [busy, setBusy] = useState(false);

  // ---- Ranking Report: Send Report ----
  const [sendingReport, setSendingReport] = useState(false);

  const authHeaders = useMemo(
    () => ({
      'Content-Type': 'application/json',
      ...(currentUserEmail ? { 'x-user-email': currentUserEmail } : {}),
    }),
    [currentUserEmail]
  );

  const triggerAlert = (type: 'success' | 'error', text: string) => {
    setStatusMsg({ type, text });
    setTimeout(() => setStatusMsg(null), 4000);
  };

  // Backend/pipeline still works purely on userId (p.userId / p.users[0]) —
  // this map is display-only, so Project Control can show the person's
  // name instead of their raw numeric ID.
  const nameByUserId = useMemo(() => {
    const map = new Map<string, string>();
    users.forEach((u) => {
      if (u.email) map.set(String(u.email).trim().toLowerCase(), u.name || u.email);
    });
    return map;
  }, [users]);
  const nameForAssignedId = (id: string): string =>
    nameByUserId.get(String(id).trim().toLowerCase()) || id;

  const filteredProjects = useMemo(() => {
    const term = projectSearch.trim().toLowerCase();
    const base = !term
      ? projects
      : projects.filter((p) => {
          const assignedTo = (p.users && p.users[0]) || p.userId || '';
          return (
            (p.name || '').toLowerCase().includes(term) ||
            (p.domain || '').toLowerCase().includes(term) ||
            (p.location || '').toLowerCase().includes(term) ||
            (p.region || '').toLowerCase().includes(term) ||
            String(assignedTo).toLowerCase().includes(term) ||
            (p.keywords || []).some((k) => k.toLowerCase().includes(term))
          );
        });

    // Admin's Project Control table is ordered by the assigned user's
    // numeric ID (not alphabetically / not insertion order), so all of a
    // given user's projects sit together in a predictable, ID-ordered
    // sequence. Unassigned projects sort last.
    return [...base].sort((a, b) => {
      const idA = a.userId || (a.users && a.users[0]) || '';
      const idB = b.userId || (b.users && b.users[0]) || '';
      if (!idA && idB) return 1;
      if (idA && !idB) return -1;
      const cmp = numericIdCompare(idA, idB);
      if (cmp !== 0) return cmp;
      return (a.name || '').localeCompare(b.name || '');
    });
  }, [projects, projectSearch]);

  // ---------------------------------------------------------------------
  // PROJECT ACTIONS
  // ---------------------------------------------------------------------

  const handleAddOrEditProject = async (project: Project, isEdit: boolean) => {
    setBusy(true);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ action: isEdit ? 'edit' : 'add', project }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Request failed');
      onUpdateProjects(data.list);
      triggerAlert('success', isEdit ? 'Project updated.' : 'Project added.');
      setShowAddProject(false);
      setEditingProject(null);
    } catch (err: any) {
      triggerAlert('error', err.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteProject = async (project: Project) => {
    if (!window.confirm(`Permanently delete "${project.name || normalizeDomain(project.domain || '')}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ action: 'delete', project: { id: project.id } }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Request failed');
      onUpdateProjects(data.list);
      triggerAlert('success', 'Project deleted.');
    } catch (err: any) {
      triggerAlert('error', err.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const handleReassign = async (project: Project, newUserId: string, newUserName: string) => {
    setBusy(true);
    try {
      const res = await fetch('/api/projects/reassign', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ projectId: project.id, newUserId, newUserName }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Request failed');
      onUpdateProjects(data.list);
      triggerAlert('success', `Reassigned to ${newUserName}.`);
      setReassigningProject(null);
    } catch (err: any) {
      triggerAlert('error', err.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  // ---------------------------------------------------------------------
  // RANKING REPORT ACTION (manual "Send Report" button)
  // ---------------------------------------------------------------------
  // The Ranking tab already has its own "Check All" / per-project "Check"
  // buttons that check live SERP rankings. This just emails whatever
  // ranking data is currently present (however many keywords that is) -
  // same format, same recipient as the automatic Sunday system. No
  // re-checking happens here.
  const handleSendReport = async () => {
    setSendingReport(true);
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
      setSendingReport(false);
    }
  };

  return (
    <div className="space-y-8 animate-fade-in text-left">
      {statusMsg && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`p-4 rounded-xl text-xs font-bold flex items-center gap-2 shadow-xs ${
            statusMsg.type === 'success'
              ? 'bg-emerald-55 text-emerald-900 border border-emerald-100'
              : 'bg-rose-50 text-rose-900 border border-rose-100'
          }`}
        >
          <span>{statusMsg.type === 'success' ? '🟢' : '🔴'}</span>
          <span>{statusMsg.text}</span>
        </motion.div>
      )}

      {/* ================= RANKING REPORT (manual send) ================= */}
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-gray-100 pb-4">
          <div>
            <h4 className="font-extrabold text-gray-900 text-sm flex items-center gap-2">
              <BarChart3 size={16} className="text-indigo-600" />
              Ranking Report
            </h4>
            <p className="text-xs text-gray-400">Automatic report still runs every Sunday.</p>
          </div>
        </div>

        <div className="border border-gray-150 rounded-2xl bg-white p-5 flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
          <div className="flex-1 space-y-1">
            <p className="text-xs font-bold text-gray-800">Send Report</p>
            <p className="text-[11px] text-gray-400">
              Emails whatever ranking data is currently checked (from the Ranking tab) — any number of keywords, same format and recipient as the automatic report. Doesn't check anything itself.
            </p>
          </div>
          <button
            onClick={handleSendReport}
            disabled={sendingReport}
            className="flex items-center justify-center gap-1.5 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl text-xs transition shadow-xs cursor-pointer whitespace-nowrap"
          >
            <Send size={14} />
            {sendingReport ? 'Sending…' : 'Send Report'}
          </button>
        </div>
      </div>

      {/* ================= PROJECTS ================= */}
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-gray-100 pb-4">
          <div>
            <h4 className="font-extrabold text-gray-900 text-sm flex items-center gap-2">
              <FolderPlus size={16} className="text-indigo-600" />
              Project Control
            </h4>
            <p className="text-xs text-gray-400">Add, edit, delete, and Aassign projects.</p>
          </div>
          <button
            onClick={() => setShowAddProject(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition shadow-xs cursor-pointer"
          >
            <Plus size={14} />
            Add Project
          </button>
        </div>

        <div className="relative">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={projectSearch}
            onChange={(e) => setProjectSearch(e.target.value)}
            placeholder="Search projects by name, domain, location, keyword, or assignee…"
            className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 focus:border-indigo-650 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-650 transition"
          />
        </div>

        <div className="overflow-x-auto border border-gray-150 rounded-2xl bg-white max-h-[32rem] overflow-y-auto">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-gray-50/95 backdrop-blur-sm">
              <tr className="border-b border-gray-150 text-[9px] font-bold text-gray-400 uppercase tracking-widest">
                <th className="py-3 px-4">Project</th>
                <th className="py-3 px-4">Domain</th>
                <th className="py-3 px-4">Location / Zone</th>
                <th className="py-3 px-4">Keywords</th>
                <th className="py-3 px-4">Assigned To</th>
                <th className="py-3 px-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-105">
              {filteredProjects.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-xs text-gray-400 font-semibold">
                    {projects.length === 0 ? 'No projects yet. Click "Add Project" to create one.' : 'No projects match your search.'}
                  </td>
                </tr>
              )}
              {filteredProjects.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50/45 transition text-xs align-top">
                  <td className="py-3 px-4 font-extrabold text-gray-900">
                    {p.name}
                    <div className="text-[10px] font-mono font-semibold text-gray-400 mt-0.5">{p.id}</div>
                  </td>
                  <td className="py-3 px-4 font-semibold text-gray-600">{normalizeDomain(p.domain || '') || '—'}</td>
                  <td className="py-3 px-4 font-semibold text-gray-600">
                    {p.location || '—'}
                    {p.region ? ` / ${p.region}` : ''}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex flex-wrap gap-1 max-w-[220px]">
                      {(p.keywords || []).length === 0 && <span className="text-gray-300">—</span>}
                      {(p.keywords || []).slice(0, 4).map((k, i) => (
                        <span key={i} className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-full text-[10px] font-bold">
                          {k}
                        </span>
                      ))}
                      {(p.keywords || []).length > 4 && (
                        <span className="px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full text-[10px] font-bold">
                          +{(p.keywords || []).length - 4}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4 font-semibold text-gray-600">
                    {(p.users && p.users[0]) || p.userId
                      ? nameForAssignedId((p.users && p.users[0]) || p.userId)
                      : <span className="text-amber-600">Unassigned</span>}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        onClick={() => setEditingProject(p)}
                        title="Edit project details"
                        className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition cursor-pointer"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => setReassigningProject(p)}
                        title="Reassign to another user"
                        className="p-2 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition cursor-pointer"
                      >
                        <ArrowRightLeft size={14} />
                      </button>
                      <button
                        onClick={() => handleDeleteProject(p)}
                        title="Delete project"
                        className="p-2 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ================= MODALS ================= */}
      {(showAddProject || editingProject) && (
        <ProjectFormModal
          initial={editingProject || undefined}
          busy={busy}
          onClose={() => {
            setShowAddProject(false);
            setEditingProject(null);
          }}
          onSubmit={(project) => handleAddOrEditProject(project, !!editingProject)}
        />
      )}

      {reassigningProject && (
        <ReassignModal
          project={reassigningProject}
          users={users}
          busy={busy}
          onClose={() => setReassigningProject(null)}
          onSubmit={(userId, userName) => handleReassign(reassigningProject, userId, userName)}
        />
      )}
    </div>
  );
}

// ===========================================================================
// MODAL: Add / Edit Project
// ===========================================================================
function ProjectFormModal({
  initial,
  busy,
  onClose,
  onSubmit,
}: {
  initial?: Project;
  busy: boolean;
  onClose: () => void;
  onSubmit: (project: Project) => void;
}) {
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name || '');
  const [domain, setDomain] = useState(initial?.domain || '');
  const [location, setLocation] = useState(initial?.location || '');
  const [region, setRegion] = useState(initial?.region || '');
  const [keywords, setKeywords] = useState<string[]>(initial?.keywords || []);
  const [keywordInput, setKeywordInput] = useState('');

  const idPreview = isEdit ? initial!.id : slugFromDomain(normalizeDomain(domain));

  const addKeyword = () => {
    const k = keywordInput.trim();
    if (!k) return;
    if (keywords.some((existing) => existing.toLowerCase() === k.toLowerCase())) {
      setKeywordInput('');
      return;
    }
    setKeywords((prev) => [...prev, k]);
    setKeywordInput('');
  };

  const removeKeyword = (k: string) => {
    setKeywords((prev) => prev.filter((kw) => kw !== k));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!domain.trim() || !name.trim()) return;
    const cleanDomain = normalizeDomain(domain);
    const project: Project = {
      ...(initial || ({} as Project)),
      id: isEdit ? initial!.id : slugFromDomain(cleanDomain),
      name: name.trim(),
      domain: cleanDomain,
      location: location.trim(),
      region: region.trim(),
      keywords,
    };
    onSubmit(project);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fade-in text-left">
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="bg-white rounded-3xl border border-gray-150 shadow-lg w-full max-w-lg max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <h3 className="font-extrabold text-gray-900 text-sm">{isEdit ? 'Edit Project' : 'Add Project'}</h3>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-50 rounded-lg cursor-pointer">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest">Project ID</label>
            <div className="px-4 py-3 bg-gray-50 border border-gray-150 rounded-xl text-xs font-mono font-bold text-gray-500">
              {idPreview || <span className="text-gray-300">auto-generated from domain</span>}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest">Domain *</label>
            <input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              onBlur={(e) => setDomain(normalizeDomain(e.target.value))}
              required
              placeholder="e.g. parkpebbles.com"
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 focus:border-indigo-650 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-650 transition"
            />
            <p className="text-[10px] text-gray-400">Just the domain — https://, www. and trailing slashes are stripped automatically.</p>
          </div>

          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest">Project Name *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="e.g. Park Pebbles Bhugaon"
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 focus:border-indigo-650 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-650 transition"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest">Location</label>
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Bhugaon, Pune"
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 focus:border-indigo-650 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-650 transition"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest">Zone</label>
              <input
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                placeholder="e.g. West"
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 focus:border-indigo-650 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-650 transition"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-1.5">
              <Tag size={11} />
              Keywords
            </label>
            <div className="flex gap-2">
              <input
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addKeyword();
                  }
                }}
                placeholder="Type a keyword and press Enter"
                className="flex-1 px-4 py-3 bg-gray-50 border border-gray-200 focus:border-indigo-650 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-650 transition"
              />
              <button
                type="button"
                onClick={addKeyword}
                className="px-4 py-3 bg-gray-900 hover:bg-gray-800 text-white font-bold rounded-xl text-xs transition cursor-pointer"
              >
                Add
              </button>
            </div>
            {keywords.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {keywords.map((k) => (
                  <span
                    key={k}
                    className="flex items-center gap-1 px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-full text-[10px] font-bold"
                  >
                    {k}
                    <button type="button" onClick={() => removeKeyword(k)} className="hover:text-indigo-900 cursor-pointer">
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={busy}
            className="w-full px-5 py-3.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-bold rounded-xl text-xs transition shadow-sm cursor-pointer"
          >
            {busy ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Project'}
          </button>
        </form>
      </motion.div>
    </div>
  );
}

// ===========================================================================
// MODAL: Reassign Project
// ===========================================================================
function ReassignModal({
  project,
  users,
  busy,
  onClose,
  onSubmit,
}: {
  project: Project;
  users: AppUserRow[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (userId: string, userName: string) => void;
}) {
  const [selected, setSelected] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const user = users.find((u) => u.email === selected);
    if (!user) return;
    onSubmit(user.email, user.name);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fade-in text-left">
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="bg-white rounded-3xl border border-gray-150 shadow-lg w-full max-w-sm"
      >
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <h3 className="font-extrabold text-gray-900 text-sm">Assign Project</h3>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-50 rounded-lg cursor-pointer">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <p className="text-xs text-gray-500">
            Moving <span className="font-extrabold text-gray-900">{project.name}</span> to a new user removes it from{' '}
            <span className="font-extrabold text-gray-900">{(project.users && project.users[0]) || project.userId || 'Unassigned'}</span> immediately.
          </p>
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest">New User</label>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              required
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 focus:border-indigo-650 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-650 transition"
            >
              <option value="">Select a user…</option>
              {users.map((u) => (
                <option key={u.email} value={u.email}>
                  {u.name} ({u.email})
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={busy || !selected}
            className="w-full px-5 py-3.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold rounded-xl text-xs transition shadow-sm cursor-pointer"
          >
            {busy ? 'Reassigning…' : 'Confirm Reassign'}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
