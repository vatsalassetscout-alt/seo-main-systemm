/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { Project, CustomSubmissionType, DSREntry, AppUser, ProjectLocation } from '../types';
import { getUserDisplayName, isUserAdmin } from '../lib/userUtils';
import { cleanDomain } from '../lib/domain';
import {
  Plus,
  Trash2,
  Lock,
  Mail,
  ShieldCheck,
  FileSpreadsheet,
  Users,
  Settings2,
  HardDriveUpload,
  RefreshCw,
  PlusCircle,
  HelpCircle,
  Hash,
  Database,
  UserPlus,
  Layers,
  AlertTriangle
} from 'lucide-react';
import { motion } from 'motion/react';
import AdminControlPanel from './AdminControlPanel';
import UserManagementPanel, { AppUserRow } from './UserManagement';

interface DSRSettingsProps {
  projects: Project[];
  adminEmails: string[];
  entries: DSREntry[];
  onAddAdminEmail: (email: string) => void;
  onDeleteAdminEmail: (email: string) => void;
  currentUserEmail: string;

  // Custom Submission Type Callbacks
  customSubmissionTypes: CustomSubmissionType[];
  onAddCustomSubmissionType: (type: CustomSubmissionType) => void;
  onDeleteCustomSubmissionType: (id: string) => void;

  // Google Sheets integration state and callbacks
  sheetSettings: {
    projectsSpreadsheetId?: string;
    logsSpreadsheetId?: string;
    spreadsheetId: string;
    projectsTab: string;
    submissionsTab: string;
    locationsTab?: string;
    isConnected: boolean;
  };
  onUpdateSheetSettings: (settings: {
    projectsSpreadsheetId: string;
    logsSpreadsheetId: string;
    spreadsheetId: string;
    projectsTab: string;
    submissionsTab: string;
    locationsTab: string;
    isConnected: boolean;
  }) => void;
  onTriggerSync: () => Promise<void>;
  isSyncing: boolean;

  // Admin access-control users callbacks
  allowedUsers: AppUser[];
  onSetAllowedUsers: React.Dispatch<React.SetStateAction<AppUser[]>>;
  projectLocations: ProjectLocation[];
  onSetProjectLocations: React.Dispatch<React.SetStateAction<ProjectLocation[]>>;
  onUpdateProjects?: (updatedProjects: Project[]) => void;
  alerts?: any[];
  onAddAlert?: (alert: any) => void;
  onClearMultipleAlerts?: (ids: string[]) => void;
  onResetToDefault?: () => void;
  /** Merged user list (Admin User Control accounts + anyone only known via
   *  project assignment), lifted up to App so the Dashboard's "USER"
   *  column/filter can resolve the same names as this panel. Passed down
   *  from App instead of kept as local state here, so a name change is
   *  visible app-wide immediately. */
  registeredUsers?: AppUserRow[];
  onRegisteredUsersChange?: (users: AppUserRow[]) => void;
}

export default function DSRSettings({
  projects,
  adminEmails,
  entries,
  onAddAdminEmail,
  onDeleteAdminEmail,
  currentUserEmail,

  customSubmissionTypes,
  onAddCustomSubmissionType,
  onDeleteCustomSubmissionType,

  sheetSettings,
  onUpdateSheetSettings,
  onTriggerSync,
  isSyncing,

  allowedUsers,
  onSetAllowedUsers,
  projectLocations,
  onSetProjectLocations,
  onUpdateProjects,
  alerts = [],
  onAddAlert = () => {},
  onClearMultipleAlerts,
  onResetToDefault,
  registeredUsers = [],
  onRegisteredUsersChange = () => {},
}: DSRSettingsProps) {
  // Navigation Tabs inside Settings Panel
  const [activeSubTab, setActiveSubTab] = useState<'users' | 'assignments' | 'database' | 'admin-control'>('users');

  // Single merged user pipeline (registered accounts + users only known via
  // project assignment) — resolved by UserManagementPanel and shared with
  // AdminControlPanel's Reassign dropdown, AND lifted up to App so the
  // Dashboard's "USER" column/filter agrees with it too.
  const resolvedUsers = registeredUsers;
  const setResolvedUsers = onRegisteredUsersChange;

  // Deletion selection states for assignments
  const [isDeleteMode, setIsDeleteMode] = useState(false);
  const [selectedAssignmentIds, setSelectedAssignmentIds] = useState<string[]>([]);

  // Input states
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [selectedUserEmail, setSelectedUserEmail] = useState('');

  const [serviceAccountEmail, setServiceAccountEmail] = useState('');
  const [serviceAccountConfigured, setServiceAccountConfigured] = useState(false);
  const [fetchStatusError, setFetchStatusError] = useState('');
  const [projectsSpreadsheetId, setProjectsSpreadsheetId] = useState('');
  const [logsSpreadsheetId, setLogsSpreadsheetId] = useState('');
  const [isCopied, setIsCopied] = useState(false);

  // Supabase Integration States
  const [supabaseConfigured, setSupabaseConfigured] = useState(false);
  const [databaseStatusError, setDatabaseStatusError] = useState('');

  useEffect(() => {
    fetch('/api/config-status')
      .then(res => {
        if (res.ok) return res.json();
        throw new Error('Failed to load credentials detail');
      })
      .then(data => {
        if (data) {
          if (data.serviceAccountEmail) setServiceAccountEmail(data.serviceAccountEmail);
          setServiceAccountConfigured(data.serviceAccountConfigured);
          setFetchStatusError(data.fetchStatus?.error || '');
          setProjectsSpreadsheetId(data.projectsSpreadsheetId || '');
          setLogsSpreadsheetId(data.logsSpreadsheetId || '');
          setSupabaseConfigured(!!data.supabaseConfigured);
          setDatabaseStatusError(data.databaseStatus?.error || '');
        }
      })
      .catch(err => console.error("Could not fetch service account detail:", err));
  }, []);

  const handleCopyEmail = () => {
    if (!serviceAccountEmail) return;
    navigator.clipboard.writeText(serviceAccountEmail)
      .then(() => {
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
      });
  };



  // Status Alerts
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const triggerAlert = (type: 'success' | 'error', text: string) => {
    setStatusMsg({ type, text });
    setTimeout(() => {
      setStatusMsg(null);
    }, 4000);
  };

  // Human Reporter directory compilation
  const reportersDir = useMemo(() => {
    const map: Record<string, {
      email: string;
      submissionsCount: number;
      listing: number;
      blog: number;
      pdf: number;
      image: number;
      lastActive: string;
    }> = {};

    entries.forEach((entry) => {
      if (!entry || !entry.userEmail) return;
      const email = entry.userEmail.trim().toLowerCase();
      if (!map[email]) {
        map[email] = {
          email: entry.userEmail,
          submissionsCount: 0,
          listing: 0,
          blog: 0,
          pdf: 0,
          image: 0,
          lastActive: entry.date,
        };
      }

      const userRecord = map[email];
      userRecord.submissionsCount += 1;
      
      if (new Date(entry.date) > new Date(userRecord.lastActive)) {
        userRecord.lastActive = entry.date;
      }

      (entry.works || []).forEach((work) => {
        userRecord.listing += (work.listingCount || 0);
        userRecord.blog += (work.blogCount || 0);
        userRecord.pdf += (work.pdfCount || 0);
        userRecord.image += (work.imageCount || 0);
      });
    });

    return Object.values(map).sort((a, b) => b.submissionsCount - a.submissionsCount);
  }, [entries]);

  // Admin addition
  const handleAddAdminEmail = (e: React.FormEvent) => {
    e.preventDefault();
    const email = newAdminEmail.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) return;
    
    if (adminEmails.includes(email)) {
      alert('Email specified is already in the administrator registry!');
      return;
    }

    onAddAdminEmail(email);
    setNewAdminEmail('');
    triggerAlert('success', 'Authorized admin email added to secure list.');
  };

  return (
    <div className="space-y-8 animate-fade-in">
      
      {/* Internal Setup Tabs */}
      <div className="flex flex-wrap items-center justify-between border-b border-gray-150 dark:border-slate-800 gap-4 pb-px">
        <div className="flex gap-2 overflow-x-auto">
          <button
            onClick={() => setActiveSubTab('users')}
            className={`flex items-center gap-2 px-5 py-3 border-b-2 font-bold text-xs cursor-pointer transition ${
              activeSubTab === 'users'
                ? 'border-indigo-600 dark:border-blue-500/50 text-indigo-700 dark:text-blue-400'
                : 'border-transparent text-gray-400 dark:text-slate-500 hover:text-gray-700 hover:dark:text-slate-200 hover:border-gray-200 hover:dark:border-slate-800'
            }`}
          >
            <Users size={15} />
            Users
          </button>

          <button
            onClick={() => setActiveSubTab('admin-control')}
            className={`flex items-center gap-2 px-5 py-3 border-b-2 font-bold text-xs cursor-pointer transition ${
              activeSubTab === 'admin-control'
                ? 'border-indigo-600 dark:border-blue-500/50 text-indigo-700 dark:text-blue-400'
                : 'border-transparent text-gray-400 dark:text-slate-500 hover:text-gray-700 hover:dark:text-slate-200 hover:border-gray-200 hover:dark:border-slate-800'
            }`}
          >
            <UserPlus size={15} />
            Projects Control
          </button>

          <button
            onClick={() => setActiveSubTab('assignments')}
            className={`flex items-center gap-2 px-5 py-3 border-b-2 font-bold text-xs cursor-pointer transition ${
              activeSubTab === 'assignments'
                ? 'border-indigo-600 dark:border-blue-500/50 text-indigo-700 dark:text-blue-400'
                : 'border-transparent text-gray-400 dark:text-slate-500 hover:text-gray-700 hover:dark:text-slate-200 hover:border-gray-200 hover:dark:border-slate-800'
            }`}
          >
            <Lock size={15} />
            Assign Project
          </button>

          <button
            onClick={() => setActiveSubTab('database')}
            className={`flex items-center gap-2 px-5 py-3 border-b-2 font-bold text-xs cursor-pointer transition ${
              activeSubTab === 'database'
                ? 'border-indigo-600 dark:border-blue-500/50 text-indigo-700 dark:text-blue-400'
                : 'border-transparent text-gray-400 dark:text-slate-500 hover:text-gray-700 hover:dark:text-slate-200 hover:border-gray-200 hover:dark:border-slate-800'
            }`}
          >
            <Database size={15} />
            Database Setup
          </button>
        </div>

        {onResetToDefault && (
          <button
            onClick={onResetToDefault}
            className="flex items-center gap-1.5 px-4 py-2 text-[10px] font-black uppercase tracking-wider text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 hover:bg-rose-100 border border-rose-200 dark:border-rose-500/25 hover:border-rose-300 rounded-xl transition cursor-pointer self-center"
          >
            <Database size={13} className="shrink-0" />
            Reset Workspace & Clear All Data
          </button>
        )}
      </div>

      {/* Sub-Alert status notifications */}
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

      {/* Active settings module view */}
      <div className="bg-white dark:bg-ink-900 p-6 sm:p-8 rounded-3xl border border-gray-150 dark:border-slate-800 shadow-xs">
        {/* TAB 1: Users Panel — single pipeline: existing (project-assigned) +
             newly added users, full add/rename/delete control lives here.
             Kept mounted (just hidden) even off-tab so the merged user list
             is always ready for the Reassign dropdown in Admin Control. */}
        <div className={activeSubTab === 'users' ? '' : 'hidden'}>
          <UserManagementPanel
            allowedUsers={allowedUsers}
            adminEmails={adminEmails}
            currentUserEmail={currentUserEmail}
            onUpdateProjects={onUpdateProjects}
            onUsersResolved={setResolvedUsers}
          />
        </div>





        {/* TAB: Admin Control (Project CRUD + reassignment). User accounts
             are managed in the Users tab; this panel shares that same
             merged user pipeline for the Reassign dropdown. */}
        {activeSubTab === 'admin-control' && (
          <AdminControlPanel
            projects={projects}
            currentUserEmail={currentUserEmail}
            onUpdateProjects={(updated) => onUpdateProjects && onUpdateProjects(updated)}
            users={resolvedUsers}
          />
        )}

        {/* TAB 4: Assign Projects Panel */}
        {activeSubTab === 'assignments' && (
          <div className="space-y-8 animate-fade-in text-left">
            <div className="border-b border-gray-100 dark:border-slate-800/60 pb-4">
              <h4 className="font-extrabold text-gray-900 dark:text-slate-50 text-sm flex items-center gap-2">
                <Lock size={16} className="text-indigo-600 dark:text-blue-400" />
                Assign Work
              </h4>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {/* Form: Assign Project */}
              <div className="md:col-span-1 bg-slate-50/50 dark:bg-ink-800/40 p-6 rounded-2xl border border-gray-150 dark:border-slate-800 h-fit space-y-4">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const form = e.currentTarget;
                    const formData = new FormData(form);
                    const email = formData.get('userEmail') as string;
                    const projectId = formData.get('projectId') as string;
                    const date = formData.get('date') as string;
                    const customMsg = formData.get('message') as string;

                    if (!email || !projectId || !date) {
                      triggerAlert('error', 'Please fill in all layout fields to continue.');
                      return;
                    }

                    const matchedProj = projects.find(p => p.id === projectId);
                    const payload = {
                      id: `assign-${Date.now()}`,
                      alertType: 'project_assignment',
                      userEmail: email.trim().toLowerCase(),
                      projectId: projectId,
                      projectDomain: cleanDomain(matchedProj?.domain) || matchedProj?.name || '',
                      projectName: matchedProj?.name || '',
                      date: date,
                      message: customMsg || `Admin has requested that you submit a Work Log for ${matchedProj?.name || 'domain'} for the reporting date of ${date}.`,
                      adminEmail: currentUserEmail,
                      createdAt: new Date().toISOString(),
                      read: false
                    };

                    onAddAlert(payload);
                    triggerAlert('success', `Direct task request dispatched for ${getUserDisplayName(email, allowedUsers)} on date ${date}!`);
                    form.reset();
                    setSelectedUserEmail('');
                  }}
                  className="space-y-4"
                >
                  <div className="space-y-1.5">
                    <select
                      name="userEmail"
                      required
                      value={selectedUserEmail}
                      onChange={(e) => setSelectedUserEmail(e.target.value)}
                      className="w-full px-3 py-2 bg-white dark:bg-ink-900 border border-gray-200 dark:border-slate-800 rounded text-xs focus:ring-1 focus:ring-indigo-500 focus:dark:ring-blue-500/50 text-gray-900 dark:text-slate-50 focus:outline-none"
                    >
                      <option value="">- Select User -</option>
                      {(() => {
                        const filtered = allowedUsers.filter(u => u.email && !isUserAdmin(u.email, adminEmails));
                        const uniqueMap = new Map<string, typeof filtered[0]>();
                        filtered.forEach(u => {
                          const displayName = getUserDisplayName(u.email, allowedUsers);
                          if (displayName && displayName !== 'Admin') {
                            uniqueMap.set(displayName.toLowerCase().trim(), u);
                          }
                        });
                        return Array.from(uniqueMap.values()).map(u => (
                          <option key={u.email} value={u.email}>
                            {getUserDisplayName(u.email, allowedUsers)}
                          </option>
                        ));
                      })()}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <select
                      name="projectId"
                      required
                      className="w-full px-3 py-2 bg-white dark:bg-ink-900 border border-gray-200 dark:border-slate-800 rounded text-xs focus:ring-1 focus:ring-indigo-500 focus:dark:ring-blue-500/50 text-gray-900 dark:text-slate-50 focus:outline-none"
                    >
                      <option value="">- Select Active Project -</option>
                      {(() => {
                        const filtered = selectedUserEmail
                          ? projects.filter((p) => {
                              const assigned = Array.isArray(p.users) ? p.users : [];
                              const matchesUsers = assigned.some((u: string) => u.trim().toLowerCase() === selectedUserEmail.trim().toLowerCase());
                              const matchesUserId = p.userId && String(p.userId).trim().toLowerCase() === selectedUserEmail.trim().toLowerCase();
                              return matchesUsers || matchesUserId;
                            })
                          : projects;
                        return filtered.map(p => (
                          <option key={p.id} value={p.id}>{cleanDomain(p.domain) || p.name}</option>
                        ));
                      })()}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <input
                      type="date"
                      name="date"
                      required
                      defaultValue={new Date().toISOString().split('T')[0]}
                      className="w-full px-3 py-2 bg-white dark:bg-ink-900 border border-gray-200 dark:border-slate-800 rounded text-xs focus:ring-1 focus:ring-indigo-500 focus:dark:ring-blue-500/50 text-gray-900 dark:text-slate-50 font-mono focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] text-gray-500 dark:text-slate-400 font-bold block uppercase">Custom Notes</label>
                    <textarea
                      name="message"
                      rows={3}
                      placeholder="e.g. Please check SEO backlinks and indexation status"
                      className="w-full px-3 py-2 bg-white dark:bg-ink-900 border border-gray-200 dark:border-slate-800 rounded text-xs focus:ring-1 focus:ring-indigo-500 focus:dark:ring-blue-500/50 text-gray-900 dark:text-slate-50 focus:outline-none"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full py-2.5 bg-indigo-600 dark:bg-blue-600 hover:bg-indigo-700 hover:dark:bg-blue-500 text-white rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
                  >
                    Send Assignment Task
                  </button>
                </form>
              </div>

              {/* Assignments History & Status Tracker Table */}
              <div className="md:col-span-2 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <h5 className="font-bold text-gray-800 dark:text-slate-100 text-xs uppercase tracking-wide flex items-center gap-1.5">
                    🛡️ Active Task Assignments Board
                  </h5>
                  
                  {/* Delete Task Toggle / Controls */}
                  <div className="flex items-center gap-2">
                    {isDeleteMode ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            const allAssignmentIds = (alerts || [])
                              .filter(a => a.alertType === 'project_assignment')
                              .map(a => a.id);
                            if (selectedAssignmentIds.length === allAssignmentIds.length) {
                              setSelectedAssignmentIds([]);
                            } else {
                              setSelectedAssignmentIds(allAssignmentIds);
                            }
                          }}
                          className="px-2.5 py-1 text-[10px] font-bold text-indigo-600 dark:text-blue-400 bg-indigo-50 dark:bg-blue-500/10 hover:bg-indigo-100 hover:dark:bg-blue-500/15 rounded-lg transition cursor-pointer"
                        >
                          {selectedAssignmentIds.length === (alerts || []).filter(a => a.alertType === 'project_assignment').length
                            ? 'Deselect All'
                            : 'Select All'}
                        </button>
                        
                        <button
                          type="button"
                          disabled={selectedAssignmentIds.length === 0}
                          onClick={() => {
                            if (window.confirm(`Are you sure you want to delete ${selectedAssignmentIds.length} selected task assignment(s)?`)) {
                              if (onClearMultipleAlerts) {
                                onClearMultipleAlerts(selectedAssignmentIds);
                              }
                              setSelectedAssignmentIds([]);
                              setIsDeleteMode(false);
                            }
                          }}
                          className={`px-3 py-1 text-[10px] font-bold text-white rounded-lg transition flex items-center gap-1 shadow-2xs cursor-pointer ${
                            selectedAssignmentIds.length === 0
                              ? 'bg-gray-300 cursor-not-allowed'
                              : 'bg-rose-600 hover:bg-rose-700'
                          }`}
                        >
                          <Trash2 size={11} />
                          Delete ({selectedAssignmentIds.length})
                        </button>
                        
                        <button
                          type="button"
                          onClick={() => {
                            setIsDeleteMode(false);
                            setSelectedAssignmentIds([]);
                          }}
                          className="px-2.5 py-1 text-[10px] font-bold text-gray-500 dark:text-slate-400 bg-gray-100 dark:bg-ink-800 hover:bg-gray-200 hover:dark:bg-ink-700 rounded-lg transition cursor-pointer"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      (alerts || []).some(a => a.alertType === 'project_assignment') && (
                        <button
                          type="button"
                          onClick={() => {
                            setIsDeleteMode(true);
                            setSelectedAssignmentIds([]);
                          }}
                          className="px-3 py-1.5 text-[10px] font-bold text-indigo-700 dark:text-blue-400 bg-indigo-50 dark:bg-blue-500/10 hover:bg-indigo-100 hover:dark:bg-blue-500/15 rounded-lg transition flex items-center gap-1 cursor-pointer"
                        >
                          <Trash2 size={12} />
                          Delete Active Assignments
                        </button>
                      )
                    )}
                  </div>
                </div>

                <div className="bg-white dark:bg-ink-900 border border-gray-150 dark:border-slate-800 rounded-2xl overflow-hidden shadow-2xs">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-gray-50/70 border-b border-gray-150 dark:border-slate-800 font-bold text-gray-500 dark:text-slate-400 text-[10px] uppercase">
                        <tr>
                          {isDeleteMode && <th className="px-4 py-3 w-10 text-center">Select</th>}
                          <th className="px-4 py-3">Reporter</th>
                          <th className="px-4 py-3">Project</th>
                          <th className="px-4 py-3">Date</th>
                          <th className="px-4 py-3">Logged?</th>
                          <th className="px-4 py-3 text-center">Status</th>
                          <th className="px-4 py-3 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-slate-800/60">
                        {(() => {
                          const assignmentAlertsList = (alerts || []).filter(a => a.alertType === 'project_assignment');
                          if (assignmentAlertsList.length === 0) {
                            return (
                              <tr>
                                <td colSpan={isDeleteMode ? 7 : 6} className="px-4 py-8 text-center text-gray-400 dark:text-slate-500 italic">
                                  No direct assignments have been registered yet.
                                </td>
                              </tr>
                            );
                          }

                          return assignmentAlertsList.map((asg) => {
                            // Check if logged matching user email, target date and project id
                            const isFulfilled = (entries || []).some(entry => {
                              const matchesUser = (entry.userEmail || '').trim().toLowerCase() === (asg.userEmail || '').trim().toLowerCase();
                              const matchesDate = entry.date === asg.date;
                              const hasProj = (entry.works || []).some(w => String(w.projectId) === String(asg.projectId));
                              return matchesUser && matchesDate && hasProj;
                            });

                            const isSelected = selectedAssignmentIds.includes(asg.id);

                            return (
                              <tr 
                                key={asg.id} 
                                onClick={() => {
                                  if (isDeleteMode) {
                                    if (isSelected) {
                                      setSelectedAssignmentIds(prev => prev.filter(id => id !== asg.id));
                                    } else {
                                      setSelectedAssignmentIds(prev => [...prev, asg.id]);
                                    }
                                  }
                                }}
                                className={`hover:bg-slate-50/40 hover:dark:bg-ink-800/35 transition-colors ${isSelected ? 'bg-indigo-50/15' : ''} ${isDeleteMode ? 'cursor-pointer select-none' : ''}`}
                              >
                                {isDeleteMode && (
                                  <td className="px-4 py-3.5 text-center">
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      readOnly
                                      className="h-4 w-4 rounded border-gray-300 dark:border-slate-700 text-indigo-600 dark:text-blue-400 focus:ring-indigo-500 focus:dark:ring-blue-500/50 cursor-pointer"
                                    />
                                  </td>
                                )}
                                <td className="px-4 py-3.5">
                                  <div className="font-bold text-gray-900 dark:text-slate-50">{getUserDisplayName(asg.userEmail, allowedUsers)}</div>
                                  <div className="text-[10px] text-gray-400 dark:text-slate-500 font-mono">{asg.userEmail}</div>
                                </td>
                                <td className="px-4 py-3.5">
                                  <div className="font-bold text-gray-800 dark:text-slate-100">{asg.projectName || 'Project'}</div>
                                </td>
                                <td className="px-4 py-3.5 font-mono text-gray-600 dark:text-slate-300 font-semibold">
                                  {asg.date}
                                </td>
                                <td className="px-4 py-3.5">
                                  {isFulfilled ? (
                                    <span className="inline-flex items-center gap-1 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold px-2 py-0.5 rounded border border-emerald-100 dark:border-emerald-500/20">
                                      🟢 Yes, Filled
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[10px] font-bold px-2 py-0.5 rounded border border-amber-100 dark:border-amber-500/20">
                                      🚨 Pending
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-3.5 text-center">
                                  {isFulfilled ? (
                                    <span className="text-[10px] font-black text-emerald-600 dark:text-emerald-400 tracking-wider">COMPLETED</span>
                                  ) : (
                                    <span className="text-[10px] font-black text-amber-600 dark:text-amber-400 animate-pulse tracking-wider">ACTIVE BANNER</span>
                                  )}
                                </td>
                                <td className="px-4 py-3.5 text-right">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (window.confirm("Are you sure you want to delete this assignment task?")) {
                                        if (onClearMultipleAlerts) {
                                          onClearMultipleAlerts([asg.id]);
                                        }
                                      }
                                    }}
                                    className="p-1.5 text-gray-400 dark:text-slate-500 hover:text-rose-600 hover:dark:text-rose-400 rounded-lg hover:bg-rose-50 hover:dark:bg-rose-500/10 transition cursor-pointer inline-flex items-center"
                                    title="Delete Assignment"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </td>
                              </tr>
                            );
                          });
                        })()}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeSubTab === 'database' && (
          <div className="bg-white dark:bg-ink-900 rounded-2xl shadow-xs border border-gray-150 dark:border-slate-800 p-6 space-y-6">
            <div className="flex items-center gap-2 pb-4 border-b border-gray-100 dark:border-slate-800/60">
              <Database className="text-indigo-600 dark:text-blue-400" size={20} />
              <div>
                <h3 className="text-sm font-extrabold text-gray-900 dark:text-slate-50 uppercase tracking-wide">
                  Database Status
                </h3>
              </div>
            </div>

            {/* Connection Status Box — simple Connected / Not Connected indicator only */}
            <div className={`p-5 rounded-xl flex items-center gap-3 border ${
              supabaseConfigured
                ? 'bg-emerald-50/50 border-emerald-100 dark:border-emerald-500/20 text-emerald-900'
                : 'bg-rose-50/50 border-rose-100 text-rose-900'
            }`}>
              <span className="text-lg">
                {supabaseConfigured ? '🟢' : '🔴'}
              </span>
              <div className="text-xs font-extrabold uppercase tracking-wider">
                {supabaseConfigured ? 'Connected' : 'Not Connected'}
              </div>
            </div>
          </div>
        )}


      </div>
    </div>
  );
}
