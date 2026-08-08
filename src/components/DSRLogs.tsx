/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { DSREntry, Project, ProjectWork, CustomSubmissionType, AppUser } from '../types';
import { getUserDisplayName, isUserAdmin, doesUserMatch } from '../lib/userUtils';
import {
  Search,
  Calendar,
  Layers,
  FileCheck2,
  Image,
  Tag,
  Clock,
  Trash2,
  Compass,
  Download,
  Flame,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  X,
  User,
  Users,
  Activity,
  RefreshCw,
  ShieldCheck
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Display labels for content update checklist values saved from the DSR form
const CONTENT_UPDATE_LABELS: Record<string, string> = {
  meta_title_desc: 'Meta Title & Description',
  keyword_update: 'Keyword Update',
  section_update: 'Section Update',
  restructure: 'Restructure',
};

interface DSRLogsProps {
  entries: DSREntry[];
  projects: Project[];
  onDeleteEntry?: (id: string) => void;
  onUpdateStatus?: (id: string, status: 'Pending' | 'Approved' | 'Needs Revision' | 'Remark') => void;
  onSendRemark?: (item: any, message: string) => void;
  isAdmin: boolean;
  customSubmissionTypes?: CustomSubmissionType[];
  allowedUsers?: AppUser[];
  currentUserEmail?: string | null;
  onFilteredCountChange?: (count: number) => void;
  focusUniqueId?: string | null;
  onFocusHandled?: () => void;
}

export default function DSRLogs({
  entries,
  projects,
  onDeleteEntry,
  onUpdateStatus,
  onSendRemark,
  isAdmin,
  customSubmissionTypes = [],
  allowedUsers = [],
  currentUserEmail = null,
  onFilteredCountChange,
  focusUniqueId = null,
  onFocusHandled,
}: DSRLogsProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('all');
  const [dateFilterType, setDateFilterType] = useState<'all' | 'today' | 'yesterday_today' | 'yesterday' | 'last_7_days' | 'custom'>('all');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [expandedEntries, setExpandedEntries] = useState<Record<string, boolean>>({});
  const [remarkModalItem, setRemarkModalItem] = useState<any | null>(null);
  const [remarkText, setRemarkText] = useState('');

  // Delete Log modal — instead of nuking every entry for the day in one shot,
  // admin gets a checklist of each individual submission for that date, all
  // pre-checked, and can uncheck the ones they want to KEEP before confirming.
  const [deleteModalItem, setDeleteModalItem] = useState<any | null>(null);
  const [deleteSelectedIds, setDeleteSelectedIds] = useState<Record<string, boolean>>({});
  const logItemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Active Image Modal state for viewing uploaded screenshot full scale
  const [activePreviewImage, setActivePreviewImage] = useState<{ src: string; title: string } | null>(null);

  // User Checklist Multi-select dropdown filters
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);
  const [userSearchTerm, setUserSearchTerm] = useState('');

  // Admin-only status filter (single-select: All / Pending / Approved)
  const [statusFilter, setStatusFilter] = useState<'all' | 'Pending' | 'Approved' | 'Remark'>('all');

  // Sytem activity audit log state triggers
  const [activeLogTab, setActiveLogTab] = useState<'submissions' | 'activities'>('submissions');
  const [activitiesList, setActivitiesList] = useState<any[]>([]);
  const [isLoadingActivities, setIsLoadingActivities] = useState(false);
  const [activitySearchTerm, setActivitySearchTerm] = useState('');

  const handleFetchActivities = () => {
    setIsLoadingActivities(true);
    fetch('/api/activity')
      .then(res => {
        if (res.ok) return res.json();
        throw new Error('Failed to load system activity logs');
      })
      .then(data => {
        if (Array.isArray(data)) {
          setActivitiesList(data);
        }
      })
      .catch(err => console.error("Error loading activities:", err))
      .finally(() => setIsLoadingActivities(false));
  };

  useEffect(() => {
    if (activeLogTab === 'activities') {
      handleFetchActivities();
    }
  }, [activeLogTab]);

  const filteredActivities = useMemo(() => {
    if (!activitySearchTerm.trim()) return activitiesList;
    const term = activitySearchTerm.toLowerCase();
    return activitiesList.filter(act => {
      const email = (act.userEmail || '').toLowerCase();
      const type = (act.eventType || '').toLowerCase();
      const desc = (act.details || '').toLowerCase();
      return email.includes(term) || type.includes(term) || desc.includes(term);
    });
  }, [activitiesList, activitySearchTerm]);

  // Host list of all users on the system (both allowed list and historic logging addresses)
  const allUsersList = useMemo(() => {
    const emailMap = new Map<string, string>();

    allowedUsers.forEach(u => {
      if (u.email && u.email.trim() && !isUserAdmin(u.email)) {
        emailMap.set(u.email.trim().toLowerCase(), u.name || getUserDisplayName(u.email, allowedUsers));
      }
    });

    entries.forEach(entry => {
      if (entry && entry.userEmail && !isUserAdmin(entry.userEmail)) {
        const email = entry.userEmail.trim().toLowerCase();
        if (!emailMap.has(email)) {
          emailMap.set(email, getUserDisplayName(email, allowedUsers));
        }
      }
    });

    // Deduplicate by display name to prevent repeated names
    const uniqueMap = new Map<string, { email: string; name: string }>();
    emailMap.forEach((name, email) => {
      const displayName = name || getUserDisplayName(email, allowedUsers);
      if (displayName && displayName !== 'Admin') {
        uniqueMap.set(displayName.toLowerCase().trim(), { email, name: displayName });
      }
    });

    return Array.from(uniqueMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [allowedUsers, entries]);

  const employeeNamesMap = useMemo(() => {
    const map: Record<string, string> = {};
    
    // Default format for any existing log emails first
    entries.forEach(entry => {
      if (entry && entry.userEmail) {
        const email = entry.userEmail.trim().toLowerCase();
        map[email] = getUserDisplayName(email, allowedUsers);
      }
    });

    // Overwrite with assigned name from allowedUsers
    allowedUsers.forEach(u => {
      map[u.email.trim().toLowerCase()] = u.name || getUserDisplayName(u.email, allowedUsers);
    });

    return map;
  }, [allowedUsers, entries]);

  const toggleExpand = (id: string) => {
    setExpandedEntries(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  // When navigated here from a notification (e.g. "Check Remark"), auto-open and
  // scroll to the specific log entry it points to.
  useEffect(() => {
    if (!focusUniqueId) return;
    setExpandedEntries(prev => ({ ...prev, [focusUniqueId]: true }));

    const scrollTimer = setTimeout(() => {
      logItemRefs.current[focusUniqueId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 250);

    onFocusHandled?.();

    return () => clearTimeout(scrollTimer);
  }, [focusUniqueId]);

  const getLocalDateStrings = () => {
    const todayObj = new Date();
    
    const formatDate = (d: Date) => {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    };

    const todayStr = formatDate(todayObj);

    const yesterdayObj = new Date();
    yesterdayObj.setDate(yesterdayObj.getDate() - 1);
    const yesterdayStr = formatDate(yesterdayObj);

    const list7Days: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      list7Days.push(formatDate(d));
    }

    return { todayStr, yesterdayStr, list7Days };
  };

  // Only show currently logged-in user's logs if they are not an administrator
  const visibleEntries = useMemo(() => {
    if (isAdmin) {
      return entries;
    }
    if (!currentUserEmail) return [];

    return entries.filter((entry) => {
      if (!entry.userEmail) return false;
      return doesUserMatch(entry.userEmail, currentUserEmail, allowedUsers);
    });
  }, [entries, isAdmin, currentUserEmail, allowedUsers]);

  // Filtering logs
  const filteredEntries = useMemo(() => {
    return visibleEntries.filter((entry) => {
      if (!entry) return false;
      const email = entry.userEmail || '';
      const emailLower = email.toLowerCase().trim();
      const worksList = Array.isArray(entry.works) ? entry.works : [];

      // Checkbox multi-user filter (Admin only)
      if (isAdmin && selectedUsers.length > 0) {
        const matchesAnyChecked = selectedUsers.some(selEmail => {
          const selEmailLower = selEmail.toLowerCase().trim();
          const selNameLower = getUserDisplayName(selEmail, allowedUsers).toLowerCase().trim();
          return emailLower === selEmailLower || 
                 emailLower === selNameLower || 
                 emailLower.includes(selEmailLower) ||
                 selNameLower.includes(emailLower);
        });
        if (!matchesAnyChecked) {
          return false;
        }
      }

      // Search matches everything (developer email, project names, code, deliverables, text notes)
      const matchesEmail = email.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesName = (employeeNamesMap[email.toLowerCase()] || '').toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesWorks = worksList.some((work) => {
        if (!work) return false;
        
        // Match against local parameters
        const localProjName = (work.projectName || '').toLowerCase();
        const blogText = (work.blog || '').toLowerCase();
        const summaryText = (work.workSummary || '').toLowerCase();
        const extraWorkText = (work.extraWorkNote || '').toLowerCase();
        const pdfText = (work.pdfName || '').toLowerCase();
        const imgText = (work.imageName || '').toLowerCase();
        
        // Resolve matches against full project dynamic entity (name & code)
        const matchedProj = projects.find(p => p.id === work.projectId);
        const fullProjName = matchedProj ? matchedProj.name.toLowerCase() : '';
        const fullProjCode = matchedProj ? matchedProj.code.toLowerCase() : '';

        const query = searchTerm.toLowerCase();

        return (
          localProjName.includes(query) ||
          fullProjName.includes(query) ||
          fullProjCode.includes(query) ||
          blogText.includes(query) ||
          summaryText.includes(query) ||
          extraWorkText.includes(query) ||
          pdfText.includes(query) ||
          imgText.includes(query)
        );
      });

      const matchesSearch = matchesEmail || matchesName || matchesWorks || searchTerm === '';

      // Date qualification filter
      const { todayStr, yesterdayStr, list7Days } = getLocalDateStrings();
      const isDateQualified = (entryDate: string) => {
        if (!entryDate) return false;
        const dStr = entryDate.trim().split('T')[0];

        switch (dateFilterType) {
          case 'all':
            return true;
          case 'today':
            return dStr === todayStr;
          case 'yesterday_today':
            return dStr === todayStr || dStr === yesterdayStr;
          case 'yesterday':
            return dStr === yesterdayStr;
          case 'last_7_days':
            return list7Days.includes(dStr);
          case 'custom': {
            let ok = true;
            if (customStartDate) {
              ok = ok && dStr >= customStartDate;
            }
            if (customEndDate) {
              ok = ok && dStr <= customEndDate;
            }
            return ok;
          }
          default:
            return true;
        }
      };

      const matchesDate = isDateQualified(entry.date);

      // Project matches if 'all' or if the entry has at least one work targeting this project by ID or project name
      const selectedProjObj = projects.find(p => p.id === selectedProjectId);
      const matchesProject = selectedProjectId === 'all' || worksList.some(w => {
        if (!w) return false;
        if (w.projectId === selectedProjectId) return true;
        if (selectedProjObj && w.projectName && w.projectName.toLowerCase().trim() === selectedProjObj.name.toLowerCase().trim()) return true;
        return false;
      });

      // Admin-only status filter — Pending/Approved are mutually exclusive
      const matchesStatus = !isAdmin || statusFilter === 'all' || (entry.status || 'Pending') === statusFilter;

      return matchesSearch && matchesDate && matchesProject && matchesStatus;
    });
  }, [visibleEntries, isAdmin, selectedUsers, searchTerm, employeeNamesMap, projects, dateFilterType, customStartDate, customEndDate, selectedProjectId, statusFilter]);

  // Group filtered entries by user and target date
  const flatLogs = useMemo(() => {
    const groups: Record<string, {
      uniqueId: string;
      userEmail: string;
      filledForDate: string;
      submittedAt: string;
      status: 'Pending' | 'Approved' | 'Needs Revision';
      entryIds: string[];
      works: any[];
    }> = {};

    // Walk entries in true chronological (submission) order — the `entries` list itself is
    // newest-first (new submissions are prepended), so without this sort the "first" work
    // item pushed into a day's group would actually be the most recently submitted one,
    // which threw off the Project numbering / sequence shown below and in the Delete modal.
    const chronologicalEntries = [...filteredEntries].sort((a, b) =>
      (a.createdAt || '').localeCompare(b.createdAt || '')
    );

    chronologicalEntries.forEach((entry) => {
      const emailLower = (entry.userEmail || '').trim().toLowerCase();
      const rawDate = entry.date || '';
      const dateStr = rawDate.includes('T') ? rawDate.split('T')[0] : rawDate;
      const key = `${emailLower}_${dateStr}`;

      if (!groups[key]) {
        groups[key] = {
          uniqueId: `group-${emailLower}-${dateStr}`,
          userEmail: entry.userEmail,
          filledForDate: dateStr,
          submittedAt: entry.createdAt,
          status: entry.status || 'Pending',
          entryIds: [entry.id],
          works: []
        };
      } else {
        if (entry.createdAt && entry.createdAt > groups[key].submittedAt) {
          groups[key].submittedAt = entry.createdAt;
        }
        if (!groups[key].entryIds.includes(entry.id)) {
          groups[key].entryIds.push(entry.id);
        }
        if (entry.status === 'Needs Revision' || entry.status === 'Remark' || (entry.status === 'Pending' && groups[key].status === 'Approved')) {
          groups[key].status = entry.status;
        }
      }

      const entryWorks = entry.works || [];
      entryWorks.forEach((w, index) => {
        const selectedProjObj = projects.find(p => p.id === selectedProjectId);
        let matchesProj = selectedProjectId === 'all';
        if (!matchesProj) {
          if (w.projectId === selectedProjectId) {
            matchesProj = true;
          } else if (selectedProjObj && w.projectName && w.projectName.toLowerCase().trim() === selectedProjObj.name.toLowerCase().trim()) {
            matchesProj = true;
          }
        }

        if (!matchesProj) return;

        groups[key].works.push({
          workId: w.id || `work-${index}`,
          projectId: w.projectId,
          projectName: w.projectName,
          listingCount: w.listingCount || 0,
          blogCount: w.blogCount || 0,
          forumCount: w.forumCount || 0,
          pdfCount: w.pdfCount || 0,
          imageCount: w.imageCount || 0,
          videoPptCount: w.videoPptCount || 0,
          profileCount: w.profileCount || 0,
          linkCount: w.linkCount || 0,
          blog: w.blog || '',
          workSummary: w.workSummary || '',
          workStatus: w.workStatus || '',
          workTypes: w.workTypes || [],
          contentUpdates: w.contentUpdates || [],
          extraWorkNote: w.extraWorkNote || '',
          priority: w.priority || '',
          frequency: w.frequency || '',
          customValues: w.customValues || {},
          selectedKeywords: w.selectedKeywords || w.customValues?.selectedKeywords || [],
          entryCreatedAt: entry.createdAt || null
        });
      });
    });

    const list = Object.values(groups).filter(g => g.works.length > 0);

    return list.sort((a, b) => {
      const dateCompare = (b.filledForDate || '').localeCompare(a.filledForDate || '');
      if (dateCompare !== 0) return dateCompare;
      const subCompare = (b.submittedAt || '').localeCompare(a.submittedAt || '');
      return subCompare;
    });
  }, [filteredEntries, selectedProjectId, projects]);

  // Call parent callback with the total matching count when filters or logs change
  useEffect(() => {
    if (onFilteredCountChange) {
      onFilteredCountChange(flatLogs.length);
    }
  }, [flatLogs, onFilteredCountChange]);

  const handleResetFilters = () => {
    setSearchTerm('');
    setSelectedProjectId('all');
    setDateFilterType('all');
    setCustomStartDate('');
    setCustomEndDate('');
    setSelectedUsers([]);
    setUserSearchTerm('');
  };

  return (
    <div className="space-y-6">
      {/* Search & Parameters panel */}
          <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-gray-900">Historical Daily Logs</h3>
          </div>
          <button
            onClick={handleResetFilters}
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 focus:outline-none"
          >
            Reset Filters
          </button>
        </div>

        <div className={`grid grid-cols-1 sm:grid-cols-2 ${isAdmin ? 'lg:grid-cols-5' : 'lg:grid-cols-3'} gap-4`}>
          {/* Text search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
            <input
              type="text"
              placeholder="Search everything (user id, project, blog)..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-950 focus:outline-none focus:ring-1 focus:ring-indigo-550 transition h-[40px]"
            />
          </div>

          {/* Project Allocation selection */}
          <div className="flex items-center gap-1.5 h-[40px]">
            <Tag size={12} className="text-gray-400 shrink-0" />
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-950 focus:outline-none transition h-[40px]"
            >
              <option value="all">Every Project (All Allocations)</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Date Selector */}
          <div className="flex items-center gap-1.5 h-[40px]">
            <Calendar size={12} className="text-gray-400 shrink-0" />
            <select
              value={dateFilterType}
              onChange={(e) => setDateFilterType(e.target.value as any)}
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-950 focus:outline-none transition cursor-pointer h-[40px]"
            >
              <option value="all">All Dates</option>
              <option value="today">Today Only</option>
              <option value="yesterday_today">Yesterday & Today Combined</option>
              <option value="yesterday">Yesterday Only</option>
              <option value="last_7_days">Last 7 Days</option>
              <option value="custom">Custom Range...</option>
            </select>
          </div>

          {/* User Checklist drop-down filter (Admin only) */}
          {isAdmin && (
            <div className="flex items-center gap-1.5 h-[40px] relative">
              <Users size={12} className="text-gray-400 shrink-0" />
              <button
                type="button"
                onClick={() => {
                  setIsUserDropdownOpen(!isUserDropdownOpen);
                }}
                className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-950 font-bold focus:outline-none transition hover:bg-gray-100 h-[40px]"
              >
                <span className="truncate pr-1">
                  {selectedUsers.length === 0 
                    ? 'All Users' 
                    : `${selectedUsers.length} Selected`}
                </span>
                <ChevronDown size={12} className={`text-gray-400 transition-transform shrink-0 ${isUserDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {isUserDropdownOpen && (
                <>
                  <div 
                    className="fixed inset-0 z-40" 
                    onClick={() => setIsUserDropdownOpen(false)} 
                  />
                  <div className="absolute right-0 left-0 mt-[42px] top-0 bg-white border border-gray-200 rounded-xl shadow-lg z-50 p-2.5 space-y-2 max-h-56 overflow-y-auto">
                    <div className="flex items-center justify-between text-[9px] pb-1 border-b border-gray-100 font-bold text-gray-400">
                      <span>USERS</span>
                      <div className="flex gap-2">
                        <button 
                          type="button" 
                          onClick={(e) => { e.stopPropagation(); setSelectedUsers([]); }} 
                          className="text-indigo-600 hover:text-indigo-850"
                        >
                          Clear
                        </button>
                        <span>•</span>
                        <button 
                          type="button" 
                          onClick={(e) => { e.stopPropagation(); setSelectedUsers(allUsersList.map(u => u.email)); }} 
                          className="text-indigo-600 hover:text-indigo-850"
                        >
                          All
                        </button>
                      </div>
                    </div>

                    {/* Small Search Bar inside dropdown */}
                    <div className="relative" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        value={userSearchTerm}
                        onChange={(e) => setUserSearchTerm(e.target.value)}
                        placeholder="Search user..."
                        className="w-full px-2 py-1 bg-gray-50 border border-gray-200 rounded text-[10px] font-bold focus:outline-none focus:ring-1 focus:ring-indigo-550 text-gray-950 placeholder-gray-400 h-[26px]"
                      />
                    </div>

                    <div className="space-y-0.5 max-h-36 overflow-y-auto text-left" onClick={(e) => e.stopPropagation()}>
                      {allUsersList
                        .filter(u => u.name.toLowerCase().includes(userSearchTerm.toLowerCase()) || u.email.toLowerCase().includes(userSearchTerm.toLowerCase()))
                        .map((u) => {
                          const isChecked = selectedUsers.includes(u.email);
                          return (
                            <div key={u.email} className="flex items-center justify-between p-1 rounded hover:bg-gray-50 transition-colors">
                              <label className="flex items-center gap-2 cursor-pointer text-[11px] text-gray-800 font-bold grow select-none">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => {
                                    if (isChecked) {
                                      setSelectedUsers(selectedUsers.filter(em => em !== u.email));
                                    } else {
                                      setSelectedUsers([...selectedUsers, u.email]);
                                    }
                                  }}
                                  className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 cursor-pointer"
                                />
                                <span className="truncate">{u.name}</span>
                              </label>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Admin-only Status filter — single select, Pending or Approved (not both) */}
          {isAdmin && (
            <div className="flex items-center gap-1.5 h-[40px]">
              <ShieldCheck size={12} className="text-gray-400 shrink-0" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-950 focus:outline-none transition cursor-pointer h-[40px]"
              >
                <option value="all">All Status</option>
                <option value="Pending">Pending Only</option>
                <option value="Approved">Approved Only</option>
                <option value="Remark">Remark Only</option>
              </select>
            </div>
          )}
        </div>

        {/* Custom date pickers if range chosen */}
        {dateFilterType === 'custom' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-indigo-50/15 rounded-2xl border border-indigo-105/30">
            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-indigo-900 uppercase tracking-wider">Start Date</label>
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-xs text-gray-950 focus:outline-none focus:ring-1 focus:ring-indigo-555"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-indigo-900 uppercase tracking-wider">End Date</label>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-xs text-gray-950 focus:outline-none focus:ring-1 focus:ring-indigo-555"
              />
            </div>
          </div>
        )}
      </div>

      {/* Primary entries feed list */}
      {flatLogs.length === 0 ? (
        <div className="bg-white p-12 rounded-3xl border border-gray-150 text-center flex flex-col items-center justify-center space-y-4 max-w-xl mx-auto">
          <Compass size={40} className="text-gray-300 animate-pulse" />
          <h4 className="text-sm font-bold text-gray-800">Clear Search Criteria</h4>
          <p className="text-xs text-gray-550 leading-relaxed">
            No daily status reports match your specified filters or search queries. Try resetting filters to explore seed project metrics.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3.5">
            {flatLogs.map((item) => {
              const parsedFilledDate = new Date(item.filledForDate);
              const formattedFilledDate = isNaN(parsedFilledDate.getTime())
                ? item.filledForDate
                : parsedFilledDate.toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric'
                  });

              const parsedSubDate = item.submittedAt ? new Date(item.submittedAt) : null;
              const formattedSubmittedString = parsedSubDate && !isNaN(parsedSubDate.getTime())
                ? `${parsedSubDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at ${parsedSubDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`
                : 'Realtime Device Local Sync';

              const submittedTimeStr = parsedSubDate && !isNaN(parsedSubDate.getTime())
                ? parsedSubDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
                : 'Sync';

              const isExpanded = !!expandedEntries[item.uniqueId];
              const activeUserDisplayName = employeeNamesMap[item.userEmail?.toLowerCase()] || item.userEmail;

              const totalListings = item.works.reduce((sum: number, w: any) => sum + (w.listingCount || 0), 0);
              const totalBlogs = item.works.reduce((sum: number, w: any) => sum + (w.blogCount || 0), 0);
              const totalForums = item.works.reduce((sum: number, w: any) => sum + (w.forumCount || 0), 0);
              const totalPdfs = item.works.reduce((sum: number, w: any) => sum + (w.pdfCount || 0), 0);
              const totalImages = item.works.reduce((sum: number, w: any) => sum + (w.imageCount || 0), 0);
              const totalVideos = item.works.reduce((sum: number, w: any) => sum + (w.videoPptCount || 0), 0);
              const totalProfiles = item.works.reduce((sum: number, w: any) => sum + (w.profileCount || 0), 0);
              const totalLinks = item.works.reduce((sum: number, w: any) => sum + (w.linkCount || 0), 0);
              
              // Unique project names submitted
              const projectNames = Array.from(new Set(item.works.map((w: any) => {
                const p = projects.find(proj => proj.id === w.projectId);
                return p ? p.name : (w.projectName || 'Work Note');
              })));

              // Worked vs No-Activity split across the unique domain projects in this
              // day's log — used for the "Total Project : X | W: Y, NM: Z" summary.
              const domainWorks = item.works.filter((w: any) => !!w.projectId);
              const uniqueDomainKeys = Array.from(new Set(domainWorks.map((w: any) => {
                const p = projects.find(proj => proj.id === w.projectId);
                return String(p?.id ?? w.projectId ?? w.projectName ?? '').trim().toLowerCase();
              })));
              const totalProjectCount = uniqueDomainKeys.length;
              const notWorkedProjectCount = uniqueDomainKeys.filter((key) => {
                // A project counts as "No Activity" if its last submitted entry that day was marked not_worked.
                const worksForKey = domainWorks.filter((w: any) => {
                  const p = projects.find(proj => proj.id === w.projectId);
                  const k = String(p?.id ?? w.projectId ?? w.projectName ?? '').trim().toLowerCase();
                  return k === key;
                });
                const lastWork = worksForKey[worksForKey.length - 1];
                return lastWork?.workStatus === 'not_worked';
              }).length;
              const workedProjectCount = totalProjectCount - notWorkedProjectCount;

              return (
                <div
                  key={item.uniqueId}
                  ref={(el) => { logItemRefs.current[item.uniqueId] = el; }}
                  className={`bg-white rounded-2xl border transition-all duration-200 overflow-hidden ${
                    isExpanded 
                      ? 'border-indigo-400 shadow-sm shadow-indigo-100/40 ring-1 ring-indigo-400/20' 
                      : 'border-slate-150 hover:border-slate-200/90 shadow-2xs hover:shadow-3xs'
                  }`}
                >
                  {/* Card Main Bar */}
                  <div
                    onClick={() => toggleExpand(item.uniqueId)}
                    className="p-4 sm:px-5 sm:py-4.5 hover:bg-slate-50/45 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer select-none transition-colors"
                  >
                    <div className="flex items-start gap-3.5">
                      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-50 to-slate-50 border border-slate-150 flex items-center justify-center text-indigo-650 shrink-0">
                        <Calendar size={15} />
                      </div>
                      <div className="text-left space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[10px] bg-indigo-50 border border-indigo-100 text-indigo-750 font-black px-2 py-0.5 rounded font-sans uppercase">
                            Filled For Date: {formattedFilledDate}
                          </span>
                          <span className="text-[10px] bg-slate-55 border border-slate-200 text-slate-600 font-extrabold px-1.5 py-0.5 rounded flex items-center gap-1">
                            <Clock size={10} className="text-slate-400" />
                            Submitted: {submittedTimeStr}
                          </span>
                        </div>

                        {/* Submitted Time text */}
                        <div className="text-[11px] text-slate-405 font-medium leading-normal flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span>Report Synced: <strong className="text-slate-655 font-semibold">{formattedSubmittedString}</strong></span>
                          <span>•</span>
                          <span>User: <strong className="text-indigo-655 font-semibold">{activeUserDisplayName}</strong></span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-2.5 mt-1 sm:mt-0 pt-2.5 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                      {/* Left-most: W: X, NW: Y | Total Projects: Z — worked vs no-activity domain split */}
                      {totalProjectCount > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono font-black text-slate-650 bg-slate-50/60 border border-slate-150/40 px-2.5 py-1.5 rounded-lg">
                          <span className="text-emerald-700">W: {workedProjectCount}</span>
                          <span className="text-slate-300">,</span>
                          <span className="text-amber-700">NW: {notWorkedProjectCount}</span>
                          <span className="text-slate-300">|</span>
                          <span>Total Projects: <span className="text-indigo-700">{totalProjectCount}</span></span>
                        </div>
                      )}

                      {/* Left Side inline submission-type counts summary (project name removed, content update excluded — it's not a submission type) */}
                      {(() => {
                        const countEntries: { label: string; value: number }[] = [
                          { label: 'List', value: totalListings },
                          { label: 'Blog', value: totalBlogs },
                          { label: 'Forum', value: totalForums },
                          { label: 'PDF', value: totalPdfs },
                          { label: 'Image', value: totalImages },
                          { label: 'Video/PPT', value: totalVideos },
                          { label: 'Profile', value: totalProfiles },
                          { label: 'Link', value: totalLinks },
                          ...(customSubmissionTypes || []).map((type) => ({
                            label: type.name,
                            value: item.works.reduce((sum: number, w: any) => sum + (Number(w.customValues?.[type.id]) || 0), 0)
                          }))
                        ].filter((entry) => entry.value > 0);

                        if (countEntries.length === 0) return null;

                        const grandTotal = countEntries.reduce((sum, entry) => sum + entry.value, 0);

                        return (
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono font-black text-slate-650 bg-slate-50/60 border border-slate-150/40 px-2.5 py-1.5 rounded-lg max-w-xs sm:max-w-md truncate">
                            {countEntries.map((entry, idx) => (
                              <React.Fragment key={entry.label}>
                                {idx > 0 && <span className="text-slate-300">•</span>}
                                <span title={entry.label}>{entry.value} {entry.label}</span>
                              </React.Fragment>
                            ))}
                            <span className="text-slate-300">|</span>
                            <span className="text-indigo-700">{grandTotal} Total Backlinks</span>
                          </div>
                        );
                      })()}

                      <div className="flex items-center gap-2">
                        {item.status && (
                          <span className={`text-[9.5px] uppercase font-bold px-2 py-0.5 rounded-lg border tracking-wider font-sans ${
                            item.status === 'Approved' ? 'bg-emerald-50 text-emerald-800 border-emerald-100' :
                            item.status === 'Needs Revision' ? 'bg-rose-50 text-rose-855 border-rose-100' :
                            item.status === 'Remark' ? 'bg-violet-50 text-violet-800 border-violet-150' :
                            'bg-amber-50 text-amber-855 border-amber-100'
                          }`}>
                            {item.status === 'Remark' ? '💬 Remark' : item.status}
                          </span>
                        )}

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpand(item.uniqueId);
                          }}
                          className="flex items-center justify-center p-1.5 bg-slate-50 border border-slate-200 hover:bg-slate-100 text-slate-500 rounded-lg transition"
                        >
                          {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Redesigned details panel */}
                  <AnimatePresence initial={false}>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden bg-white"
                      >
                        <div className="p-4 sm:p-5 space-y-5 border-t border-slate-150 bg-slate-50/20 text-left">
                          
                          {/* Inner list of submitted project works */}
                          <div className="space-y-6">
                            {(() => {
                              // Show Work Note entries first (no projectId), then
                              // domain/project entries — grouped by PROJECT rather than
                              // raw submission order. So if the same project (Project A)
                              // is submitted again later the same day (e.g. 6:41 then again
                              // at 7:00, with B/C/D submitted in between), the second A
                              // submission is pulled up to sit right under Project A's
                              // existing block instead of trailing at the very end after
                              // B, C, D. Each project's own submissions stay in their
                              // original chronological order relative to each other; only
                              // the project GROUPS are reordered, by each group's first
                              // appearance.
                              const keyOf = (w: any) => {
                                if (!w.projectId) return '';
                                const matched = projects.find(p => String(p.id) === String(w.projectId));
                                return String(matched?.id ?? w.projectId ?? w.projectName ?? '').trim().toLowerCase();
                              };

                              const withMeta = item.works.map((w: any, originalIdx: number) => ({
                                w,
                                originalIdx,
                                hasDomain: !!w.projectId,
                                key: keyOf(w)
                              }));

                              // Order in which each project key first appears (by original
                              // submission order) — this decides the position of each group.
                              const firstSeenOrder: string[] = [];
                              withMeta.forEach(({ hasDomain, key }) => {
                                if (hasDomain && key && !firstSeenOrder.includes(key)) {
                                  firstSeenOrder.push(key);
                                }
                              });

                              const orderedWorks = [...withMeta].sort((a, b) => {
                                if (a.hasDomain !== b.hasDomain) return a.hasDomain ? 1 : -1;
                                if (!a.hasDomain && !b.hasDomain) return a.originalIdx - b.originalIdx;
                                const aGroupIdx = firstSeenOrder.indexOf(a.key);
                                const bGroupIdx = firstSeenOrder.indexOf(b.key);
                                if (aGroupIdx !== bGroupIdx) return aGroupIdx - bGroupIdx;
                                // Same project group — keep original chronological order.
                                return a.originalIdx - b.originalIdx;
                              });
                              let domainCounter = 0;
                              const seenProjectKeys = new Set<string>();
                              return orderedWorks.map(({ w: work, originalIdx }: any) => {
                              const workMatchedProj = projects.find(p => String(p.id) === String(work.projectId));
                              const hasDomain = !!work.projectId;
                              // Same project submitted again (even later the same day, after other
                              // projects came in between) — don't treat it as a new "Project N".
                              // It's the same project, so skip the heading/name row and just show
                              // this entry's own timestamp + details underneath, now positioned
                              // directly under that project's block thanks to the grouped ordering above.
                              const projectKey = (orderedWorks.find((ow: any) => ow.w === work)?.key) || '';
                              const isRepeatOfSameProject = hasDomain && !!projectKey && seenProjectKeys.has(projectKey);
                              let projectDisplayNumber = 0;
                              if (hasDomain && !isRepeatOfSameProject) {
                                projectDisplayNumber = ++domainCounter;
                                if (projectKey) seenProjectKeys.add(projectKey);
                              }
                              return (
                                <div key={work.workId || originalIdx} className="space-y-4 pb-6 last:pb-0 border-b border-dashed border-slate-200 last:border-b-0">
                                  {/* Inner details header */}
                                  <div className="pb-2">
                                    {!isRepeatOfSameProject && (
                                      <>
                                        <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest">
                                          {hasDomain ? `Project ${projectDisplayNumber}` : 'Note'}
                                        </h4>
                                        <p className="text-sm font-black text-slate-900 mt-1 flex items-center gap-2">
                                          📂 {hasDomain ? (workMatchedProj?.name || work.projectName || 'Work Note') : 'Work Note'}
                                          {workMatchedProj?.domain && (
                                            <span className="font-mono text-xs text-slate-500 font-bold bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-lg">
                                              {workMatchedProj.domain}
                                            </span>
                                          )}
                                        </p>
                                      </>
                                    )}
                                    {(() => {
                                      const workDateObj = work.entryCreatedAt ? new Date(work.entryCreatedAt) : null;
                                      const hasValidDate = workDateObj && !isNaN(workDateObj.getTime());
                                      const workDateStr = hasValidDate
                                        ? workDateObj!.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                                        : formattedFilledDate;
                                      const workTimeStr = hasValidDate
                                        ? workDateObj!.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
                                        : submittedTimeStr;
                                      return (
                                        <p className={`text-[10.5px] text-slate-450 font-bold flex items-center gap-1 ${isRepeatOfSameProject ? '' : 'mt-1'}`}>
                                          📅 {workDateStr} • {workTimeStr}
                                        </p>
                                      );
                                    })()}
                                  </div>

                                  {/* Extra / New Work Done — free-text note content only; heading already shown above (Project header / 📂 label) */}
                                  {work.extraWorkNote && (
                                    <div className="space-y-1.5">
                                      <div className="bg-amber-50/40 p-3.5 rounded-2xl border border-amber-150 shadow-3xs text-xs text-slate-805 leading-relaxed font-semibold">
                                        <p className="whitespace-pre-wrap">{work.extraWorkNote}</p>
                                      </div>
                                    </div>
                                  )}

                                  {/* On/Off Page Activity vs No Activity — only rendered for real domain entries */}
                                  {hasDomain && (() => {
                                    // Legacy entries (submitted before this status field existed) have no
                                    // workStatus saved — treat them the same as "On / Off Page Activity"
                                    // so old history keeps showing Submissions/Keywords exactly as before.
                                    const isNoActivity = work.workStatus === 'not_worked';

                                    if (isNoActivity) {
                                      return (
                                        <div className="space-y-1.5">
                                          <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest">No Activities</h4>
                                          <div className="bg-white p-3.5 rounded-2xl border border-slate-150 shadow-3xs text-xs text-slate-805 leading-relaxed font-semibold">
                                            {work.workSummary ? (
                                              <p className="whitespace-pre-wrap">{work.workSummary}</p>
                                            ) : (
                                              <p className="text-slate-404 italic">No note for this log block.</p>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    }

                                    const keywordsList = (((work.selectedKeywords || work.customValues?.selectedKeywords || []) as string[]).filter(Boolean));
                                    const hasNumericMetrics = (
                                      work.listingCount > 0 ||
                                      work.blogCount > 0 ||
                                      work.forumCount > 0 ||
                                      work.pdfCount > 0 ||
                                      work.imageCount > 0 ||
                                      work.videoPptCount > 0 ||
                                      work.profileCount > 0 ||
                                      work.linkCount > 0 ||
                                      (customSubmissionTypes || []).some((type) => Number(work.customValues?.[type.id]) > 0)
                                    );

                                    if (keywordsList.length === 0 && !hasNumericMetrics) return null;

                                    return (
                                      <div className="space-y-3">
                                        <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest">ON Page / Off Page Activities</h4>

                                        {/* Target Keywords block */}
                                        {keywordsList.length > 0 && (
                                          <div className="bg-white p-3.5 rounded-2xl border border-slate-150 shadow-3xs flex flex-wrap items-center gap-2">
                                            <span className="text-[9.5px] font-black text-slate-405 uppercase tracking-wide font-sans">Target Keywords:</span>
                                            <div className="flex flex-wrap gap-1.5">
                                              {keywordsList.map((kw: string, kwIdx: number) => (
                                                <span key={kw} className="bg-amber-100/50 border border-amber-205 text-amber-900 px-2 py-0.5 rounded-md font-sans text-[10px] font-black flex items-center gap-1.5">
                                                  <span className="bg-amber-500 text-white w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-bold shrink-0 font-mono leading-none">
                                                    {kwIdx + 1}
                                                  </span>
                                                  {kw}
                                                </span>
                                              ))}
                                            </div>
                                          </div>
                                        )}

                                        {/* All types of submissions */}
                                        {hasNumericMetrics && (
                                          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2.5">
                                            {work.listingCount > 0 && (
                                                <div className="bg-white border border-slate-150 p-2.5 rounded-xl text-center space-y-0.5 shadow-3xs">
                                                  <span className="block text-[9px] font-black text-slate-400 uppercase tracking-wider font-sans">Listings</span>
                                                  <span className="block font-mono text-xs font-black text-slate-905">{work.listingCount}</span>
                                                </div>
                                              )}
                                              {work.blogCount > 0 && (
                                                <div className="bg-white border border-slate-150 p-2.5 rounded-xl text-center space-y-0.5 shadow-3xs">
                                                  <span className="block text-[9px] font-black text-slate-400 uppercase tracking-wider font-sans">Blogs</span>
                                                  <span className="block font-mono text-xs font-black text-slate-905">{work.blogCount}</span>
                                                </div>
                                              )}
                                              {work.forumCount > 0 && (
                                                <div className="bg-white border border-slate-150 p-2.5 rounded-xl text-center space-y-0.5 shadow-3xs">
                                                  <span className="block text-[9px] font-black text-slate-400 uppercase tracking-wider font-sans">Forums</span>
                                                  <span className="block font-mono text-xs font-black text-slate-905">{work.forumCount}</span>
                                                </div>
                                              )}
                                              {work.pdfCount > 0 && (
                                                <div className="bg-white border border-slate-150 p-2.5 rounded-xl text-center space-y-0.5 shadow-3xs">
                                                  <span className="block text-[9px] font-black text-slate-400 uppercase tracking-wider font-sans">PDFs</span>
                                                  <span className="block font-mono text-xs font-black text-slate-905">{work.pdfCount}</span>
                                                </div>
                                              )}
                                              {work.imageCount > 0 && (
                                                <div className="bg-white border border-slate-150 p-2.5 rounded-xl text-center space-y-0.5 shadow-3xs">
                                                  <span className="block text-[9px] font-black text-slate-400 uppercase tracking-wider font-sans">Images</span>
                                                  <span className="block font-mono text-xs font-black text-slate-905">{work.imageCount}</span>
                                                </div>
                                              )}
                                              {work.videoPptCount > 0 && (
                                                <div className="bg-white border border-slate-150 p-2.5 rounded-xl text-center space-y-0.5 shadow-3xs">
                                                  <span className="block text-[9px] font-black text-slate-400 uppercase tracking-wider font-sans">Video/PPT</span>
                                                  <span className="block font-mono text-xs font-black text-slate-905">{work.videoPptCount}</span>
                                                </div>
                                              )}
                                              {work.profileCount > 0 && (
                                                <div className="bg-white border border-slate-150 p-2.5 rounded-xl text-center space-y-0.5 shadow-3xs">
                                                  <span className="block text-[9px] font-black text-slate-400 uppercase tracking-wider font-sans">Profile</span>
                                                  <span className="block font-mono text-xs font-black text-slate-905">{work.profileCount}</span>
                                                </div>
                                              )}
                                              {work.linkCount > 0 && (
                                                <div className="bg-white border border-slate-150 p-2.5 rounded-xl text-center space-y-0.5 shadow-3xs">
                                                  <span className="block text-[9px] font-black text-slate-400 uppercase tracking-wider font-sans">Links</span>
                                                  <span className="block font-mono text-xs font-black text-slate-905">{work.linkCount}</span>
                                                </div>
                                              )}

                                              {customSubmissionTypes && customSubmissionTypes.map((type) => {
                                                const rawVal = work.customValues?.[type.id];
                                                const count = rawVal !== undefined ? Number(rawVal) : 0;
                                                if (count <= 0) return null;
                                                return (
                                                  <div key={type.id} className="bg-white border border-slate-150 p-2.5 rounded-xl text-center space-y-0.5 shadow-3xs">
                                                    <span className="block text-[9px] font-black text-purple-600 uppercase tracking-wider truncate font-sans" title={type.name}>
                                                      {type.name}
                                                    </span>
                                                    <span className="block font-mono text-xs font-black text-purple-905">{count}</span>
                                                  </div>
                                                );
                                              })}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })()}

                                  {/* Blog Backlink URLs if exists */}
                                  {work.blog && (
                                    <div className="space-y-1 bg-white p-3 rounded-xl border border-slate-150 shadow-3xs">
                                      <h4 className="text-[10px] font-black text-indigo-650 uppercase tracking-wider flex items-center gap-1.5">
                                        <ExternalLink size={11} />
                                        Published Blog & Live Backlink URL
                                      </h4>
                                      <a
                                        href={work.blog}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-xs font-mono font-semibold text-indigo-750 hover:text-indigo-900 hover:underline break-all block"
                                      >
                                        {work.blog}
                                      </a>
                                    </div>
                                  )}

                                  {/* Content Update — its own block, same level as Submissions, not a numerical quantity so kept separate. Shown after SEO Submission (On/Off Page Activities) and Backlinks. */}
                                  {work.contentUpdates && work.contentUpdates.length > 0 && (
                                    <div className="space-y-1.5">
                                      <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest">Content Update</h4>
                                      <div className="flex flex-wrap items-baseline gap-1.5">
                                        <span className="text-[10.5px] font-bold text-slate-600 font-sans">
                                          {work.contentUpdates.map((cu: string) => CONTENT_UPDATE_LABELS[cu] || cu).join(', ')}
                                        </span>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                              });
                            })()}
                          </div>

                          {/* Inline control actions – approve/revision or delete */}
                          <div className="flex flex-wrap justify-between items-center gap-3 pt-3.5 border-t border-slate-155">
                            {/* Deletion action */}
                            {onDeleteEntry ? (
                              <button
                                onClick={() => {
                                  // Pre-check every entry for this date by default — admin can uncheck
                                  // any they want to KEEP before confirming the delete.
                                  const initial: Record<string, boolean> = {};
                                  item.entryIds.forEach((id: string) => { initial[id] = true; });
                                  setDeleteSelectedIds(initial);
                                  setDeleteModalItem(item);
                                }}
                                className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 hover:text-rose-800 rounded-xl text-xs font-black transition flex items-center gap-1.5 cursor-pointer font-sans"
                              >
                                <Trash2 size={12} />
                                Delete Log
                              </button>
                            ) : <div />}

                            {/* Administration approvals */}
                            {isAdmin && onUpdateStatus && (
                              <div className="flex flex-wrap items-center gap-2 text-right">
                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider font-sans">Admin Status Audit:</span>
                                
                                <button
                                  onClick={() => {
                                    const wasApproved = item.status === 'Approved';
                                    const nextStatus = wasApproved ? 'Pending' : 'Approved';
                                    item.entryIds.forEach((id: string) => {
                                      onUpdateStatus(id, nextStatus);
                                    });

                                    // Only auto-close on Pending -> Approved. Going back to
                                    // Pending never auto-closes — admin stays exactly where
                                    // they are to keep reviewing/undoing.
                                    // Same idea as the "Check Remark" notification flow: it
                                    // scrolls the admin straight to this log's position — the
                                    // only difference is it stays CLOSED here instead of opening.
                                    if (!wasApproved) {
                                      setExpandedEntries(prev => ({ ...prev, [item.uniqueId]: false }));
                                      setTimeout(() => {
                                        logItemRefs.current[item.uniqueId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                      }, 250);
                                    }
                                  }}
                                  className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition cursor-pointer select-none font-sans ${
                                    item.status === 'Approved'
                                      ? 'bg-amber-500 text-white shadow-xs hover:bg-amber-600'
                                      : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-100'
                                  }`}
                                >
                                  {item.status === 'Approved' ? '⚠ Pending' : '✓ Approve Task'}
                                </button>

                                {onSendRemark && (
                                  <button
                                    onClick={() => {
                                      setRemarkText('');
                                      setRemarkModalItem(item);
                                    }}
                                    className="px-3.5 py-1.5 rounded-xl text-xs font-black transition cursor-pointer select-none font-sans bg-violet-50 text-violet-800 hover:bg-violet-100 border border-violet-150 flex items-center gap-1"
                                  >
                                     Remark
                                  </button>
                                )}

                                {/* Manual close button — collapses this card, same as the
                                    arrow up top, placed here on the right for quick access
                                    right after approving/adding a remark. Scrolls smoothly
                                    along with the collapse animation so the card stays in
                                    view instead of the page jumping once it's already gone. */}
                                <button
                                  onClick={() => {
                                    toggleExpand(item.uniqueId);
                                    logItemRefs.current[item.uniqueId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                  }}
                                  title="Close this log"
                                  className="flex items-center justify-center p-1.5 bg-slate-50 border border-slate-200 hover:bg-slate-100 text-slate-500 rounded-lg transition cursor-pointer"
                                >
                                  <ChevronUp size={13} />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Polish Portal Screen Preview Lightbox modal for Image zooming */}
      <AnimatePresence>
        {activePreviewImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-gray-950/90 flex items-center justify-center p-4 backdrop-blur-xs"
            onClick={() => setActivePreviewImage(null)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-white rounded-3xl overflow-hidden shadow-2xl max-w-3xl w-full relative"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal header */}
              <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                <span className="text-xs font-bold text-gray-800">{activePreviewImage.title}</span>
                <button
                  onClick={() => setActivePreviewImage(null)}
                  className="p-1 hover:bg-gray-200 rounded-lg text-gray-500"
                >
                  <X size={16} />
                </button>
              </div>
              {/* Zoom image container */}
              <div className="p-4 bg-gray-100 flex justify-center max-h-[80vh] overflow-hidden">
                <img
                  src={activePreviewImage.src}
                  alt={activePreviewImage.title}
                  className="max-h-full max-w-full rounded-2xl object-contain shadow-sm"
                  referrerPolicy="no-referrer"
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Remark modal — admin writes a message that goes to the worker's notification bell */}
      <AnimatePresence>
        {remarkModalItem && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-gray-950/90 flex items-center justify-center p-4 backdrop-blur-xs"
            onClick={() => setRemarkModalItem(null)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-white rounded-3xl overflow-hidden shadow-2xl max-w-md w-full relative"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                <span className="text-xs font-black text-gray-800 uppercase tracking-wider flex items-center gap-1.5">
                  Send Remark
                </span>
                <button
                  onClick={() => setRemarkModalItem(null)}
                  className="p-1 hover:bg-gray-200 rounded-lg text-gray-500"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="p-5 space-y-3">
                <p className="text-xs text-gray-500 font-medium">
                  This message will be sent to the worker's notification bell for this log.
                </p>
                <textarea
                  autoFocus
                  value={remarkText}
                  onChange={(e) => setRemarkText(e.target.value)}
                  placeholder="Write your remark here..."
                  rows={4}
                  className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:border-indigo-300 transition resize-none"
                />
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    onClick={() => setRemarkModalItem(null)}
                    className="px-4 py-2 rounded-xl text-xs font-black text-gray-500 hover:bg-gray-100 transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      const trimmed = remarkText.trim();
                      if (!trimmed || !onSendRemark) return;
                      onSendRemark(remarkModalItem, trimmed);
                      setRemarkModalItem(null);
                      setRemarkText('');
                    }}
                    disabled={!remarkText.trim()}
                    className="px-4 py-2 rounded-xl text-xs font-black text-white bg-violet-600 hover:bg-violet-700 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Send Remark
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Log modal — admin picks exactly which submissions of that day to remove */}
      <AnimatePresence>
        {deleteModalItem && (() => {
          const idsForDay: string[] = deleteModalItem.entryIds || [];
          const selectedCount = idsForDay.filter((id) => deleteSelectedIds[id]).length;
          const allSelected = idsForDay.length > 0 && selectedCount === idsForDay.length;

          return (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-gray-950/90 flex items-center justify-center p-4 backdrop-blur-xs"
              onClick={() => setDeleteModalItem(null)}
            >
              <motion.div
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.9, y: 20 }}
                className="bg-white rounded-3xl overflow-hidden shadow-2xl max-w-lg w-full relative max-h-[85vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50 shrink-0">
                  <span className="text-xs font-black text-gray-800 uppercase tracking-wider flex items-center gap-1.5">
                    <Trash2 size={14} className="text-rose-600" />
                    Delete Log — {deleteModalItem.filledForDate}
                  </span>
                  <button
                    onClick={() => setDeleteModalItem(null)}
                    className="p-1 hover:bg-gray-200 rounded-lg text-gray-500"
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="p-5 space-y-3 overflow-y-auto">
                  <p className="text-xs text-gray-500 font-medium">
                    All submissions for this date are selected by default. Uncheck any entry you want to
                    <span className="font-black text-gray-700"> keep</span> — only the checked ones below will be permanently deleted.
                  </p>

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        const next: Record<string, boolean> = {};
                        idsForDay.forEach((id) => { next[id] = !allSelected; });
                        setDeleteSelectedIds(next);
                      }}
                      className="px-2.5 py-1 text-[10px] font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition cursor-pointer"
                    >
                      {allSelected ? 'Uncheck All' : 'Check All'}
                    </button>
                  </div>

                  <div className="space-y-2">
                    {[...idsForDay]
                      .sort((idA, idB) => {
                        const entryA = entries.find((e) => e.id === idA);
                        const entryB = entries.find((e) => e.id === idB);
                        return (entryA?.createdAt || '').localeCompare(entryB?.createdAt || '');
                      })
                      .map((id, sequenceIdx) => {
                      const entry = entries.find((e) => e.id === id);
                      const projectNames = Array.from(
                        new Set((entry?.works || []).map((w: any) => w.projectName).filter(Boolean))
                      );
                      const isChecked = !!deleteSelectedIds[id];
                      return (
                        <label
                          key={id}
                          className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition ${isChecked ? 'border-rose-200 bg-rose-50/40' : 'border-gray-150 bg-gray-50/40'}`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => setDeleteSelectedIds((prev) => ({ ...prev, [id]: e.target.checked }))}
                            className="mt-0.5 w-4 h-4 accent-rose-600 cursor-pointer shrink-0"
                          />
                          <span className="mt-0.5 w-5 h-5 rounded-full bg-gray-150 text-gray-600 text-[10px] font-black flex items-center justify-center shrink-0">
                            {sequenceIdx + 1}
                          </span>
                          <div className="space-y-0.5">
                            <p className="text-xs font-bold text-gray-800">
                              {projectNames.length > 0 ? projectNames.join(', ') : 'Work Note'}
                            </p>
                            <p className="text-[10px] text-gray-400 font-mono uppercase">
                              Submitted {entry?.createdAt ? new Date(entry.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Unknown time'}
                            </p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="flex justify-end gap-2 p-4 border-t border-gray-100 shrink-0">
                  <button
                    onClick={() => setDeleteModalItem(null)}
                    className="px-4 py-2 rounded-xl text-xs font-black text-gray-500 hover:bg-gray-100 transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      if (!onDeleteEntry) return;
                      const idsToDelete = idsForDay.filter((id) => deleteSelectedIds[id]);
                      if (idsToDelete.length === 0) {
                        setDeleteModalItem(null);
                        return;
                      }
                      if (window.confirm(`Delete ${idsToDelete.length} selected log(s) for ${deleteModalItem.filledForDate}? This will modify the Google Sheets records.`)) {
                        idsToDelete.forEach((id) => onDeleteEntry(id));
                        setDeleteModalItem(null);
                      }
                    }}
                    disabled={selectedCount === 0}
                    className="px-4 py-2 rounded-xl text-xs font-black text-white bg-rose-600 hover:bg-rose-700 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Delete Selected ({selectedCount})
                  </button>
                </div>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>
    </div>
  );
}
