/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { DSREntry, Project, ProjectWork, CustomSubmissionType, AppUser } from '../types';
import { getUserDisplayName, isUserAdmin, doesUserMatch } from '../lib/userUtils';
import { cleanDomain } from '../lib/domain';
import {
  Search,
  Calendar,
  Layers,
  FileCheck2,
  Image,
  Tag,
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

  // Pill-style dropdown open/close state for Project, Date & Status filters
  // (mirrors the compact "Workspace Filters" pill treatment used on Overview Panel)
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  const [isDateDropdownOpen, setIsDateDropdownOpen] = useState(false);
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false);
  const [projectSearchTerm, setProjectSearchTerm] = useState('');

  const closeAllFilterDropdowns = () => {
    setIsProjectDropdownOpen(false);
    setIsDateDropdownOpen(false);
    setIsStatusDropdownOpen(false);
    setIsUserDropdownOpen(false);
  };

  const DATE_FILTER_LABELS: Record<string, string> = {
    all: 'All Dates',
    today: 'Today',
    yesterday_today: 'Yesterday & Today',
    yesterday: 'Yesterday',
    last_7_days: 'Last 7 Days',
    custom: 'Custom Range'
  };

  const STATUS_FILTER_LABELS: Record<string, string> = {
    all: 'All Status',
    Pending: 'Pending Only',
    Approved: 'Approved Only',
    Remark: 'Remark Only'
  };

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

  // Fixed width of the "User" column on each log card's main bar (admin view
  // only) — a flat constant rather than something computed off name length,
  // so it's always exactly this size regardless of how short/long any given
  // name is. Content inside gets center-aligned to suit a fixed box.
  const userColWidthPx = 410;

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
        const fullProjName = matchedProj ? (matchedProj.name || '').toLowerCase() : '';
        const fullProjCode = matchedProj ? (matchedProj.code || '').toLowerCase() : '';

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
        if (selectedProjObj && w.projectName && selectedProjObj.name && w.projectName.toLowerCase().trim() === selectedProjObj.name.toLowerCase().trim()) return true;
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
          } else if (selectedProjObj && w.projectName && selectedProjObj.name && w.projectName.toLowerCase().trim() === selectedProjObj.name.toLowerCase().trim()) {
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
      {/* Search & Parameters panel — compact pill-style filters, matching the
          Overview Panel's "Workspace Filters" treatment: a growing search bar
          plus inline pill dropdowns, all on one row instead of a boxy grid. */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-100 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Dynamic search bar — grows to fill remaining width */}
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
            <input
              type="text"
              placeholder="Search everything (user id, project, blog)..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-250 rounded-xl text-[13px] font-semibold placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 hover:bg-slate-100/50 transition text-gray-950"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-[10px] font-black text-indigo-600 hover:text-indigo-850"
              >
                Clear
              </button>
            )}
          </div>

          {/* Date pill */}
          <div className="relative">
            <div
              className={`relative flex items-center gap-1.5 pl-4 pr-3 py-2.5 rounded-xl border text-[13px] font-semibold whitespace-nowrap transition cursor-pointer ${
                dateFilterType !== 'all'
                  ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                  : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Calendar size={14} className={dateFilterType !== 'all' ? 'text-indigo-500' : 'text-gray-400'} />
              <span>Date:</span>
              <span className="max-w-[9rem] truncate">{DATE_FILTER_LABELS[dateFilterType]}</span>
              <ChevronDown size={14} className={dateFilterType !== 'all' ? 'text-indigo-400' : 'text-gray-400'} />
              <select
                value={dateFilterType}
                onChange={(e) => setDateFilterType(e.target.value as any)}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                aria-label="Date Filter"
              >
                <option value="all">All Dates</option>
                <option value="today">Today Only</option>
                <option value="yesterday_today">Yesterday & Today Combined</option>
                <option value="yesterday">Yesterday Only</option>
                <option value="last_7_days">Last 7 Days</option>
                <option value="custom">Custom Range...</option>
              </select>
            </div>

            {dateFilterType === 'custom' && (
              <div className="absolute left-0 mt-1.5 z-50 flex flex-col gap-1 bg-white p-2 border border-indigo-100 rounded-xl shadow-lg w-48" onClick={(e) => e.stopPropagation()}>
                <label className="block text-[9px] font-bold text-indigo-900 uppercase tracking-wider px-0.5">Start Date</label>
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="w-full px-1.5 py-1 bg-gray-50 border border-gray-200 rounded text-[10px] font-bold text-gray-900 cursor-pointer"
                  title="Start Date"
                />
                <label className="block text-[9px] font-bold text-indigo-900 uppercase tracking-wider px-0.5 mt-0.5">End Date</label>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="w-full px-1.5 py-1 bg-gray-50 border border-gray-200 rounded text-[10px] font-bold text-gray-900 cursor-pointer"
                  title="End Date"
                />
              </div>
            )}
          </div>

          {/* Project pill — single-select, dropdown list with local search */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setIsProjectDropdownOpen(!isProjectDropdownOpen);
                setIsDateDropdownOpen(false);
                setIsUserDropdownOpen(false);
                setIsStatusDropdownOpen(false);
              }}
              className={`flex items-center gap-1.5 pl-4 pr-3 py-2.5 rounded-xl border text-[13px] font-semibold whitespace-nowrap transition cursor-pointer ${
                selectedProjectId !== 'all'
                  ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                  : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Tag size={14} className={selectedProjectId !== 'all' ? 'text-indigo-500' : 'text-gray-400'} />
              <span>Project:</span>
              <span className="max-w-[9rem] truncate">
                {selectedProjectId === 'all' ? 'All' : (projects.find(p => p.id === selectedProjectId)?.name || 'Selected')}
              </span>
              <ChevronDown size={14} className={`transition-transform shrink-0 ${selectedProjectId !== 'all' ? 'text-indigo-400' : 'text-gray-400'} ${isProjectDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {isProjectDropdownOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setIsProjectDropdownOpen(false)} />
                <div className="absolute left-0 mt-1.5 w-64 bg-white border border-gray-200 rounded-xl shadow-lg z-50 p-2.5 space-y-2 max-h-64 overflow-y-auto">
                  <div className="flex items-center justify-between text-[9px] pb-1 border-b border-gray-100 font-bold text-gray-400">
                    <span>PROJECT</span>
                    {selectedProjectId !== 'all' && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setSelectedProjectId('all'); }}
                        className="text-indigo-600 hover:text-indigo-850"
                      >
                        Clear
                      </button>
                    )}
                  </div>

                  <div className="relative" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="text"
                      value={projectSearchTerm}
                      onChange={(e) => setProjectSearchTerm(e.target.value)}
                      placeholder="Search project..."
                      className="w-full px-2 py-1 bg-gray-50 border border-gray-200 rounded text-[10px] font-bold focus:outline-none focus:ring-1 focus:ring-indigo-550 text-gray-950 placeholder-gray-400"
                    />
                  </div>

                  <div className="space-y-0.5 max-h-40 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                    <div
                      onClick={() => { setSelectedProjectId('all'); setIsProjectDropdownOpen(false); }}
                      className={`px-2 py-1.5 rounded cursor-pointer text-[12px] font-bold truncate transition-colors ${
                        selectedProjectId === 'all' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-800 hover:bg-gray-50'
                      }`}
                    >
                      Every Project (All Allocations)
                    </div>
                    {projects
                      .filter(p => (p.name || '').toLowerCase().includes(projectSearchTerm.toLowerCase()))
                      .map((p) => (
                        <div
                          key={p.id}
                          onClick={() => { setSelectedProjectId(p.id); setIsProjectDropdownOpen(false); }}
                          className={`px-2 py-1.5 rounded cursor-pointer text-[12px] font-bold truncate transition-colors ${
                            selectedProjectId === p.id ? 'bg-indigo-50 text-indigo-700' : 'text-gray-800 hover:bg-gray-50'
                          }`}
                        >
                          {p.name}
                        </div>
                      ))}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* User Checklist pill (Admin only) */}
          {isAdmin && (
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setIsUserDropdownOpen(!isUserDropdownOpen);
                  setIsProjectDropdownOpen(false);
                  setIsDateDropdownOpen(false);
                  setIsStatusDropdownOpen(false);
                }}
                className={`flex items-center gap-1.5 pl-4 pr-3 py-2.5 rounded-xl border text-[13px] font-semibold whitespace-nowrap transition cursor-pointer ${
                  selectedUsers.length > 0
                    ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                    : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                <Users size={14} className={selectedUsers.length > 0 ? 'text-indigo-500' : 'text-gray-400'} />
                <span>User:</span>
                <span className="max-w-[9rem] truncate">
                  {selectedUsers.length === 0 ? 'All' : `${selectedUsers.length} selected`}
                </span>
                <ChevronDown size={14} className={`transition-transform shrink-0 ${selectedUsers.length > 0 ? 'text-indigo-400' : 'text-gray-400'} ${isUserDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {isUserDropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setIsUserDropdownOpen(false)}
                  />
                  <div className="absolute left-0 mt-1.5 w-64 bg-white border border-gray-200 rounded-xl shadow-lg z-50 p-2.5 space-y-2 max-h-56 overflow-y-auto">
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

          {/* Status pill (Admin only) — single select, Pending / Approved / Remark */}
          {isAdmin && (
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setIsStatusDropdownOpen(!isStatusDropdownOpen);
                  setIsProjectDropdownOpen(false);
                  setIsDateDropdownOpen(false);
                  setIsUserDropdownOpen(false);
                }}
                className={`flex items-center gap-1.5 pl-4 pr-3 py-2.5 rounded-xl border text-[13px] font-semibold whitespace-nowrap transition cursor-pointer ${
                  statusFilter !== 'all'
                    ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                    : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                <ShieldCheck size={14} className={statusFilter !== 'all' ? 'text-indigo-500' : 'text-gray-400'} />
                <span>Status:</span>
                <span className="max-w-[8rem] truncate">{STATUS_FILTER_LABELS[statusFilter]}</span>
                <ChevronDown size={14} className={`transition-transform shrink-0 ${statusFilter !== 'all' ? 'text-indigo-400' : 'text-gray-400'} ${isStatusDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {isStatusDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsStatusDropdownOpen(false)} />
                  <div className="absolute right-0 mt-1.5 w-44 bg-white border border-gray-200 rounded-xl shadow-lg z-50 p-1.5 space-y-0.5">
                    {(['all', 'Pending', 'Approved', 'Remark'] as const).map((s) => (
                      <div
                        key={s}
                        onClick={() => { setStatusFilter(s); setIsStatusDropdownOpen(false); }}
                        className={`px-2.5 py-1.5 rounded-lg cursor-pointer text-[12px] font-bold transition-colors ${
                          statusFilter === s ? 'bg-indigo-50 text-indigo-700' : 'text-gray-800 hover:bg-gray-50'
                        }`}
                      >
                        {STATUS_FILTER_LABELS[s]}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
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

              const submittedTimeStr = parsedSubDate && !isNaN(parsedSubDate.getTime())
                ? parsedSubDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
                : 'Sync';

              // If the report was actually synced/submitted on a different calendar day
              // than the day it was FILLED FOR (e.g. filled for Aug 26 but only synced
              // the next morning), surface that submitted date next to the time so it
              // doesn't look like a same-day submission when it wasn't.
              const submittedDateOnlyStr = parsedSubDate && !isNaN(parsedSubDate.getTime())
                ? parsedSubDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                : null;
              const submittedOnDifferentDate = !!submittedDateOnlyStr && submittedDateOnlyStr !== formattedFilledDate;

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
                  {/* Card Main Bar — fixed-width CSS grid columns. Date + User sit on the
                      left; a flexible spacer right after User absorbs all leftover row
                      width, so the 3 project-count boxes, the submission breakdown, and
                      Status all sit clustered together, stuck to the right edge, on every
                      row — regardless of how long the date/user name happens to be.
                      Status has no forced width; it's sized to exactly what it needs
                      (max-content). Submission has a generous fixed max-width sized to
                      fit the worst case (every submission type + Total Backlinks).
                      The User column (admin view) is a flat fixed width
                      (userColWidthPx) — not computed off name length — with its
                      content center-aligned inside that box. */}
                  <div
                    onClick={() => toggleExpand(item.uniqueId)}
                    className="px-4 py-3.5 sm:px-5 sm:py-4 hover:bg-slate-50/45 cursor-pointer select-none transition-colors overflow-x-auto"
                  >
                    <div
                      className="grid items-center gap-x-2 w-full"
                      style={{
                        gridTemplateColumns: `150px 12px ${isAdmin ? userColWidthPx : 190}px minmax(20px,1fr) 12px 340px 12px 560px 12px max-content`,
                        minWidth: `${950 + (isAdmin ? userColWidthPx : 190)}px`,
                      }}
                    >

                      {/* Date — big, with a small "on [actual submitted date]" line
                          underneath ONLY when this was filled for a past date (i.e. the
                          entry is backdated / logged later than the day it's for). If it
                          was filled the same day, nothing extra shows below it. Time is
                          intentionally omitted from the sub-line — just the date. */}
                      <div className="flex items-start gap-1.5 min-w-0">
                        <Calendar size={15} className="text-indigo-500 mt-0.5 shrink-0" />
                        <div className="leading-tight min-w-0">
                          <span className="text-[16px] font-black text-gray-900 tracking-tight whitespace-nowrap block truncate">
                            {formattedFilledDate}
                          </span>
                          {submittedOnDifferentDate && (
                            <span className="text-[10.5px] text-slate-400 font-semibold whitespace-nowrap block truncate">
                              on {submittedDateOnlyStr}
                            </span>
                          )}
                        </div>
                      </div>

                      <span className="text-slate-300 select-none text-center">|</span>

                      {/* Admin: user icon (fixed, left) + Submitted Time (fixed,
                          right) with the name sitting in the flexible middle
                          slot between them and centered inside it — so the
                          icon and the time always land in the same spot on
                          every row, and only the name text re-centers itself
                          in the space left over, instead of the whole
                          icon+name+time cluster shifting around together
                          based on how long any given name happens to be.
                          Non-admin: the user is looking at their own logs, so
                          the name/icon is pointless — this column shows
                          Submitted Time directly after Date, nudged right a
                          bit (pl-3) since it no longer has an icon/name/
                          separator in front of it to space it out. */}
                      {isAdmin ? (
                        <div className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 min-w-0 overflow-hidden">
                          <User size={15} className="text-indigo-500 shrink-0" />
                          <strong className="text-[15px] text-indigo-700 font-black whitespace-nowrap truncate text-center min-w-0">
                            {activeUserDisplayName}
                          </strong>
                          <span className="text-slate-300 select-none shrink-0">|</span>
                          <span className="text-[12.5px] text-slate-500 font-semibold whitespace-nowrap shrink-0 ml-1.5">
                            Submitted Time : <span className="text-slate-700 font-bold">{submittedTimeStr}</span>
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 min-w-0 overflow-hidden pl-3">
                          <span className="text-[12.5px] text-slate-500 font-semibold whitespace-nowrap shrink-0 ml-1.5">
                            Submitted Time : <span className="text-slate-700 font-bold">{submittedTimeStr}</span>
                          </span>
                        </div>
                      )}

                      {/* Flexible spacer — empty; absorbs all leftover row width so the
                          stat pills / submission / status cluster below sticks to the
                          right edge on every row. */}
                      <div />

                      <span className="text-slate-300 select-none text-center">|</span>

                      {/* Worked / Not Worked / Total Project — boxed stat pills, each with
                          its own colored border (green/red/blue). Fixed-width column so
                          this trio lands in the exact same spot on every row. */}
                      <div className="flex items-center gap-2">
                        <div className="flex flex-col items-center justify-center px-3 py-1.5 rounded-xl border border-emerald-150 bg-emerald-50/50 flex-1 leading-tight">
                          <span className="text-[9.5px] font-bold text-emerald-600 uppercase tracking-wider whitespace-nowrap">Worked</span>
                          <span className="text-[16px] font-black text-emerald-600">{workedProjectCount}</span>
                        </div>
                        <div className="flex flex-col items-center justify-center px-3 py-1.5 rounded-xl border border-rose-150 bg-rose-50/50 flex-1 leading-tight">
                          <span className="text-[9.5px] font-bold text-rose-600 uppercase tracking-wider whitespace-nowrap">Not Worked</span>
                          <span className="text-[16px] font-black text-rose-600">{notWorkedProjectCount}</span>
                        </div>
                        <div className="flex flex-col items-center justify-center px-3 py-1.5 rounded-xl border border-indigo-150 bg-indigo-50/50 flex-1 leading-tight">
                          <span className="text-[9.5px] font-bold text-indigo-600 uppercase tracking-wider whitespace-nowrap">Total Project</span>
                          <span className="text-[16px] font-black text-indigo-650">{totalProjectCount}</span>
                        </div>
                      </div>

                      <span className="text-slate-300 select-none text-center">|</span>

                      {/* Submission distribution + Total Backlinks — two lines in the same
                          block: the breakdown list on top (wraps as needed), and the
                          grand total stuck to the bottom-right of the same block. Fixed
                          max-width sized to comfortably fit the worst case (every
                          submission type). Shows a dash when empty. */}
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

                        const grandTotal =
                          totalListings + totalBlogs + totalForums + totalPdfs + totalImages +
                          totalVideos + totalProfiles + totalLinks +
                          (customSubmissionTypes || []).reduce((sum, type) => sum + item.works.reduce((s: number, w: any) => s + (Number(w.customValues?.[type.id]) || 0), 0), 0);

                        return (
                          <div className="max-w-[560px] flex flex-col gap-1 pl-4">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-slate-600 font-medium">
                              {countEntries.length > 0 ? (
                                countEntries.map((entry, idx) => (
                                  <React.Fragment key={entry.label}>
                                    {idx > 0 && <span className="text-slate-300">•</span>}
                                    <span title={entry.label} className="whitespace-nowrap">
                                      <span className="font-bold text-slate-800">{entry.value}</span> {entry.label}
                                    </span>
                                  </React.Fragment>
                                ))
                              ) : (
                                <span className="text-slate-350">—</span>
                              )}
                            </div>

                            {grandTotal > 0 && (
                              <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                                <Layers size={13} className="text-indigo-400 shrink-0" />
                                <span className="text-[12.5px] font-bold text-indigo-700">{grandTotal} Total Backlinks</span>
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      <span className="text-slate-300 select-none text-center">|</span>

                      {/* Status + expand toggle — column is "max-content" width, i.e. it
                          takes exactly the space it needs and no more (no forced fixed
                          width / no wasted space), and sits right after the submission
                          block since both are now clustered together at the row's right
                          edge. The badge itself has a shared min-width + text-center so
                          "PENDING" and "APPROVED" (etc.) render at the same size instead
                          of looking uneven row to row. */}
                      <div className="flex items-center gap-2.5">
                        {item.status && (
                          <span className={`text-[10.5px] uppercase font-bold px-2.5 py-1.5 rounded-lg border tracking-wider font-sans whitespace-nowrap min-w-[96px] text-center ${
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
                          className="flex items-center justify-center p-2 bg-slate-50 border border-slate-200 hover:bg-slate-100 text-slate-500 rounded-lg transition shrink-0"
                        >
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
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
                                              {cleanDomain(workMatchedProj.domain)}
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

                                    const rawKeywords = work.selectedKeywords || work.customValues?.selectedKeywords || [];
                                    const keywordsList = (Array.isArray(rawKeywords)
                                      ? rawKeywords
                                      : (typeof rawKeywords === 'string' ? rawKeywords.split(',').map((s: string) => s.trim()) : [])
                                    ).filter(Boolean) as string[];
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
                                  {(() => {
                                    const contentUpdatesArr = Array.isArray(work.contentUpdates)
                                      ? work.contentUpdates
                                      : (typeof work.contentUpdates === 'string' && work.contentUpdates
                                          ? work.contentUpdates.split(',').map((s: string) => s.trim()).filter(Boolean)
                                          : []);
                                    if (contentUpdatesArr.length === 0) return null;
                                    return (
                                      <div className="space-y-1.5">
                                        <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest">Content Update</h4>
                                        <div className="flex flex-wrap items-baseline gap-1.5">
                                          <span className="text-[10.5px] font-bold text-slate-600 font-sans">
                                            {contentUpdatesArr.map((cu: string) => CONTENT_UPDATE_LABELS[cu] || cu).join(', ')}
                                          </span>
                                        </div>
                                      </div>
                                    );
                                  })()}
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
