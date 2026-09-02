/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { AppUser, Project } from '../types';
import { isUserAdmin as isAdminId, numericIdCompare } from '../lib/userUtils';
import {
  Plus,
  Trash2,
  X,
  Loader2,
  Users as UsersIcon,
  KeyRound,
  UserPlus,
} from 'lucide-react';
import { motion } from 'motion/react';

export interface AppUserRow {
  email: string; // this is actually the userId (login id)
  name: string;
  paused?: boolean;
  role?: string;
  /** true when this row only exists because a project is assigned to them
   *  in the sheet/projects data — they were never explicitly registered
   *  via "Add User". Shown so admins know they can "Register" them. */
  derived?: boolean;
}

/**
 * The single pipeline that decides which users show up everywhere in the
 * admin UI (Users tab AND the Reassign dropdown): merge the real, registered
 * accounts (from /api/users) with users that only exist today because
 * they're assigned to a project (from `allowedUsers`, which App.tsx already
 * derives from the projects/sheet data). Registered accounts always win on
 * conflict since they carry the accurate role/name.
 */
export function mergeUsers(
  registeredUsers: AppUserRow[],
  allowedUsers: AppUser[],
  adminEmails: string[] = []
): AppUserRow[] {
  const byId = new Map<string, AppUserRow>();

  registeredUsers.forEach((u) => {
    if (!u.email) return;
    const id = String(u.email).trim().toLowerCase();
    if (!id || isAdminId(id)) return;
    byId.set(id, { ...u, email: String(u.email).trim(), derived: false });
  });

  allowedUsers.forEach((u) => {
    if (!u.email) return;
    const id = String(u.email).trim().toLowerCase();
    if (!id || isAdminId(id)) return;
    if (adminEmails.some((a) => a.trim().toLowerCase() === id)) return;
    if (byId.has(id)) return; // registered account already covers this user
    byId.set(id, {
      email: String(u.email).trim(),
      name: u.name || String(u.email).trim(),
      role: 'user',
      derived: true,
    });
  });

  // Sorted by numeric user ID (not by name) so the admin's Users list —
  // and every panel that reuses this same merged pipeline (Reassign
  // dropdown, Project Control, etc.) — lists people in user-ID order.
  return Array.from(byId.values()).sort((a, b) => numericIdCompare(a.email, b.email));
}

interface UserManagementPanelProps {
  allowedUsers: AppUser[];
  adminEmails: string[];
  currentUserEmail: string | null;
  onUpdateProjects?: (projects: Project[]) => void;
  /** Bubbles the fully merged, de-duplicated user list up so other panels
   *  (like the Reassign dropdown in Project Control) stay in sync. */
  onUsersResolved?: (users: AppUserRow[]) => void;
}

export default function UserManagementPanel({
  allowedUsers,
  adminEmails,
  currentUserEmail,
  onUpdateProjects,
  onUsersResolved,
}: UserManagementPanelProps) {
  const [registeredUsers, setRegisteredUsers] = useState<AppUserRow[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
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
      setRegisteredUsers(data.users || []);
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  // Single merged pipeline: registered accounts + anyone already assigned
  // to a project who hasn't been formally registered yet.
  const mergedUsers = useMemo(
    () => mergeUsers(registeredUsers, allowedUsers, adminEmails),
    [registeredUsers, allowedUsers, adminEmails]
  );

  useEffect(() => {
    onUsersResolved?.(mergedUsers);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mergedUsers]);

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
      setRegisteredUsers(data.users || []);
      triggerAlert('success', 'User added.');
      setShowAddUser(false);
    } catch (err: any) {
      triggerAlert('error', err.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteUser = async (user: AppUserRow) => {
    if (user.derived) {
      triggerAlert('error', 'This user was never formally registered — nothing to delete. Reassign their projects instead.');
      return;
    }
    if (!window.confirm(`Delete user "${user.name}" (ID: ${user.email})? Their projects will remain but stay unassigned until reassigned.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(user.email)}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Request failed');
      setRegisteredUsers(data.users || []);
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
      setRegisteredUsers(data.users || []);
      if (data.projects && onUpdateProjects) onUpdateProjects(data.projects);
      triggerAlert('success', 'User updated.');
      setRenamingUser(null);
    } catch (err: any) {
      triggerAlert('error', err.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  // "Register" turns a derived (project-only) user into a real account by
  // pre-filling the Add User modal with their known id/name.
  const [registerSeed, setRegisterSeed] = useState<AppUserRow | null>(null);

  return (
    <div className="space-y-4">
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

      <div className="flex items-center justify-between border-b border-gray-100 dark:border-slate-800/60 pb-4">
        <div>
          <h4 className="font-extrabold text-gray-900 dark:text-slate-50 text-sm flex items-center gap-2">
            <UsersIcon size={16} className="text-indigo-600 dark:text-blue-400" />
            User Control
          </h4>
          <p className="text-xs text-gray-400 dark:text-slate-500">
            Every user — existing (from assigned projects) and newly added — shows up here. Add, rename, or delete accounts.
          </p>
        </div>
        <button
          onClick={() => {
            setRegisterSeed(null);
            setShowAddUser(true);
          }}
          className="flex items-center gap-1.5 px-4 py-2.5 bg-indigo-600 dark:bg-blue-600 hover:bg-indigo-700 hover:dark:bg-blue-500 text-white font-bold rounded-xl text-xs transition shadow-xs cursor-pointer"
        >
          <UserPlus size={14} />
          Add User
        </button>
      </div>

      <div className="overflow-x-auto border border-gray-150 dark:border-slate-800 rounded-2xl bg-white dark:bg-ink-900 max-h-[32rem] overflow-y-auto">
        <table className="w-full text-left border-collapse">
          <thead className="sticky top-0 bg-gray-50/95 dark:bg-ink-900/95 backdrop-blur-sm">
            <tr className="border-b border-gray-150 dark:border-slate-800 text-[9px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest">
              <th className="py-3 px-4">Name</th>
              <th className="py-3 px-4">User ID (Login)</th>
              <th className="py-3 px-4">Role</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-105 dark:divide-slate-800/60">
            {loadingUsers && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-xs text-gray-400 dark:text-slate-500 font-semibold">
                  <Loader2 size={16} className="inline animate-spin mr-2" />
                  Loading users…
                </td>
              </tr>
            )}
            {!loadingUsers && mergedUsers.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-xs text-gray-400 dark:text-slate-500 font-semibold">
                  No users yet. Click "Add User" to create one.
                </td>
              </tr>
            )}
            {mergedUsers.map((u) => (
              <tr key={u.email} className="hover:bg-slate-50/45 hover:dark:bg-ink-800/60 transition text-xs">
                <td className="py-3 px-4 font-extrabold text-gray-900 dark:text-slate-50">{u.name}</td>
                <td className="py-3 px-4 font-mono font-semibold text-gray-500 dark:text-slate-400">{u.email}</td>
                <td className="py-3 px-4">
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide ${
                      u.role === 'admin' ? 'bg-violet-50 text-violet-700' : 'bg-gray-100 dark:bg-ink-800 text-gray-500 dark:text-slate-400'
                    }`}
                  >
                    {u.role || 'user'}
                  </span>
                </td>
                <td className="py-3 px-4">
                  {u.derived ? (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400">
                      Existing (unregistered)
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                      Registered
                    </span>
                  )}
                </td>
                <td className="py-3 px-4">
                  <div className="flex items-center justify-center gap-1.5">
                    {u.derived ? (
                      <button
                        onClick={() => {
                          setRegisterSeed(u);
                          setShowAddUser(true);
                        }}
                        title="Register this user with a passkey"
                        className="px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wide text-indigo-600 dark:text-blue-400 hover:text-white hover:bg-indigo-600 hover:dark:bg-blue-600 border border-indigo-200 dark:border-blue-500/25 rounded-lg transition cursor-pointer"
                      >
                        Register
                      </button>
                    ) : (
                      <button
                        onClick={() => setRenamingUser(u)}
                        title="Rename / change ID / passkey"
                        className="p-2 text-gray-400 dark:text-slate-500 hover:text-indigo-600 hover:dark:text-blue-400 hover:bg-indigo-50 hover:dark:bg-blue-500/10 rounded-lg transition cursor-pointer"
                      >
                        <KeyRound size={14} />
                      </button>
                    )}
                    <button
                      onClick={() => handleDeleteUser(u)}
                      title="Delete user"
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

      {showAddUser && (
        <AddUserModal
          busy={busy}
          initialUserId={registerSeed?.email}
          initialName={registerSeed?.name}
          onClose={() => {
            setShowAddUser(false);
            setRegisterSeed(null);
          }}
          onSubmit={handleAddUser}
        />
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
// MODAL: Add User (also used to "Register" an existing/derived user)
// ===========================================================================
export function AddUserModal({
  busy,
  onClose,
  onSubmit,
  initialUserId,
  initialName,
}: {
  busy: boolean;
  onClose: () => void;
  onSubmit: (userId: string, name: string, passkey: string, role: 'user' | 'admin') => void;
  initialUserId?: string;
  initialName?: string;
}) {
  const [userId, setUserId] = useState(initialUserId || '');
  const [name, setName] = useState(initialName || '');
  const [passkey, setPasskey] = useState('');
  const [role, setRole] = useState<'user' | 'admin'>('user');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId.trim() || !name.trim()) return;
    onSubmit(userId.trim(), name.trim(), passkey.trim(), role);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fade-in text-left">
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="bg-white dark:bg-ink-900 rounded-3xl border border-gray-150 dark:border-slate-800 shadow-lg w-full max-w-sm"
      >
        <div className="flex items-center justify-between p-6 border-b border-gray-100 dark:border-slate-800/60">
          <h3 className="font-extrabold text-gray-900 dark:text-slate-50 text-sm">{initialUserId ? 'Register User' : 'Add User'}</h3>
          <button onClick={onClose} className="p-1.5 text-gray-400 dark:text-slate-500 hover:text-gray-700 hover:dark:text-slate-200 hover:bg-gray-50 hover:dark:bg-ink-800/60 rounded-lg cursor-pointer">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {initialUserId && (
            <p className="text-xs text-gray-400 dark:text-slate-500 -mt-1">
              This user is already assigned to a project. Set a passkey to turn them into a full login account.
            </p>
          )}
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest">User ID (used to log in) *</label>
            <input
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              required
              placeholder="e.g. 7412"
              className="w-full px-4 py-3 bg-gray-50 dark:bg-ink-800/60 border border-gray-200 dark:border-slate-800 focus:border-indigo-650 focus:dark:border-blue-500/50 rounded-xl text-xs font-semibold font-mono focus:outline-none focus:ring-1 focus:ring-indigo-650 focus:dark:ring-blue-500/50 transition"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest">Display Name *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="e.g. Rohit Sharma"
              className="w-full px-4 py-3 bg-gray-50 dark:bg-ink-800/60 border border-gray-200 dark:border-slate-800 focus:border-indigo-650 focus:dark:border-blue-500/50 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-650 focus:dark:ring-blue-500/50 transition"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest">Passkey (optional)</label>
            <input
              value={passkey}
              onChange={(e) => setPasskey(e.target.value)}
              type="text"
              placeholder="e.g. 4821 — leave blank to skip"
              className="w-full px-4 py-3 bg-gray-50 dark:bg-ink-800/60 border border-gray-200 dark:border-slate-800 focus:border-indigo-650 focus:dark:border-blue-500/50 rounded-xl text-xs font-semibold font-mono focus:outline-none focus:ring-1 focus:ring-indigo-650 focus:dark:ring-blue-500/50 transition"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as 'user' | 'admin')}
              className="w-full px-4 py-3 bg-gray-50 dark:bg-ink-800/60 border border-gray-200 dark:border-slate-800 focus:border-indigo-650 focus:dark:border-blue-500/50 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-650 focus:dark:ring-blue-500/50 transition"
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={busy}
            className="w-full px-5 py-3.5 bg-indigo-600 dark:bg-blue-600 hover:bg-indigo-700 hover:dark:bg-blue-500 disabled:opacity-60 text-white font-bold rounded-xl text-xs transition shadow-sm cursor-pointer"
          >
            {busy ? 'Saving…' : initialUserId ? 'Register User' : 'Add User'}
          </button>
        </form>
      </motion.div>
    </div>
  );
}

// ===========================================================================
// MODAL: Rename User / Change ID / Change Passkey
// ===========================================================================
export function RenameUserModal({
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
        className="bg-white dark:bg-ink-900 rounded-3xl border border-gray-150 dark:border-slate-800 shadow-lg w-full max-w-sm"
      >
        <div className="flex items-center justify-between p-6 border-b border-gray-100 dark:border-slate-800/60">
          <h3 className="font-extrabold text-gray-900 dark:text-slate-50 text-sm">Edit "{user.name}"</h3>
          <button onClick={onClose} className="p-1.5 text-gray-400 dark:text-slate-500 hover:text-gray-700 hover:dark:text-slate-200 hover:bg-gray-50 hover:dark:bg-ink-800/60 rounded-lg cursor-pointer">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest">Current User ID</label>
            <div className="px-4 py-3 bg-gray-50 dark:bg-ink-800/60 border border-gray-150 dark:border-slate-800 rounded-xl text-xs font-mono font-bold text-gray-400 dark:text-slate-500">
              {user.email}
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest">New User ID (login)</label>
            <input
              value={newUserId}
              onChange={(e) => setNewUserId(e.target.value)}
              required
              className="w-full px-4 py-3 bg-gray-50 dark:bg-ink-800/60 border border-gray-200 dark:border-slate-800 focus:border-indigo-650 focus:dark:border-blue-500/50 rounded-xl text-xs font-semibold font-mono focus:outline-none focus:ring-1 focus:ring-indigo-650 focus:dark:ring-blue-500/50 transition"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest">New Display Name</label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              required
              className="w-full px-4 py-3 bg-gray-50 dark:bg-ink-800/60 border border-gray-200 dark:border-slate-800 focus:border-indigo-650 focus:dark:border-blue-500/50 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-650 focus:dark:ring-blue-500/50 transition"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest">New Passkey</label>
            <input
              value={newPasskey}
              onChange={(e) => setNewPasskey(e.target.value)}
              placeholder="Leave blank to keep current passkey"
              className="w-full px-4 py-3 bg-gray-50 dark:bg-ink-800/60 border border-gray-200 dark:border-slate-800 focus:border-indigo-650 focus:dark:border-blue-500/50 rounded-xl text-xs font-semibold font-mono focus:outline-none focus:ring-1 focus:ring-indigo-650 focus:dark:ring-blue-500/50 transition"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="w-full px-5 py-3.5 bg-indigo-600 dark:bg-blue-600 hover:bg-indigo-700 hover:dark:bg-blue-500 disabled:opacity-60 text-white font-bold rounded-xl text-xs transition shadow-sm cursor-pointer"
          >
            {busy ? 'Saving…' : 'Save Changes'}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
