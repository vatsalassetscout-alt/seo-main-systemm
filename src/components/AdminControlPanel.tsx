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

  // Projects should only ever store numeric userIds — `users[]` entries
  // that aren't numeric are leftover phantom name-strings from an old bug
  // (a previous Reassign flow saved the person's NAME into `users[]`
  // instead of their ID, while `userId` correctly held the real numeric
  // ID). Left in place, that phantom entry can't be resolved against the
  // User Control table, so it renders as-is (e.g. lowercase "vatsal
  // patel") right next to the properly-resolved name for the same ID
  // (e.g. "Vatsal Patel") — the same person shown twice. Dropping any
  // non-numeric entry here (display-only; the stored data isn't touched)
  // collapses that back down to one badge per real, unique assignee.
  const getAssignedIds = (p: Project): string[] =>
    Array.from(
      new Set(
        [
          ...(p.userId ? [String(p.userId).trim()] : []),
          ...(p.users || [])
            .map((u) => String(u || '').trim())
            .filter((u) => /^\d+$/.test(u)),
        ].filter(Boolean)
      )
    );

  const filteredProjects = useMemo(() => {
    const term = projectSearch.trim().toLowerCase();
    const base = !term
      ? projects
      : projects.filter((p) => {
          const assignedIds = getAssignedIds(p);
          const assignedMatch = assignedIds.some(
            (id) =>
              String(id || '').toLowerCase().includes(term) ||
              nameForAssignedId(String(id || '')).toLowerCase().includes(term)
          );
          return (
            (p.name || '').toLowerCase().includes(term) ||
            (p.domain || '').toLowerCase().includes(term) ||
            (p.location || '').toLowerCase().includes(term) ||
            (p.region || '').toLowerCase().includes(term) ||
            assignedMatch ||
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

  const handleReassign = async (project: Project, newUserIds: string[], newUserNames: string[]) => {
    setBusy(true);
    try {
      const res = await fetch('/api/projects/reassign', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ projectId: project.id, newUserIds, newUserNames }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Request failed');
      onUpdateProjects(data.list);
      triggerAlert(
        'success',
        newUserNames.length > 1
          ? `Assigned to ${newUserNames.length} users.`
          : `Assigned to ${newUserNames[0]}.`
      );
      setReassigningProject(null);
    } catch (err: any) {
      triggerAlert('error', err.message || 'Something went wrong.');
    } finally {
      setBusy(false);
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
              ? 'bg-emerald-55 text-emerald-900 border border-emerald-100 dark:border-emerald-500/20'
              : 'bg-rose-50 dark:bg-rose-500/10 text-rose-900 border border-rose-100'
          }`}
        >
          <span>{statusMsg.type === 'success' ? '🟢' : '🔴'}</span>
          <span>{statusMsg.text}</span>
        </motion.div>
      )}

      {/* ================= PROJECTS ================= */}
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-gray-100 dark:border-slate-800/60 pb-4">
          <div>
            <h4 className="font-extrabold text-gray-900 dark:text-slate-50 text-sm flex items-center gap-2">
              <FolderPlus size={16} className="text-indigo-600 dark:text-blue-400" />
              Project Control
            </h4>
            <p className="text-xs text-gray-400 dark:text-slate-500">Add, edit, delete, and Aassign projects.</p>
          </div>
          <button
            onClick={() => setShowAddProject(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-indigo-600 dark:bg-blue-600 hover:bg-indigo-700 hover:dark:bg-blue-500 text-white font-bold rounded-xl text-xs transition shadow-xs cursor-pointer"
          >
            <Plus size={14} />
            Add Project
          </button>
        </div>

        <div className="relative">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500" />
          <input
            type="text"
            value={projectSearch}
            onChange={(e) => setProjectSearch(e.target.value)}
            placeholder="Search projects by name, domain, location, keyword, or assignee…"
            className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-ink-800/60 border border-gray-200 dark:border-slate-800 focus:border-indigo-650 focus:dark:border-blue-500/50 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-650 focus:dark:ring-blue-500/50 transition"
          />
        </div>

        <div className="overflow-x-auto border border-gray-150 dark:border-slate-800 rounded-2xl bg-white dark:bg-ink-900 max-h-[32rem] overflow-y-auto">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-gray-50/95 dark:bg-ink-900/95 backdrop-blur-sm">
              <tr className="border-b border-gray-150 dark:border-slate-800 text-[9px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest">
                <th className="py-3 px-4">Project</th>
                <th className="py-3 px-4">Domain</th>
                <th className="py-3 px-4">Location / Zone</th>
                <th className="py-3 px-4">Keywords</th>
                <th className="py-3 px-4">Assigned To</th>
                <th className="py-3 px-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-105 dark:divide-slate-800/60">
              {filteredProjects.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-xs text-gray-400 dark:text-slate-500 font-semibold">
                    {projects.length === 0 ? 'No projects yet. Click "Add Project" to create one.' : 'No projects match your search.'}
                  </td>
                </tr>
              )}
              {filteredProjects.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50/45 hover:dark:bg-ink-800/60 transition text-xs align-top">
                  <td className="py-3 px-4 font-extrabold text-gray-900 dark:text-slate-50">
                    {p.name}
                    <div className="text-[10px] font-mono font-semibold text-gray-400 dark:text-slate-500 mt-0.5">{p.id}</div>
                  </td>
                  <td className="py-3 px-4 font-semibold text-gray-600 dark:text-slate-300">{normalizeDomain(p.domain || '') || '—'}</td>
                  <td className="py-3 px-4 font-semibold text-gray-600 dark:text-slate-300">
                    {p.location || '—'}
                    {p.region ? ` / ${p.region}` : ''}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex flex-wrap gap-1 max-w-[220px]">
                      {(p.keywords || []).length === 0 && <span className="text-gray-300 dark:text-slate-500">—</span>}
                      {(p.keywords || []).slice(0, 4).map((k, i) => (
                        <span key={i} className="px-2 py-0.5 bg-indigo-50 dark:bg-blue-500/10 text-indigo-700 dark:text-blue-400 rounded-full text-[10px] font-bold">
                          {k}
                        </span>
                      ))}
                      {(p.keywords || []).length > 4 && (
                        <span className="px-2 py-0.5 bg-gray-100 dark:bg-ink-800 text-gray-500 dark:text-slate-400 rounded-full text-[10px] font-bold">
                          +{(p.keywords || []).length - 4}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4 font-semibold text-gray-600 dark:text-slate-300">
                    {(() => {
                      const assignedIds = getAssignedIds(p);
                      if (assignedIds.length === 0) {
                        return <span className="text-amber-600 dark:text-amber-400">Unassigned</span>;
                      }
                      return (
                        <div className="flex flex-wrap gap-1 max-w-[200px]">
                          {assignedIds.map((id) => (
                            <span
                              key={id}
                              className="px-2 py-0.5 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 rounded-full text-[10px] font-bold"
                            >
                              {nameForAssignedId(id)}
                            </span>
                          ))}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        onClick={() => setEditingProject(p)}
                        title="Edit project details"
                        className="p-2 text-gray-400 dark:text-slate-500 hover:text-indigo-600 hover:dark:text-blue-400 hover:bg-indigo-50 hover:dark:bg-blue-500/10 rounded-lg transition cursor-pointer"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => setReassigningProject(p)}
                        title="Reassign to another user"
                        className="p-2 text-gray-400 dark:text-slate-500 hover:text-emerald-600 hover:dark:text-emerald-400 hover:bg-emerald-50 hover:dark:bg-emerald-500/10 rounded-lg transition cursor-pointer"
                      >
                        <ArrowRightLeft size={14} />
                      </button>
                      <button
                        onClick={() => handleDeleteProject(p)}
                        title="Delete project"
                        className="p-2 text-gray-400 dark:text-slate-500 hover:text-rose-600 hover:dark:text-rose-400 hover:bg-rose-50 hover:dark:bg-rose-500/10 rounded-lg transition cursor-pointer"
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
          onSubmit={(userIds, userNames) => handleReassign(reassigningProject, userIds, userNames)}
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
        className="bg-white dark:bg-ink-900 rounded-3xl border border-gray-150 dark:border-slate-800 shadow-lg w-full max-w-lg max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between p-6 border-b border-gray-100 dark:border-slate-800/60">
          <h3 className="font-extrabold text-gray-900 dark:text-slate-50 text-sm">{isEdit ? 'Edit Project' : 'Add Project'}</h3>
          <button onClick={onClose} className="p-1.5 text-gray-400 dark:text-slate-500 hover:text-gray-700 hover:dark:text-slate-200 hover:bg-gray-50 hover:dark:bg-ink-800/60 rounded-lg cursor-pointer">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest">Project ID</label>
            <div className="px-4 py-3 bg-gray-50 dark:bg-ink-800/60 border border-gray-150 dark:border-slate-800 rounded-xl text-xs font-mono font-bold text-gray-500 dark:text-slate-400">
              {idPreview || <span className="text-gray-300 dark:text-slate-500">auto-generated from domain</span>}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest">Domain *</label>
            <input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              onBlur={(e) => setDomain(normalizeDomain(e.target.value))}
              required
              placeholder="e.g. parkpebbles.com"
              className="w-full px-4 py-3 bg-gray-50 dark:bg-ink-800/60 border border-gray-200 dark:border-slate-800 focus:border-indigo-650 focus:dark:border-blue-500/50 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-650 focus:dark:ring-blue-500/50 transition"
            />
            <p className="text-[10px] text-gray-400 dark:text-slate-500">Just the domain — https://, www. and trailing slashes are stripped automatically.</p>
          </div>

          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest">Project Name *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="e.g. Park Pebbles Bhugaon"
              className="w-full px-4 py-3 bg-gray-50 dark:bg-ink-800/60 border border-gray-200 dark:border-slate-800 focus:border-indigo-650 focus:dark:border-blue-500/50 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-650 focus:dark:ring-blue-500/50 transition"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest">Location</label>
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Bhugaon, Pune"
                className="w-full px-4 py-3 bg-gray-50 dark:bg-ink-800/60 border border-gray-200 dark:border-slate-800 focus:border-indigo-650 focus:dark:border-blue-500/50 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-650 focus:dark:ring-blue-500/50 transition"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest">Zone</label>
              <input
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                placeholder="e.g. West"
                className="w-full px-4 py-3 bg-gray-50 dark:bg-ink-800/60 border border-gray-200 dark:border-slate-800 focus:border-indigo-650 focus:dark:border-blue-500/50 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-650 focus:dark:ring-blue-500/50 transition"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
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
                className="flex-1 px-4 py-3 bg-gray-50 dark:bg-ink-800/60 border border-gray-200 dark:border-slate-800 focus:border-indigo-650 focus:dark:border-blue-500/50 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-650 focus:dark:ring-blue-500/50 transition"
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
                    className="flex items-center gap-1 px-2.5 py-1 bg-indigo-50 dark:bg-blue-500/10 text-indigo-700 dark:text-blue-400 rounded-full text-[10px] font-bold"
                  >
                    {k}
                    <button type="button" onClick={() => removeKeyword(k)} className="hover:text-indigo-900 hover:dark:text-blue-200 cursor-pointer">
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
            className="w-full px-5 py-3.5 bg-indigo-600 dark:bg-blue-600 hover:bg-indigo-700 hover:dark:bg-blue-500 disabled:opacity-60 text-white font-bold rounded-xl text-xs transition shadow-sm cursor-pointer"
          >
            {busy ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Project'}
          </button>
        </form>
      </motion.div>
    </div>
  );
}

// ===========================================================================
// MODAL: Assign Project (multi-select — a project can now be assigned to
// more than one user at once; each checked user gets their own independent
// Task Lineup entries for this project).
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
  onSubmit: (userIds: string[], userNames: string[]) => void;
}) {
  // Pre-check whoever the project is already assigned to.
  const initiallyAssigned = useMemo(() => {
    const ids = new Set<string>();
    (project.users || []).forEach((u) => u && ids.add(String(u).trim().toLowerCase()));
    if (project.userId) ids.add(String(project.userId).trim().toLowerCase());
    return ids;
  }, [project]);

  const [selected, setSelected] = useState<Set<string>>(initiallyAssigned);
  const [userSearch, setUserSearch] = useState('');

  const toggleUser = (email: string) => {
    const key = String(email).trim().toLowerCase();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const filteredUsers = useMemo(() => {
    const term = userSearch.trim().toLowerCase();
    if (!term) return users;
    return users.filter(
      (u) => (u.name || '').toLowerCase().includes(term) || (u.email || '').toLowerCase().includes(term)
    );
  }, [users, userSearch]);

  const currentlyAssignedLabel =
    (project.users && project.users.length > 0 ? project.users.join(', ') : '') || project.userId || 'Unassigned';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const matched = users.filter((u) => selected.has(String(u.email).trim().toLowerCase()));
    if (matched.length === 0) return;
    onSubmit(matched.map((u) => u.email), matched.map((u) => u.name));
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fade-in text-left">
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="bg-white dark:bg-ink-900 rounded-3xl border border-gray-150 dark:border-slate-800 shadow-lg w-full max-w-sm"
      >
        <div className="flex items-center justify-between p-6 border-b border-gray-100 dark:border-slate-800/60">
          <h3 className="font-extrabold text-gray-900 dark:text-slate-50 text-sm">Assign Project</h3>
          <button onClick={onClose} className="p-1.5 text-gray-400 dark:text-slate-500 hover:text-gray-700 hover:dark:text-slate-200 hover:bg-gray-50 hover:dark:bg-ink-800/60 rounded-lg cursor-pointer">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <p className="text-xs text-gray-500 dark:text-slate-400">
            Choose one or more users for <span className="font-extrabold text-gray-900 dark:text-slate-50">{project.name}</span>. This
            replaces the current assignment (<span className="font-extrabold text-gray-900 dark:text-slate-50">{currentlyAssignedLabel}</span>) — anyone
            unchecked below immediately stops receiving it in their Task Lineup.
          </p>

          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest">
              Users {selected.size > 0 ? `(${selected.size} selected)` : ''}
            </label>
            <input
              type="text"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="Search users…"
              className="w-full px-4 py-2.5 bg-gray-50 dark:bg-ink-800/60 border border-gray-200 dark:border-slate-800 focus:border-indigo-650 focus:dark:border-blue-500/50 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-650 focus:dark:ring-blue-500/50 transition"
            />
            <div className="max-h-56 overflow-y-auto border border-gray-150 dark:border-slate-800 rounded-xl divide-y divide-gray-105 dark:divide-slate-800/60">
              {filteredUsers.length === 0 && (
                <div className="px-4 py-3 text-xs text-gray-400 dark:text-slate-500 font-semibold">No users match.</div>
              )}
              {filteredUsers.map((u) => {
                const key = String(u.email).trim().toLowerCase();
                const checked = selected.has(key);
                return (
                  <label
                    key={u.email}
                    className={`flex items-center gap-3 px-4 py-2.5 text-xs font-semibold cursor-pointer transition ${
                      checked
                        ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
                        : 'text-gray-600 dark:text-slate-300 hover:bg-gray-50 hover:dark:bg-ink-800/60'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleUser(u.email)}
                      className="h-4 w-4 rounded border-gray-300 dark:border-slate-700 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                    />
                    <span className="flex-1">
                      {u.name} <span className="text-gray-400 dark:text-slate-500 font-normal">({u.email})</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <button
            type="submit"
            disabled={busy || selected.size === 0}
            className="w-full px-5 py-3.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold rounded-xl text-xs transition shadow-sm cursor-pointer"
          >
            {busy ? 'Assigning…' : `Confirm Assign${selected.size > 1 ? ` (${selected.size})` : ''}`}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
