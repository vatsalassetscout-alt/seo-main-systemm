/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { Project, CustomSubmissionType, DSREntry, AppUser, ProjectLocation } from '../types';
import { getUserDisplayName, isUserAdmin } from '../lib/userUtils';
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
  Check,
  Copy,
  AlertTriangle,
  ExternalLink
} from 'lucide-react';
import { motion } from 'motion/react';

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
}: DSRSettingsProps) {
  // Navigation Tabs inside Settings Panel
  const [activeSubTab, setActiveSubTab] = useState<'users' | 'assignments' | 'database'>('users');

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
  const [supabaseSchemaSql, setSupabaseSchemaSql] = useState('');
  const [isSqlCopied, setIsSqlCopied] = useState(false);
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
          setSupabaseSchemaSql(data.supabaseSchemaSql || '');
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
      <div className="flex flex-wrap items-center justify-between border-b border-gray-150 gap-4 pb-px">
        <div className="flex gap-2 overflow-x-auto">
          <button
            onClick={() => setActiveSubTab('users')}
            className={`flex items-center gap-2 px-5 py-3 border-b-2 font-bold text-xs cursor-pointer transition ${
              activeSubTab === 'users'
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-gray-400 hover:text-gray-700 hover:border-gray-200'
            }`}
          >
            <Users size={15} />
            Users
          </button>

          <button
            onClick={() => setActiveSubTab('assignments')}
            className={`flex items-center gap-2 px-5 py-3 border-b-2 font-bold text-xs cursor-pointer transition ${
              activeSubTab === 'assignments'
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-gray-400 hover:text-gray-700 hover:border-gray-200'
            }`}
          >
            <Lock size={15} />
            Assign Project
          </button>

          <button
            onClick={() => setActiveSubTab('database')}
            className={`flex items-center gap-2 px-5 py-3 border-b-2 font-bold text-xs cursor-pointer transition ${
              activeSubTab === 'database'
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-gray-400 hover:text-gray-700 hover:border-gray-200'
            }`}
          >
            <Database size={15} />
            Database Setup
          </button>
        </div>

        {onResetToDefault && (
          <button
            onClick={onResetToDefault}
            className="flex items-center gap-1.5 px-4 py-2 text-[10px] font-black uppercase tracking-wider text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 hover:border-rose-300 rounded-xl transition cursor-pointer self-center"
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
              ? 'bg-emerald-55 text-emerald-900 border border-emerald-100'
              : 'bg-rose-50 text-rose-900 border border-rose-100'
          }`}
        >
          <span>{statusMsg.type === 'success' ? '🟢' : '🔴'}</span>
          <span>{statusMsg.text}</span>
        </motion.div>
      )}

      {/* Active settings module view */}
      <div className="bg-white p-6 sm:p-8 rounded-3xl border border-gray-150 shadow-xs">
        {/* TAB 1: Users Panel (Email authorization & Location assignment) */}
        {activeSubTab === 'users' && (
          <div className="space-y-12 animate-fade-in text-left">
            
            {/* Section 1: User Identity & Registration */}
            <div className="space-y-6">
              <div className="border-b border-gray-100 pb-4">
                <h4 className="font-extrabold text-gray-900 text-sm flex items-center gap-2">
                  <Users size={16} className="text-indigo-600 animate-pulse" />
                  User Directory & User IDs
                </h4>
                <p className="text-xs text-gray-400">
                  Assign human names to User IDs. Authorized users will gain Work Log access. All reports in the system will display these names.
                </p>
              </div>

              <div className="space-y-4">
                
                {/* Table: Registered Users */}
                <div className="space-y-4">
                  <div className="flex flex-col gap-1">
                    {(() => {
                      const activeUsers = allowedUsers.filter(u => !isUserAdmin(u.email, adminEmails));
                      return (
                        <>
                          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest pl-0.5">Logged-In System Users ({activeUsers.length})</span>
                        </>
                      );
                    })()}
                  </div>
                  
                  <div className="overflow-x-auto border border-gray-150 rounded-2xl bg-white max-h-96 overflow-y-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-gray-150 bg-gray-50/70 text-[9px] font-bold text-gray-400 uppercase tracking-widest">
                          <th className="py-3 px-4 text-left">User Name</th>
                          <th className="py-3 px-4 text-left">User ID</th>
                          <th className="py-3 px-4 text-center">Last Logged In</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-105">
                        {(() => {
                          const activeUsers = allowedUsers.filter(u => !isUserAdmin(u.email, adminEmails));
                          // Deduplicate by name to prevent repeated names
                          const uniqueMap = new Map<string, typeof activeUsers[0]>();
                          activeUsers.forEach(u => {
                            const name = getUserDisplayName(u.email, allowedUsers);
                            if (name && name !== 'Admin') {
                              uniqueMap.set(name.toLowerCase().trim(), u);
                            }
                          });

                          return Array.from(uniqueMap.values()).map((u) => {
                            return (
                              <tr key={u.email} className="hover:bg-slate-50/45 transition text-xs">
                                <td className="py-2 px-4 font-extrabold text-gray-900">
                                  <span className="font-extrabold text-gray-900 px-2 py-1.5 inline-block">
                                    {getUserDisplayName(u.email, allowedUsers)}
                                  </span>
                                </td>
                                <td className="py-3.5 px-4 font-mono font-semibold text-gray-500">{u.email}</td>
                                <td className="py-3.5 px-4 text-center font-mono text-xs font-semibold text-gray-500">{u.lastLoggedIn || 'Never'}</td>
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





        {/* TAB 4: Assign Projects Panel */}
        {activeSubTab === 'assignments' && (
          <div className="space-y-8 animate-fade-in text-left">
            <div className="border-b border-gray-100 pb-4">
              <h4 className="font-extrabold text-gray-900 text-sm flex items-center gap-2">
                <Lock size={16} className="text-indigo-600" />
                Assign Work
              </h4>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {/* Form: Assign Project */}
              <div className="md:col-span-1 bg-slate-50/50 p-6 rounded-2xl border border-gray-150 h-fit space-y-4">
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
                      projectDomain: matchedProj?.domain || matchedProj?.name || '',
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
                      className="w-full px-3 py-2 bg-white border border-gray-200 rounded text-xs focus:ring-1 focus:ring-indigo-500 text-gray-900 focus:outline-none"
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
                      className="w-full px-3 py-2 bg-white border border-gray-200 rounded text-xs focus:ring-1 focus:ring-indigo-500 text-gray-900 focus:outline-none"
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
                          <option key={p.id} value={p.id}>{p.name}</option>
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
                      className="w-full px-3 py-2 bg-white border border-gray-200 rounded text-xs focus:ring-1 focus:ring-indigo-500 text-gray-900 font-mono focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] text-gray-500 font-bold block uppercase">Custom Notes</label>
                    <textarea
                      name="message"
                      rows={3}
                      placeholder="e.g. Please check SEO backlinks and indexation status"
                      className="w-full px-3 py-2 bg-white border border-gray-200 rounded text-xs focus:ring-1 focus:ring-indigo-500 text-gray-900 focus:outline-none"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
                  >
                    Send Assignment Task
                  </button>
                </form>
              </div>

              {/* Assignments History & Status Tracker Table */}
              <div className="md:col-span-2 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <h5 className="font-bold text-gray-800 text-xs uppercase tracking-wide flex items-center gap-1.5">
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
                          className="px-2.5 py-1 text-[10px] font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition cursor-pointer"
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
                          className="px-2.5 py-1 text-[10px] font-bold text-gray-500 bg-gray-100 hover:bg-gray-200 rounded-lg transition cursor-pointer"
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
                          className="px-3 py-1.5 text-[10px] font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition flex items-center gap-1 cursor-pointer"
                        >
                          <Trash2 size={12} />
                          Delete Active Assignments
                        </button>
                      )
                    )}
                  </div>
                </div>

                <div className="bg-white border border-gray-150 rounded-2xl overflow-hidden shadow-2xs">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-gray-50/70 border-b border-gray-150 font-bold text-gray-500 text-[10px] uppercase">
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
                      <tbody className="divide-y divide-gray-100">
                        {(() => {
                          const assignmentAlertsList = (alerts || []).filter(a => a.alertType === 'project_assignment');
                          if (assignmentAlertsList.length === 0) {
                            return (
                              <tr>
                                <td colSpan={isDeleteMode ? 7 : 6} className="px-4 py-8 text-center text-gray-400 italic">
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
                                className={`hover:bg-slate-50/40 transition-colors ${isSelected ? 'bg-indigo-50/15' : ''} ${isDeleteMode ? 'cursor-pointer select-none' : ''}`}
                              >
                                {isDeleteMode && (
                                  <td className="px-4 py-3.5 text-center">
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      readOnly
                                      className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                    />
                                  </td>
                                )}
                                <td className="px-4 py-3.5">
                                  <div className="font-bold text-gray-900">{getUserDisplayName(asg.userEmail, allowedUsers)}</div>
                                  <div className="text-[10px] text-gray-400 font-mono">{asg.userEmail}</div>
                                </td>
                                <td className="px-4 py-3.5">
                                  <div className="font-bold text-gray-800">{asg.projectName || 'Project'}</div>
                                </td>
                                <td className="px-4 py-3.5 font-mono text-gray-600 font-semibold">
                                  {asg.date}
                                </td>
                                <td className="px-4 py-3.5">
                                  {isFulfilled ? (
                                    <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 text-[10px] font-bold px-2 py-0.5 rounded border border-emerald-100">
                                      🟢 Yes, Filled
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 text-[10px] font-bold px-2 py-0.5 rounded border border-amber-100">
                                      🚨 Pending
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-3.5 text-center">
                                  {isFulfilled ? (
                                    <span className="text-[10px] font-black text-emerald-600 tracking-wider">COMPLETED</span>
                                  ) : (
                                    <span className="text-[10px] font-black text-amber-600 animate-pulse tracking-wider">ACTIVE BANNER</span>
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
                                    className="p-1.5 text-gray-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition cursor-pointer inline-flex items-center"
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
          <div className="bg-white rounded-2xl shadow-xs border border-gray-150 p-6 space-y-6">
            <div className="flex items-center gap-2 pb-4 border-b border-gray-100">
              <Database className="text-indigo-600" size={20} />
              <div>
                <h3 className="text-sm font-extrabold text-gray-900 uppercase tracking-wide">
                  Supabase Database Status & Schema
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  View connection status and SQL schemas required to bootstrap persistent database tables.
                </p>
              </div>
            </div>

            {/* Connection Status Box */}
            <div className={`p-4 rounded-xl flex items-start gap-3 border ${
              !supabaseConfigured
                ? 'bg-amber-50/50 border-amber-100 text-amber-900'
                : databaseStatusError && databaseStatusError.includes('Missing table(s)')
                ? 'bg-rose-50/50 border-rose-100 text-rose-900'
                : 'bg-emerald-50/50 border-emerald-100 text-emerald-900'
            }`}>
              <span className="text-lg">
                {!supabaseConfigured 
                  ? '⚠️' 
                  : databaseStatusError && databaseStatusError.includes('Missing table(s)')
                  ? '❌' 
                  : '🟢'}
              </span>
              <div className="space-y-1">
                <div className="text-xs font-bold uppercase tracking-wider">
                  {!supabaseConfigured 
                    ? 'Local Fallback Mode Active' 
                    : databaseStatusError && databaseStatusError.includes('Missing table(s)')
                    ? 'Tables Missing in Supabase' 
                    : 'Active & Fully Connected'}
                </div>
                <p className="text-xs text-gray-500 font-medium leading-relaxed">
                  {!supabaseConfigured 
                    ? `SUPABASE_URL and SUPABASE_KEY are not specified in your secret environment variables. The system has fallen back to offline JSON files for local-only execution.`
                    : databaseStatusError && databaseStatusError.includes('Missing table(s)')
                    ? `Connected to Supabase client, but the tables have not been created yet in your database: ${databaseStatusError}. Please use the SQL schema script below to bootstrap them.`
                    : `Successfully connected to your custom Supabase instance and verified all database tables. All team logs, projects, allocations, rankings, and notes are synchronized in real-time.`}
                </p>
              </div>
            </div>

            {/* SQL Table Schema Copy box */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-extrabold text-gray-700 uppercase tracking-wider">
                  Recommended SQL Table Initialization Schema
                </div>
                <button
                  onClick={() => {
                    if (!supabaseSchemaSql) return;
                    navigator.clipboard.writeText(supabaseSchemaSql)
                      .then(() => {
                        setIsSqlCopied(true);
                        setTimeout(() => setIsSqlCopied(false), 2000);
                      });
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wider text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg hover:bg-indigo-100 transition cursor-pointer inline-flex items-center"
                >
                  {isSqlCopied ? <Check size={11} className="mr-1" /> : <Copy size={11} className="mr-1" />}
                  {isSqlCopied ? 'Copied' : 'Copy SQL Schema'}
                </button>
              </div>
              <p className="text-xs text-gray-400 leading-relaxed">
                Copy and run this SQL script in your Supabase SQL Editor to instantly bootstrap all database tables, columns, indexes, and performance constraints.
              </p>
              
              <div className="relative rounded-xl overflow-hidden border border-gray-150 bg-slate-900 p-4">
                <pre className="text-[10px] text-indigo-200 font-mono overflow-x-auto max-h-72 leading-relaxed whitespace-pre-wrap select-all scrollbar-thin">
                  {supabaseSchemaSql || 'Loading SQL schema...'}
                </pre>
              </div>
            </div>

            {/* Setup Instructions list */}
            <div className="bg-slate-50 rounded-xl p-5 border border-gray-150 space-y-4">
              <div className="text-xs font-bold text-gray-800 uppercase tracking-wide">
                How to set up Supabase Persistence:
              </div>
              <ol className="list-decimal list-inside space-y-2.5 text-xs text-gray-500 leading-relaxed">
                <li>Create a free account or project on <a href="https://supabase.com" target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline inline-flex items-center gap-0.5 font-bold">Supabase <ExternalLink size={11} /></a>.</li>
                <li>Go to <strong>Project Settings</strong> &gt; <strong>API</strong> and find your Project URL and anon/public Key.</li>
                <li>Add these keys to your AI Studio secrets / environment variables as:
                  <div className="mt-1.5 font-mono text-[10px] bg-slate-100 p-1.5 px-2 rounded-lg text-slate-700 block whitespace-pre-wrap">
                    SUPABASE_URL=your_project_url<br/>
                    SUPABASE_KEY=your_anon_public_key
                  </div>
                </li>
                <li>Go to the <strong>SQL Editor</strong> tab in your Supabase Dashboard, click <strong>New Query</strong>, paste the copied SQL schema above, and click <strong>Run</strong>.</li>
                <li>Your secure multi-user persistent SEO operations database is ready!</li>
              </ol>
            </div>
          </div>
        )}


      </div>
    </div>
  );
}
