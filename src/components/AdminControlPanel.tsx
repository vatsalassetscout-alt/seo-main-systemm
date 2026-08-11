/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Project } from '../types';
import {
  Plus,
  Trash2,
  Pencil,
  ArrowRightLeft,
  UserPlus,
  X,
  Tag,
  Loader2,
  FolderPlus,
  Users as UsersIcon,
  KeyRound,
} from 'lucide-react';
import { motion } from 'motion/react';

interface AppUserRow {
  email: string; // this is actually the userId (app_users.user_id)
  name: string;
  paused?: boolean;
  role?: string;
}

interface AdminControlPanelProps {
  projects: Project[];
  currentUserEmail: string | null;
  onUpdateProjects: (projects: Project[]) => void;
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
}: AdminControlPanelProps) {
  const [users, setUsers] = useState<AppUserRow[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [showAddProject, setShowAddProject] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [reassigningProject, setReassigningProject] = useState<Project | null>(null);
  const [showAddUser, setShowAddUser] = useState(false);
  const [renamingUser, setRenamingUser] = useState<AppUserRow | null>(null);
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

  const fetchUsers = async () => {
    setLoadingUsers(true);
    try {
      const res = await fetch('/api/users');
      const data = await res.json();
      setUsers(data.users || []);
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

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
    if (!window.confirm(`Permanently delete "${project.name || project.domain}"? This cannot be undone.`)) return;
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
  // USER ACTIONS
  // ---------------------------------------------------------------------

  const handleAddUser = async (userId: string, name: string, passkey: string, role: 'user' | 'admin') => {
    setBusy(true);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ userId, name, passkey, role }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Request failed');
      setUsers(data.users || []);
      triggerAlert('success', 'User added.');
      setShowAddUser(false);
    } catch (err: any) {
      triggerAlert('error', err.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteUser = async (user: AppUserRow) => {
    if (!window.confirm(`Delete user "${user.name}" (ID: ${user.email})? Their projects will remain but stay unassigned until reassigned.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(user.email)}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Request failed');
      setUsers(data.users || []);
      triggerAlert('success', 'User deleted.');
    } catch (err: any) {
      triggerAlert('error', err.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const handleRenameUser = async (oldUserId: string, newUserId: string, newName: string, newPasskey: string) => {
    setBusy(true);
    try {
      const res = await fetch('/api/users/rename', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          oldUserId,
          newUserId,
          newName,
          ...(newPasskey ? { newPasskey } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Request failed');
      setUsers(data.users || []);
      if (data.projects) onUpdateProjects(data.projects);
      triggerAlert('success', 'User updated.');
      setRenamingUser(null);
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
              ? 'bg-emerald-55 text-emerald-900 border border-emerald-100'
              : 'bg-rose-50 text-rose-900 border border-rose-100'
          }`}
        >
          <span>{statusMsg.type === 'success' ? '🟢' : '🔴'}</span>
          <span>{statusMsg.text}</span>
        </motion.div>
      )}

      {/* ================= PROJECTS ================= */}
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-gray-100 pb-4">
          <div>
            <h4 className="font-extrabold text-gray-900 text-sm flex items-center gap-2">
              <FolderPlus size={16} className="text-indigo-600" />
              Project Control
            </h4>
            <p className="text-xs text-gray-400">Add, edit, delete, and reassign projects.</p>
          </div>
          <button
            onClick={() => setShowAddProject(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition shadow-xs cursor-pointer"
          >
            <Plus size={14} />
            Add Project
          </button>
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
              {projects.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-xs text-gray-400 font-semibold">
                    No projects yet. Click "Add Project" to create one.
                  </td>
                </tr>
              )}
              {projects.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50/45 transition text-xs align-top">
                  <td className="py-3 px-4 font-extrabold text-gray-900">
                    {p.name}
                    <div className="text-[10px] font-mono font-semibold text-gray-400 mt-0.5">{p.id}</div>
                  </td>
                  <td className="py-3 px-4 font-semibold text-gray-600">{p.domain || '—'}</td>
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
                    {(p.users && p.users[0]) || p.userId || <span className="text-amber-600">Unassigned</span>}
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

      {/* ================= USERS ================= */}
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-gray-100 pb-4">
          <div>
            <h4 className="font-extrabold text-gray-900 text-sm flex items-center gap-2">
              <UsersIcon size={16} className="text-indigo-600" />
              User Control
            </h4>
            <p className="text-xs text-gray-400">Add, rename (ID / name / passkey), and delete users.</p>
          </div>
          <button
            onClick={() => setShowAddUser(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition shadow-xs cursor-pointer"
          >
            <UserPlus size={14} />
            Add User
          </button>
        </div>

        <div className="overflow-x-auto border border-gray-150 rounded-2xl bg-white max-h-96 overflow-y-auto">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-gray-50/95 backdrop-blur-sm">
              <tr className="border-b border-gray-150 text-[9px] font-bold text-gray-400 uppercase tracking-widest">
                <th className="py-3 px-4">Name</th>
                <th className="py-3 px-4">User ID (Login)</th>
                <th className="py-3 px-4">Role</th>
                <th className="py-3 px-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-105">
              {loadingUsers && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-xs text-gray-400 font-semibold">
                    <Loader2 size={16} className="inline animate-spin mr-2" />
                    Loading users…
                  </td>
                </tr>
              )}
              {!loadingUsers && users.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-xs text-gray-400 font-semibold">
                    No users yet. Click "Add User" to create one.
                  </td>
                </tr>
              )}
              {users.map((u) => (
                <tr key={u.email} className="hover:bg-slate-50/45 transition text-xs">
                  <td className="py-3 px-4 font-extrabold text-gray-900">{u.name}</td>
                  <td className="py-3 px-4 font-mono font-semibold text-gray-500">{u.email}</td>
                  <td className="py-3 px-4">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide ${
                        u.role === 'admin' ? 'bg-violet-50 text-violet-700' : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {u.role || 'user'}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        onClick={() => setRenamingUser(u)}
                        title="Rename / change ID / passkey"
                        className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition cursor-pointer"
                      >
                        <KeyRound size={14} />
                      </button>
                      <button
                        onClick={() => handleDeleteUser(u)}
                        title="Delete user"
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

      {showAddUser && (
        <AddUserModal busy={busy} onClose={() => setShowAddUser(false)} onSubmit={handleAddUser} />
      )}

      {renamingUser && (
        <RenameUserModal
          user={renamingUser}
          busy={busy}
          onClose={() => setRenamingUser(null)}
          onSubmit={(newId, newName, newPasskey) => handleRenameUser(renamingUser.email, newId, newName, newPasskey)}
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
          <h3 className="font-extrabold text-gray-900 text-sm">Reassign Project</h3>
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

// ===========================================================================
// MODAL: Add User
// ===========================================================================
function AddUserModal({
  busy,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  onClose: () => void;
  onSubmit: (userId: string, name: string, passkey: string, role: 'user' | 'admin') => void;
}) {
  const [userId, setUserId] = useState('');
  const [name, setName] = useState('');
  const [passkey, setPasskey] = useState('');
  const [role, setRole] = useState<'user' | 'admin'>('user');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId.trim() || !name.trim() || !passkey.trim()) return;
    onSubmit(userId.trim(), name.trim(), passkey.trim(), role);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fade-in text-left">
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="bg-white rounded-3xl border border-gray-150 shadow-lg w-full max-w-sm"
      >
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <h3 className="font-extrabold text-gray-900 text-sm">Add User</h3>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-50 rounded-lg cursor-pointer">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest">User ID (used to log in) *</label>
            <input
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              required
              placeholder="e.g. 7412"
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 focus:border-indigo-650 rounded-xl text-xs font-semibold font-mono focus:outline-none focus:ring-1 focus:ring-indigo-650 transition"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest">Display Name *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="e.g. Rohit Sharma"
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 focus:border-indigo-650 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-650 transition"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest">Passkey *</label>
            <input
              value={passkey}
              onChange={(e) => setPasskey(e.target.value)}
              required
              type="text"
              placeholder="e.g. 4821"
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 focus:border-indigo-650 rounded-xl text-xs font-semibold font-mono focus:outline-none focus:ring-1 focus:ring-indigo-650 transition"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as 'user' | 'admin')}
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 focus:border-indigo-650 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-650 transition"
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={busy}
            className="w-full px-5 py-3.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-bold rounded-xl text-xs transition shadow-sm cursor-pointer"
          >
            {busy ? 'Adding…' : 'Add User'}
          </button>
        </form>
      </motion.div>
    </div>
  );
}

// ===========================================================================
// MODAL: Rename User / Change ID / Change Passkey
// ===========================================================================
function RenameUserModal({
  user,
  busy,
  onClose,
  onSubmit,
}: {
  user: AppUserRow;
  busy: boolean;
  onClose: () => void;
  onSubmit: (newUserId: string, newName: string, newPasskey: string) => void;
}) {
  const [newUserId, setNewUserId] = useState(user.email);
  const [newName, setNewName] = useState(user.name);
  const [newPasskey, setNewPasskey] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserId.trim() || !newName.trim()) return;
    onSubmit(newUserId.trim(), newName.trim(), newPasskey.trim());
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fade-in text-left">
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="bg-white rounded-3xl border border-gray-150 shadow-lg w-full max-w-sm"
      >
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <h3 className="font-extrabold text-gray-900 text-sm">Edit "{user.name}"</h3>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-50 rounded-lg cursor-pointer">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest">Current User ID</label>
            <div className="px-4 py-3 bg-gray-50 border border-gray-150 rounded-xl text-xs font-mono font-bold text-gray-400">
              {user.email}
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest">New User ID (login)</label>
            <input
              value={newUserId}
              onChange={(e) => setNewUserId(e.target.value)}
              required
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 focus:border-indigo-650 rounded-xl text-xs font-semibold font-mono focus:outline-none focus:ring-1 focus:ring-indigo-650 transition"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest">New Display Name</label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              required
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 focus:border-indigo-650 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-650 transition"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest">New Passkey (optional)</label>
            <input
              value={newPasskey}
              onChange={(e) => setNewPasskey(e.target.value)}
              placeholder="Leave blank to keep current passkey"
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 focus:border-indigo-650 rounded-xl text-xs font-semibold font-mono focus:outline-none focus:ring-1 focus:ring-indigo-650 transition"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="w-full px-5 py-3.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-bold rounded-xl text-xs transition shadow-sm cursor-pointer"
          >
            {busy ? 'Saving…' : 'Save Changes'}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
