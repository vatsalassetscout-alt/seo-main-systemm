/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Project, DSREntry, ProjectWork, CustomSubmissionType, AppUser, ProjectLocation } from './types';
import {
  DEFAULT_PROJECTS,
  INITIAL_DSR_ENTRIES,
  ADMIN_EMAILS,
} from './data';
import DSRForm from './components/DSRForm';
import DSRLogs from './components/DSRLogs';
import DSRDashboard from './components/DSRDashboard';
import DSRSettings from './components/DSRSettings';
import LoginScreen from './components/LoginScreen';
import { initAuth, googleSignIn, getAccessToken, logout } from './lib/firebase';
import { getUserDisplayName, registerNamesFromProjects, doesUserMatch } from './lib/userUtils';
import {
  fetchProjectsFromSheet,
  fetchSubmissionsFromSheet,
  appendSubmissionsToSheet,
  fetchLocationsFromSheet
} from './lib/sheetsService';
import {
  LayoutGrid,
  PenTool,
  Database,
  Sliders,
  Shield,
  User,
  LogOut,
  FileSpreadsheet,
  Building2,
  HardDriveUpload,
  UserCheck,
  Bell,
  RefreshCw,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const mapUsersFromProjects = (projectsList: any[]): AppUser[] => {
  const usersMap = new Map<string, string>();
  
  // Parse dynamic mappings from fetched projects — the Sheet is the only source.
  projectsList.forEach(p => {
    if (p.userId && String(p.userId).trim()) {
      const uId = String(p.userId).trim().toLowerCase();
      if (p.users && p.users.length > 0) {
        // Find the first non-ID name in users array
        const primaryName = p.users.find((u: string) => !/^\d+$/.test(u.trim())) || p.users[0];
        const formattedName = primaryName
          .split(' ')
          .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ');
        usersMap.set(uId, formattedName);
      }
    }
  });

  return Array.from(usersMap.entries()).map(([userId, name]) => {
    let finalName = name;
    const resolved = getUserDisplayName(userId, []);
    if (resolved && !resolved.startsWith("User ")) {
      finalName = resolved;
    }
    return {
      email: userId,
      name: finalName
    };
  });
};

export default function App() {
  // Global States (synchronized with localStorage)
  const [adminEmails, setAdminEmails] = useState<string[]>(() => {
    const saved = localStorage.getItem('dsr_admin_emails');
    const savedList: string[] = saved ? JSON.parse(saved) : [];
    // Merge hardcoded ADMIN_EMAILS to always keep new configurations accessible
    const merged = Array.from(new Set([...savedList, ...ADMIN_EMAILS]));
    return merged;
  });

  const [projects, setProjects] = useState<Project[]>(() => {
    const saved = localStorage.getItem('dsr_projects');
    const parsed = saved ? JSON.parse(saved) : DEFAULT_PROJECTS;
    if (Array.isArray(parsed)) {
      const filtered = parsed.filter((p: any) => p && p.id !== "titan-realestate" && p.id !== "aerospace-craft" && p.id !== "clean-energy");
      const map = new Map<string, Project>();
      filtered.forEach((p: any) => {
        if (p && p.id) {
          if (map.has(p.id)) {
            const existing = map.get(p.id)!;
            const combinedUsers = Array.from(new Set([
              ...(existing.users || []),
              ...(p.users || [])
            ].map(u => String(u).trim().toLowerCase())));
            map.set(p.id, { ...existing, ...p, users: combinedUsers });
          } else {
            map.set(p.id, p);
          }
        }
      });
      return Array.from(map.values());
    }
    return [];
  });

  const [allowedUsers, setAllowedUsers] = useState<AppUser[]>(() => {
    const saved = localStorage.getItem('dsr_allowed_users');
    return saved ? JSON.parse(saved) : [];
  });

  const [projectLocations, setProjectLocations] = useState<ProjectLocation[]>(() => {
    const saved = localStorage.getItem('dsr_project_locations');
    return saved ? JSON.parse(saved) : [];
  });

  const [customSubmissionTypes, setCustomSubmissionTypes] = useState<CustomSubmissionType[]>(() => {
    const saved = localStorage.getItem('dsr_custom_submission_types');
    return saved ? JSON.parse(saved) : [];
  });

  const [sheetSettings, setSheetSettings] = useState(() => {
    const saved = localStorage.getItem('dsr_sheet_settings');
    const defaultSpreadsheetId = '1ZkP1c8lBFnqEbXvMx83Zz-uuYU16xqQBsZW9lAqeuwU';
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return {
          projectsSpreadsheetId: parsed.projectsSpreadsheetId || parsed.spreadsheetId || defaultSpreadsheetId,
          logsSpreadsheetId: parsed.logsSpreadsheetId || parsed.spreadsheetId || defaultSpreadsheetId,
          spreadsheetId: parsed.spreadsheetId || defaultSpreadsheetId,
          projectsTab: parsed.projectsTab || 'Projects_Mapping',
          submissionsTab: parsed.submissionsTab || 'DSR_Logs',
          locationsTab: parsed.locationsTab || 'Locations',
          isConnected: true
        };
      } catch (e) {
        // ignore fallback
      }
    }
    return {
      projectsSpreadsheetId: defaultSpreadsheetId,
      logsSpreadsheetId: defaultSpreadsheetId,
      spreadsheetId: defaultSpreadsheetId,
      projectsTab: 'Projects_Mapping',
      submissionsTab: 'DSR_Logs',
      locationsTab: 'Locations',
      isConnected: true
    };
  });

  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginValidationError, setLoginValidationError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const [alerts, setAlerts] = useState<any[]>(() => {
    try {
      const saved = localStorage.getItem('dsr_admin_alerts');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [showNotifications, setShowNotifications] = useState(false);
  const [assignmentPreFill, setAssignmentPreFill] = useState<{ projectId: string; date: string } | null>(null);
  const [focusLogKey, setFocusLogKey] = useState<string | null>(null);

  const notificationsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        showNotifications &&
        notificationsRef.current &&
        !notificationsRef.current.contains(event.target as Node)
      ) {
        setShowNotifications(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showNotifications]);

  useEffect(() => {
    localStorage.setItem('dsr_admin_alerts', JSON.stringify(alerts));
  }, [alerts]);

  const handleAddAlert = (alert: any) => {
    setAlerts(prev => [alert, ...prev]);
    fetch("/api/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alert })
    }).catch(err => console.warn("Failed syncing new alert to backend fallback:", err));
  };

  const handleMarkAllAlertsAsRead = () => {
    setAlerts(prev => prev.map(a => ({ ...a, read: true })));
    fetch("/api/alerts/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true })
    }).catch(err => console.warn("Failed marking all alerts as read on backend:", err));
  };

  const handleClearAlert = (id: string) => {
    setAlerts(prev => prev.filter(a => a.id !== id));
    fetch("/api/alerts/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id })
    }).catch(err => console.warn("Failed deleting alert on backend:", err));
  };

  const handleClearMultipleAlerts = (ids: string[]) => {
    setAlerts(prev => prev.filter(a => !ids.includes(a.id)));
    fetch("/api/alerts/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids })
    }).catch(err => console.warn("Failed bulk deleting alerts on backend:", err));
  };

  const [entries, setEntries] = useState<DSREntry[]>(() => {
    const saved = localStorage.getItem('dsr_entries');
    if (!saved) return INITIAL_DSR_ENTRIES;
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        const migrated = parsed.map((entry: any) => {
          // If already format-compliant, return as is
          if (entry && entry.userEmail && Array.isArray(entry.works)) {
            return entry as DSREntry;
          }

          // Convert a legacy entry to the modern multi-work layout
          const userEmail = entry?.userEmail || entry?.employeeEmail || (entry?.employeeName ? `${entry.employeeName.toLowerCase().replace(/\s+/g, '.')}@company.com` : 'user@company.com');
          
          let works = entry?.works;
          if (!Array.isArray(works)) {
            works = [
              {
                id: `work-legacy-${entry?.id || Date.now()}`,
                projectId: entry?.projectId || 'proj-1',
                projectName: entry?.projectName || 'Phoenix Redesign',
                listingCount: typeof entry?.metric1 === 'number' ? entry.metric1 : (typeof entry?.metric2 === 'number' ? entry.metric2 : 100),
                blog: entry?.notes || entry?.blog || 'Completed legacy task activities logged dynamically.',
                customValues: entry?.customValues || {},
              }
            ];
          }

          return {
            id: entry?.id || `dsr-legacy-${Date.now()}-${Math.random()}`,
            date: entry?.date || new Date().toISOString().split('T')[0],
            userEmail,
            works,
            createdAt: entry?.createdAt || new Date().toISOString(),
          } as DSREntry;
        });

        // Filter out any works and logs that refer to dummy hardcoded projects
        return migrated
          .map((entry) => {
            const filteredWorks = entry.works.filter(
              (w) =>
                w.projectId !== 'titan-realestate' &&
                w.projectId !== 'aerospace-craft' &&
                w.projectId !== 'clean-energy' &&
                w.projectId !== 'proj-1'
            );
            return { ...entry, works: filteredWorks };
          })
          .filter((entry) => entry.works && entry.works.length > 0);
      }
    } catch (e) {
      console.error("Failed to parse or migrate saved entries:", e);
    }
    return INITIAL_DSR_ENTRIES;
  });

  // Helper to auto-register a user on successful login
  const registerLoggedInUser = (email: string, initialName?: string) => {
    const emailLower = email.trim().toLowerCase();
    const isAlreadyAllowed = allowedUsers.some(u => u.email.trim().toLowerCase() === emailLower);
    if (!isAlreadyAllowed) {
      let defaultName = initialName;
      if (!defaultName) {
        const prefix = emailLower.split('@')[0];
        defaultName = prefix
          .split(/[\._\-]/)
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
      }
      setAllowedUsers((prev) => {
        if (prev.some((u) => u.email.trim().toLowerCase() === emailLower)) return prev;
        return [...prev, { email: emailLower, name: defaultName! }];
      });
    }
  };

  // Login session state
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(() => {
    return sessionStorage.getItem('dsr_logged_user') || null;
  });

  const [currentUserRole, setCurrentUserRole] = useState<'user' | 'admin' | null>(() => {
    return (sessionStorage.getItem('dsr_logged_role') as 'user' | 'admin') || null;
  });

  const [activeTab, setActiveTab] = useState<'submit' | 'logs' | 'dashboard' | 'settings'>(() => {
    const savedUser = sessionStorage.getItem('dsr_logged_user');
    const savedRole = sessionStorage.getItem('dsr_logged_role') as 'user' | 'admin' | null;
    if (savedUser) {
      if (savedRole) {
        return savedRole === 'admin' ? 'dashboard' : 'submit';
      }
      const savedAdmins = localStorage.getItem('dsr_admin_emails');
      const admins = savedAdmins ? JSON.parse(savedAdmins) : ADMIN_EMAILS;
      return admins.includes(savedUser.trim().toLowerCase()) ? 'dashboard' : 'submit';
    }
    return 'submit';
  });

  const [dashboardSubTab, setDashboardSubTab] = useState<'project_table' | 'frequency' | 'activity' | 'backlinks' | 'unworked_project' | 'keyword_section' | 'update_ranking'>('project_table');

  // Synchronize dynamic data from our local database server
  const syncWithBackend = async () => {
    setIsSyncing(true);
    try {
      // 1. Fetch admin access configuration from backend (admin gating only —
      //    regular user list always comes from the Sheet via /api/filters below).
      try {
        const authConfRes = await fetch("/api/auth/config");
        if (authConfRes.ok) {
          const authConfData = await authConfRes.json();
          if (authConfData.allowedAdmins) {
            setAdminEmails(authConfData.allowedAdmins);
          }
        }
      } catch (authErr) {
        console.warn("Express auth config endpoint deferred:", authErr);
      }

      const syncHeaders: Record<string, string> = {};
      if (currentUserEmail) {
        syncHeaders["x-user-email"] = currentUserEmail;
      }
      if (currentUserRole) {
        syncHeaders["x-user-role"] = currentUserRole;
      }

      // 2. Fetch projects and filters from backend
      try {
        const filterRes = await fetch("/api/filters", { headers: syncHeaders });
        if (filterRes.ok) {
          const filterData = await filterRes.json();
          if (filterData) {
            if (filterData.projects && Array.isArray(filterData.projects)) {
              setProjects(filterData.projects);
              localStorage.setItem('dsr_projects', JSON.stringify(filterData.projects));
              
              const locationsList = filterData.projects.map((p: any) => ({
                projectId: p.id,
                north: p.location || "Mumbai",
                west: p.region || "West"
              }));
              setProjectLocations(locationsList);
              localStorage.setItem('dsr_project_locations', JSON.stringify(locationsList));
            }

            if (filterData.users && Array.isArray(filterData.users)) {
              // Sheet-derived users only — no hardcoded email list merged in.
              setAllowedUsers(filterData.users);
              localStorage.setItem('dsr_allowed_users', JSON.stringify(filterData.users));
            }
          }
        }
      } catch (errFilter) {
        console.warn("Express filters endpoint deferred:", errFilter);
      }

      // 3. Fetch submissions from backend
      try {
        const subRes = await fetch("/api/submissions", { headers: syncHeaders });
        if (subRes.ok) {
          const loadedEntries = await subRes.json();
          if (loadedEntries && Array.isArray(loadedEntries)) {
            setEntries(loadedEntries);
            localStorage.setItem('dsr_entries', JSON.stringify(loadedEntries));
          }
        }
      } catch (subErr) {
        console.warn("Express submissions endpoint deferred:", subErr);
      }

      // 4. Fetch alerts
      try {
        const alertRes = await fetch("/api/alerts");
        if (alertRes.ok) {
          const loadedAlerts = await alertRes.json();
          if (loadedAlerts && Array.isArray(loadedAlerts)) {
            setAlerts(loadedAlerts);
          }
        }
      } catch (alertErr) {
        console.warn("Express alerts endpoint deferred:", alertErr);
      }
    } catch (err) {
      console.error("Local sync with backend failed:", err);
    } finally {
      setIsSyncing(false);
    }
  };

  // Run on mount or when logged user changes
  useEffect(() => {
    syncWithBackend();
    
    const savedUser = sessionStorage.getItem('dsr_logged_user');
    if (savedUser) {
      setCurrentUserEmail(savedUser.trim().toLowerCase());
    }
  }, []);

  // Sync when user states change to double-check their project assignments
  useEffect(() => {
    if (currentUserEmail) {
      syncWithBackend();
    }
  }, [currentUserEmail]);

  // Load and cache Auth automatically
  useEffect(() => {
    initAuth(async (user) => {
      if (user && user.email) {
        const userEmail = user.email.trim().toLowerCase();
        registerLoggedInUser(userEmail, user.displayName || undefined);
        setCurrentUserEmail(userEmail);
        syncWithBackend();
      }
    }, () => {
      // Sign-out action
    });
  }, [adminEmails]);

  // Sync states triggers
  useEffect(() => {
    localStorage.setItem('dsr_admin_emails', JSON.stringify(adminEmails));
  }, [adminEmails]);

  useEffect(() => {
    localStorage.setItem('dsr_projects', JSON.stringify(projects));
    if (projects && projects.length > 0) {
      registerNamesFromProjects(projects);
    }
    const dynamicUsers = mapUsersFromProjects(projects);
    // Merge instead of overwrite, so users loaded from /api/filters
    // (e.g. the currently logged in user) are never dropped from the list.
    setAllowedUsers(prev => {
      const uniqueMap = new Map<string, AppUser>();
      [...prev, ...dynamicUsers].forEach(user => {
        uniqueMap.set(user.email.toLowerCase().trim(), user);
      });
      return Array.from(uniqueMap.values());
    });
  }, [projects]);

  useEffect(() => {
    localStorage.setItem('dsr_allowed_users', JSON.stringify(allowedUsers));
  }, [allowedUsers]);

  useEffect(() => {
    localStorage.setItem('dsr_project_locations', JSON.stringify(projectLocations));
  }, [projectLocations]);

  useEffect(() => {
    localStorage.setItem('dsr_custom_submission_types', JSON.stringify(customSubmissionTypes));
  }, [customSubmissionTypes]);

  useEffect(() => {
    localStorage.setItem('dsr_sheet_settings', JSON.stringify(sheetSettings));
  }, [sheetSettings]);

  useEffect(() => {
    localStorage.setItem('dsr_entries', JSON.stringify(entries));
  }, [entries]);

  useEffect(() => {
    if (currentUserEmail) {
      sessionStorage.setItem('dsr_logged_user', currentUserEmail);
    } else {
      sessionStorage.removeItem('dsr_logged_user');
      sessionStorage.removeItem('dsr_logged_role');
    }
  }, [currentUserEmail]);

  // Derived user parameters
  const isAdmin = currentUserRole === 'admin';
  
  // Filter projects by whether the user is assigned to them in the Sheets database project mapping
  const filteredProjectsForUser = useMemo(() => {
    if (!currentUserEmail) return [];
    
    // Admins always see ALL projects/domains
    if (isAdmin) return projects;

    return projects.filter((p) => {
      const assigned = Array.isArray(p.users) ? p.users : [];
      const matchesUsers = assigned.some((u: string) => doesUserMatch(u, currentUserEmail, allowedUsers));
      const matchesUserId = p.userId && doesUserMatch(String(p.userId), currentUserEmail, allowedUsers);
      return matchesUsers || matchesUserId;
    });
  }, [projects, currentUserEmail, isAdmin, allowedUsers]);
  
  // Active Project Assignment tasks for the currently logged in user
  const activeAssignmentAlerts = useMemo(() => {
    if (!currentUserEmail) return [];
    
    return alerts.filter(alert => {
      if (alert.alertType !== 'project_assignment') return false;
      const lowerEmail = (alert.userEmail || '').trim().toLowerCase();
      if (!doesUserMatch(lowerEmail, currentUserEmail, allowedUsers)) return false;

      // Check if user has already submitted a work log for this project on this target date,
      // AFTER this assignment alert was created (older/unrelated logs don't count as fulfilling it)
      const isFulfilled = entries.some(entry => {
        const entryUserLower = (entry.userEmail || '').trim().toLowerCase();
        const matchesUser = doesUserMatch(entryUserLower, currentUserEmail, allowedUsers);
        const matchesDate = entry.date === alert.date;
        const hasProject = (entry.works || []).some(w => String(w.projectId) === String(alert.projectId));
        const isAfterAssignment = new Date(entry.createdAt) >= new Date(alert.createdAt);
        return matchesUser && matchesDate && hasProject && isAfterAssignment;
      });

      return !isFulfilled;
    });
  }, [alerts, entries, currentUserEmail, allowedUsers]);

  // Filter alerts by role & ownership:
  // - Admins can see EVERY alert raised in the system (all users' notifications).
  // - A regular user can only ever see the alerts/notifications addressed to THEM.
  //   (Assignment alerts are additionally auto-hidden once the user has fulfilled them.)
  const visibleAlerts = useMemo(() => {
    if (!currentUserEmail) return [];

    return alerts.filter(alert => {
      // Admins can view all users' alerts — no restriction for them.
      if (isAdmin) {
        if (alert.alertType === 'project_assignment') {
          // Still hide fulfilled assignment alerts even for admins, since they're just noise once done.
          const isFulfilled = entries.some(entry => {
            const matchesDate = entry.date === alert.date;
            const hasProject = (entry.works || []).some(w => String(w.projectId) === String(alert.projectId));
            const matchesAssignedUser = doesUserMatch((entry.userEmail || '').trim().toLowerCase(), (alert.userEmail || '').trim().toLowerCase(), allowedUsers);
            const isAfterAssignment = new Date(entry.createdAt) >= new Date(alert.createdAt);
            return matchesAssignedUser && matchesDate && hasProject && isAfterAssignment;
          });
          return !isFulfilled;
        }
        return true;
      }

      // --- Non-admin (regular user) restrictions below ---

      if (alert.alertType === 'project_assignment') {
        const lowerEmail = (alert.userEmail || '').trim().toLowerCase();
        if (!doesUserMatch(lowerEmail, currentUserEmail, allowedUsers)) return false;

        const isFulfilled = entries.some(entry => {
          const entryUserLower = (entry.userEmail || '').trim().toLowerCase();
          const matchesUser = doesUserMatch(entryUserLower, currentUserEmail, allowedUsers);
          const matchesDate = entry.date === alert.date;
          const hasProject = (entry.works || []).some(w => String(w.projectId) === String(alert.projectId));
          const isAfterAssignment = new Date(entry.createdAt) >= new Date(alert.createdAt);
          return matchesUser && matchesDate && hasProject && isAfterAssignment;
        });
        return !isFulfilled;
      }

      // "user_message" alerts are messages a user sent TO the admin — never shown back to any user.
      if (alert.alertType === 'user_message') return false;

      // "admin_remark" (and any other user-targeted alert type) — only visible to the exact
      // user it was addressed to. This is the key fix: a user must NEVER see another user's alert.
      const lowerEmail = (alert.userEmail || '').trim().toLowerCase();
      if (!lowerEmail) return false; // no owner on the alert → don't leak it to everyone
      return doesUserMatch(lowerEmail, currentUserEmail, allowedUsers);
    });
  }, [alerts, entries, currentUserEmail, isAdmin, allowedUsers]);

  const unreadCount = visibleAlerts.filter(a => !a.read).length;
  const [filteredLogsCount, setFilteredLogsCount] = useState<number | null>(null);

  // Actions
  const recordLoginActivity = (userEmail: string, role: 'user' | 'admin') => {
    fetch("/api/activity/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userEmail, role })
    }).catch((err) => console.warn("Failed to record login timestamp:", err));
  };

  const handleLogin = async (email: string, role: 'user' | 'admin') => {
    const emailLower = email.trim().toLowerCase();
    setLoginValidationError(null);
    setIsLoggingIn(true);

    try {
      if (role === 'admin') {
        const isAdminEmail = emailLower === '8888' ||
                             adminEmails.some((a) => a.trim().toLowerCase() === emailLower) ||
                             ADMIN_EMAILS.some((a) => a.trim().toLowerCase() === emailLower);
        if (!isAdminEmail) {
          throw new Error(`Access Denied: The ID/Email "${emailLower}" is not registered as an Administrator.`);
        }

        registerLoggedInUser(emailLower);
        setCurrentUserEmail(emailLower);
        setCurrentUserRole('admin');
        sessionStorage.setItem('dsr_logged_role', 'admin');
        setActiveTab('dashboard');
        recordLoginActivity(emailLower, 'admin');
      } else {
        const validIds = ["1859", "9531", "5595", "4001"];
        const isAllowedUser = validIds.includes(emailLower) || 
                             allowedUsers.some((u) => u.email.trim().toLowerCase() === emailLower) ||
                             projects.some((p) => p.userId && String(p.userId).trim().toLowerCase() === emailLower);
        if (!isAllowedUser) {
          throw new Error(`Access Denied: The ID "${emailLower}" is not authorized.`);
        }

        registerLoggedInUser(emailLower);

        setCurrentUserEmail(emailLower);
        setCurrentUserRole('user');
        sessionStorage.setItem('dsr_logged_role', 'user');
        setActiveTab('submit');
        recordLoginActivity(emailLower, 'user');
      }

      // Attempt background backend synchronization without blocking
      syncWithBackend().catch((err) => {
        console.warn("Background sheet sync was deferred on login:", err);
      });
    } catch (err: any) {
      console.error(err);
      setLoginValidationError(err.message || String(err));
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch (e) {
      // silent catch for local logins
    }
    setCurrentUserEmail(null);
    setCurrentUserRole(null);
    setLoginValidationError(null);
    sessionStorage.removeItem('dsr_logged_user');
    sessionStorage.removeItem('dsr_logged_role');
  };

  const handleAddCustomSubmissionType = (type: CustomSubmissionType) => {
    setCustomSubmissionTypes((prev) => [...prev, type]);
  };

  const handleDeleteCustomSubmissionType = (id: string) => {
    setCustomSubmissionTypes((prev) => prev.filter(t => t.id !== id));
  };

  const handleUpdateSheetSettings = (settings: typeof sheetSettings) => {
    setSheetSettings(settings);
  };

  // Google SSO authenticator
  const handleGoogleSignIn = async () => {
    setIsLoggingIn(true);
    setLoginValidationError(null);
    try {
      const result = await googleSignIn();
      if (result && result.user && result.user.email) {
        const userEmail = result.user.email.trim().toLowerCase();

        const isAdminEmail = adminEmails.some((a) => a.trim().toLowerCase() === userEmail) ||
                             ADMIN_EMAILS.some((a) => a.trim().toLowerCase() === userEmail);
        const isAllowedUser = allowedUsers.some((u) => u.email.trim().toLowerCase() === userEmail);

        let finalRole: 'user' | 'admin' | null = null;
        if (isAdminEmail) {
          finalRole = 'admin';
        } else if (isAllowedUser) {
          finalRole = 'user';
        }

        if (!finalRole) {
          await logout();
          throw new Error(`Access Denied: Google account "${userEmail}" is not authorized to access this workspace.`);
        }

        recordLoginActivity(userEmail, finalRole);

        const resolvedName = getUserDisplayName(userEmail, allowedUsers) || result.user.displayName || userEmail;

        registerLoggedInUser(userEmail, resolvedName);
        setCurrentUserEmail(userEmail);
        setCurrentUserRole(finalRole);
        sessionStorage.setItem('dsr_logged_role', finalRole);
        setActiveTab(finalRole === 'admin' ? 'dashboard' : 'submit');

        await syncWithBackend();
      }
    } catch (err: any) {
      console.error(err);
      setLoginValidationError(err.message || String(err));
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleTriggerSync = async () => {
    // This button is now the ONLY place that pulls fresh data from the Google
    // Sheet into Supabase. Regular loads/polling (syncWithBackend elsewhere)
    // just read the database as-is, so manual DB edits/deletes stick permanently
    // until you explicitly click this to re-import from the Sheet.
    setIsSyncing(true);
    try {
      const syncHeaders: Record<string, string> = {};
      if (currentUserEmail) syncHeaders["x-user-email"] = currentUserEmail;
      if (currentUserRole) syncHeaders["x-user-role"] = currentUserRole;

      const res = await fetch("/api/projects/sync-from-sheet", {
        method: "POST",
        headers: syncHeaders,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        console.error("Sync from Sheet failed:", errData.error || res.statusText);
      }
    } catch (err) {
      console.error("Sync from Sheet request failed:", err);
    } finally {
      // Pull the (now possibly updated) DB state into the app
      await syncWithBackend();
    }
  };

  const handleAddDSR = async (worksData: Omit<ProjectWork, 'id'>[], date: string) => {
    if (!currentUserEmail) return;

    // Resolve the user's assigned employee name (the correct name as in the sheet schema)
    const resolvedName = getUserDisplayName(currentUserEmail, allowedUsers) || currentUserEmail;

    // Build the clean works subrecords with unique stable IDs
    const worksWithIds: ProjectWork[] = worksData.map((w, index) => ({
      ...w,
      id: `work-sub-${Date.now()}-${index}-${Math.round(Math.random() * 1000)}`,
    }));

    const newEntry: DSREntry = {
      id: `dsr-${Date.now()}`,
      date,
      userEmail: currentUserEmail, // Store under the actual unique user email/ID
      works: worksWithIds,
      createdAt: new Date().toISOString(),
    };

    // Save locally immediately
    setEntries((prev) => [newEntry, ...prev]);

    // Send to Local Database Server
    try {
      await fetch('/api/submissions/append', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          works: worksData,
          date,
          userEmail: currentUserEmail,
        }),
      });
      await syncWithBackend().catch((e) => console.warn(e));
    } catch (err) {
      console.warn('Backend local database append failed, cached locally:', err);
    }
  };

  const handleDeleteDSR = async (id: string) => {
    if (!currentUserEmail) return;

    // Remove immediately from local UI state so it disappears right away
    const previousEntries = entries;
    setEntries((prev) => prev.filter((e) => e.id !== id));

    try {
      const res = await fetch(`/api/submissions/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: {
          'x-user-email': currentUserEmail,
          'x-user-role': currentUserRole || '',
        },
      });

      if (!res.ok) {
        // Roll back the optimistic removal if the backend/DB delete failed
        console.error(`Failed to delete submission "${id}" from the database.`);
        setEntries(previousEntries);
        return;
      }

      const data = await res.json();
      if (data.list && Array.isArray(data.list)) {
        setEntries(data.list);
        localStorage.setItem('dsr_entries', JSON.stringify(data.list));
      }

      // Re-sync everything (alerts/activity feed etc.) so the deletion is reflected app-wide
      await syncWithBackend().catch((e) => console.warn(e));
    } catch (err) {
      console.error('Error deleting DSR log:', err);
      setEntries(previousEntries);
    }
  };

  const handleSendRemark = (item: any, message: string) => {
    const trimmed = message.trim();
    if (!trimmed) return;

    const alert = {
      id: `remark_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userEmail: item.userEmail,
      message: trimmed,
      alertType: 'admin_remark',
      adminEmail: currentUserEmail || 'Admin',
      date: item.filledForDate,
      createdAt: new Date().toISOString(),
      read: false,
    };
    handleAddAlert(alert);

    // Mark the log itself with a "Remark" status so it's visually distinct from Pending/Approved
    (item.entryIds || []).forEach((id: string) => {
      handleUpdateDSRStatus(id, 'Remark' as any);
    });
  };

  const handleUpdateDSRStatus = async (id: string, status: 'Pending' | 'Approved' | 'Needs Revision' | 'Remark') => {
    const previousEntries = entries;

    // Optimistic update so the admin sees the change immediately
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, status } : e))
    );

    try {
      const res = await fetch(`/api/submissions/${encodeURIComponent(id)}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-user-email': currentUserEmail || '',
          'x-user-role': currentUserRole || '',
        },
        body: JSON.stringify({ status }),
      });

      if (!res.ok) {
        console.error(`Failed to persist status "${status}" for submission "${id}" to the database.`);
        setEntries(previousEntries);
        return;
      }

      const data = await res.json();
      if (data.list && Array.isArray(data.list)) {
        setEntries(data.list);
        localStorage.setItem('dsr_entries', JSON.stringify(data.list));
      }

      await syncWithBackend().catch((e) => console.warn(e));
    } catch (err) {
      console.error('Error updating DSR status:', err);
      setEntries(previousEntries);
    }
  };

  const handleSendUserMessage = (message: string) => {
    if (!currentUserEmail || !message.trim()) return;
    const userName = getUserDisplayName(currentUserEmail, allowedUsers);
    const newAlert = {
      id: `usr-msg-${Date.now()}-${Math.round(Math.random() * 10000)}`,
      alertType: 'user_message',
      projectName: 'Message from User',
      projectDomain: userName,
      adminEmail: currentUserEmail,
      message: message.trim(),
      createdAt: new Date().toISOString(),
      read: false
    };
    setAlerts((prev) => [newAlert, ...prev]);
  };

  // Admin Project Registry callbacks
  const handleAddProject = (newProj: Omit<Project, 'id'>) => {
    const project: Project = {
      ...newProj,
      id: `proj-${Date.now()}`,
    };
    setProjects((prev) => [...prev, project]);
  };

  const handleUpdateProject = async (updatedProject: Project) => {
    setProjects((prev) =>
      prev.map((p) => (p.id === updatedProject.id ? updatedProject : p))
    );
    try {
      const spreadsheetId = localStorage.getItem('dsr_projects_spreadsheet_id') || localStorage.getItem('dsr_spreadsheet_id') || '';
      const projectsTab = localStorage.getItem('dsr_projects_tab') || 'Projects_Mapping';
      const syncHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-spreadsheet-id': spreadsheetId,
        'x-projects-tab': projectsTab,
      };

      await fetch("/api/projects", {
        method: "POST",
        headers: syncHeaders,
        body: JSON.stringify({
          action: "edit",
          project: updatedProject
        })
      });
    } catch (err) {
      console.error("Failed to update project priority/frequency:", err);
    }
  };

  const handleDeleteProject = (id: string) => {
    if (window.confirm('Deleting this project will prevent future DSR submissions from tagging it. Continue?')) {
      setProjects((prev) => prev.filter((p) => p.id !== id));
    }
  };

  // Admin Registry Dynamic modification
  const handleAddAdminEmail = (email: string) => {
    setAdminEmails((prev) => [...prev, email]);
  };

  const handleDeleteAdminEmail = (email: string) => {
    if (window.confirm(`Revoke admin clearance privileges for email ${email}?`)) {
      setAdminEmails((prev) => prev.filter((e) => e !== email));
    }
  };

  const handleResetToDefault = async () => {
    if (window.confirm('Reset workspace database? This will clear all data, including work log history, alerts, custom types, and users to start completely fresh.')) {
      try {
        await fetch("/api/reset-database", {
          method: "POST",
          headers: currentUserEmail ? { "x-user-email": currentUserEmail } : {}
        });
      } catch (err) {
        console.error("Failed to reset backend database:", err);
      }

      localStorage.clear();
      window.location.reload();
    }
  };

  // Render Login state first if session is missing
  if (!currentUserEmail) {
    return (
      <LoginScreen
        onLogin={handleLogin}
        adminEmails={adminEmails}
        allowedUsers={allowedUsers}
        onGoogleSignIn={handleGoogleSignIn}
        isLoggingIn={isLoggingIn}
        loginError={loginValidationError}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gray-50/50 text-gray-900 font-sans selection:bg-indigo-105 selection:text-indigo-900">

      {/* Main header block */}
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-gray-150">
        <div className="max-w-[1536px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            
            {/* Left side: branding */}
            <div className="flex items-center">
              <img 
                src="https://assetscout.in/assets/images/Assetscout%20Logo%20Black.webp" 
                alt="Assetscout Logo" 
                className="h-7 sm:h-8 w-auto object-contain block dark-logo-invert"
                referrerPolicy="no-referrer"
              />
            </div>

            {/* Middle navigation tabs */}
            <nav className="hidden md:flex space-x-1" aria-label="Global Workspace Navigation">
              {!isAdmin && (
                <button
                  id="tab-submit"
                  onClick={() => setActiveTab('submit')}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold cursor-pointer transition ${
                    activeTab === 'submit'
                      ? 'bg-indigo-50 text-indigo-700'
                      : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'
                  }`}
                >
                  <PenTool size={14} />
                  Work Log Submission
                </button>
              )}

              <button
                id="tab-logs"
                onClick={() => setActiveTab('logs')}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold cursor-pointer transition ${
                  activeTab === 'logs'
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'
                }`}
              >
                <Database size={14} />
                Work Log History
              </button>

              <button
                id="tab-dashboard"
                onClick={() => setActiveTab('dashboard')}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold cursor-pointer transition ${
                  activeTab === 'dashboard'
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'
                }`}
              >
                <LayoutGrid size={14} />
                Overview Panel
              </button>

              {isAdmin && (
                <button
                  id="tab-settings"
                  onClick={() => setActiveTab('settings')}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold cursor-pointer transition ${
                    activeTab === 'settings'
                      ? 'bg-indigo-50 text-indigo-700'
                      : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'
                  }`}
                >
                  <Sliders size={14} />
                  Admin Settings
                </button>
              )}
            </nav>

            {/* Right Side: Account Actions & Logouts */}
            <div className="flex items-center gap-3">
              {/* Manual Refresh Button */}
              <button
                onClick={handleTriggerSync}
                disabled={isSyncing}
                className="p-2 border border-gray-150 hover:bg-slate-50 text-gray-500 hover:text-indigo-600 rounded-xl transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                title="Sync from Google Sheet & refresh"
              >
                <RefreshCw size={20} className={isSyncing ? 'animate-spin' : ''} />
              </button>

              {/* Notifications Bell */}
              <div className="relative" ref={notificationsRef}>
                <button
                  onClick={() => setShowNotifications(!showNotifications)}
                  className={`p-2 border border-gray-150 hover:bg-slate-50 text-gray-500 hover:text-indigo-600 rounded-xl transition cursor-pointer relative ${showNotifications ? 'bg-indigo-50/50 text-indigo-600 border-indigo-200' : ''}`}
                  title="Notifications & Alerts"
                >
                  <Bell size={20} />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[9px] font-black text-white ring-2 ring-white">
                      {unreadCount}
                    </span>
                  )}
                </button>

                {showNotifications && (
                  <div className="absolute right-0 mt-2 sm:w-[460px] w-80 bg-white border border-gray-150 rounded-2xl shadow-xl py-4 z-50 animate-fade-in divide-y divide-gray-100 max-h-[500px] overflow-y-auto">
                    <div className="px-5 pb-3 flex justify-between items-center">
                      <span className="font-extrabold text-sm text-gray-900 uppercase tracking-wider flex items-center gap-1.5 font-sans">
                        <Bell size={16} className="text-indigo-600 animate-pulse" />
                        {isAdmin ? 'All Users\u2019 Alerts & Tasks' : 'Your Alerts & Tasks'}
                      </span>
                      <button
                        onClick={() => setShowNotifications(false)}
                        className="p-1 hover:bg-gray-100 text-gray-400 hover:text-rose-600 rounded-lg transition"
                        title="Close Notifications"
                      >
                        <X size={16} />
                      </button>
                    </div>

                    <div className="py-2 divide-y divide-gray-100">
                      {visibleAlerts.length === 0 ? (
                        <div className="px-5 py-8 text-center text-xs text-gray-400 font-medium font-mono italic">
                          No alerts or messages logged here yet.
                        </div>
                      ) : (
                        visibleAlerts.map((alert) => {
                          const isUserMsg = alert.alertType === 'user_message';
                          const isAssignment = alert.alertType === 'project_assignment';
                          const isRemark = alert.alertType === 'admin_remark';
                          return (
                            <div
                              key={alert.id}
                              className={`px-5 py-4 text-left relative hover:bg-slate-50/50 transition-colors ${!alert.read ? 'bg-indigo-50/15 font-bold' : ''}`}
                            >
                              <div className="flex justify-between items-start gap-3">
                                <div className="space-y-1">
                                  {isUserMsg ? (
                                    <span className="inline-block bg-emerald-50 text-emerald-800 font-black px-2 py-0.5 rounded-lg text-[9px] uppercase tracking-wider border border-emerald-100 shadow-3xs">
                                      📬 User Note
                                    </span>
                                  ) : isRemark ? (
                                    <span className="inline-block bg-violet-50 text-violet-800 font-black px-2 py-0.5 rounded-lg text-[9px] uppercase tracking-wider border border-violet-150 shadow-3xs">
                                      💬 Message from Admin
                                    </span>
                                  ) : (
                                    <span className="inline-block bg-amber-50 text-amber-900 font-black px-2.5 py-0.5 rounded-lg text-[10px] uppercase tracking-wider border border-amber-200 shadow-3xs">
                                      Action Required: {alert.projectName}
                                    </span>
                                  )}
                                </div>
                                {isAdmin && (
                                  <button
                                    onClick={() => handleClearAlert(alert.id)}
                                    className="text-gray-400 hover:text-rose-600 text-lg p-0.5 leading-none font-bold"
                                    title="Dismiss Alert"
                                  >
                                    &times;
                                  </button>
                                )}
                              </div>

                              <div className="mt-2 space-y-3">
                                <p className="text-xs font-bold text-gray-800 leading-relaxed whitespace-pre-wrap bg-slate-50/50 p-3 rounded-xl border border-gray-100">
                                  {alert.message}
                                </p>

                                {isAssignment && (
                                  <div className="flex items-center justify-between gap-4 pt-1">
                                    <span className="text-[9px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-0.5 font-bold font-mono uppercase">
                                      Due: {alert.date}
                                    </span>
                                    <button
                                      onClick={() => {
                                        if (isAdmin) {
                                          const emailLower = (alert.userEmail || '').trim().toLowerCase();
                                          setFocusLogKey(`group-${emailLower}-${alert.date}`);
                                          setActiveTab('logs');
                                        } else {
                                          setAssignmentPreFill({
                                            projectId: alert.projectId,
                                            date: alert.date
                                          });
                                          setActiveTab('submit');
                                        }
                                        setShowNotifications(false);
                                      }}
                                      className="whitespace-nowrap px-4 py-1.5 bg-amber-600 hover:bg-amber-700 hover:scale-[1.01] active:scale-[0.99] text-white font-extrabold rounded-lg text-[11px] transition duration-75 shadow-3xs cursor-pointer inline-flex items-center gap-1"
                                    >
                                       {isAdmin ? 'Check Log' : 'Update on log'}
                                    </button>
                                  </div>
                                )}

                                {isRemark && (
                                  <div className="flex items-center justify-end gap-4 pt-1">
                                    <button
                                      onClick={() => {
                                        const emailLower = (alert.userEmail || '').trim().toLowerCase();
                                        setFocusLogKey(`group-${emailLower}-${alert.date}`);
                                        setActiveTab('logs');
                                        setShowNotifications(false);
                                      }}
                                      className="whitespace-nowrap px-4 py-1.5 bg-violet-600 hover:bg-violet-700 hover:scale-[1.01] active:scale-[0.99] text-white font-extrabold rounded-lg text-[11px] transition duration-75 shadow-3xs cursor-pointer inline-flex items-center gap-1"
                                    >
                                      Check Remark
                                    </button>
                                  </div>
                                )}
                              </div>

                              <div className="flex justify-between items-center mt-3 text-[11px] text-gray-500 font-bold font-mono uppercase border-t border-gray-100/50 pt-2">
                                <span>
                                  {isAdmin
                                    ? `User: ${getUserDisplayName(alert.userEmail, allowedUsers) || alert.userEmail || 'Unknown'}`
                                    : (isUserMsg ? `Sender: ${alert.adminEmail === '8888' ? 'Admin' : alert.adminEmail}` : `By ${alert.adminEmail === '8888' ? 'Admin' : alert.adminEmail}`)}
                                </span>
                                <span className="text-[10px]">{new Date(alert.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                              </div>
                              {!alert.read && (
                                <span className="absolute left-1.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 bg-indigo-600 rounded-full"></span>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Profile card badge */}
              <div className="hidden lg:flex items-center gap-2.5 px-3 py-1.5 bg-gray-50 border border-gray-150 rounded-xl text-xs max-w-64">
                {isAdmin ? (
                  <Shield size={13} className="text-indigo-600 shrink-0" />
                ) : (
                  <User size={13} className="text-gray-550 shrink-0" />
                )}
                <div className="overflow-hidden leading-none text-left">
                  <span className="block font-bold text-gray-800 truncate" title={currentUserEmail || ''}>
                    {isAdmin ? 'ADMIN' : getUserDisplayName(currentUserEmail, allowedUsers)}
                  </span>
                  <span className="text-[9px] text-gray-400 font-mono mt-0.5 block uppercase tracking-wider">
                    {isAdmin ? 'Administrator' : 'Reporter Profile'}
                  </span>
                </div>
              </div>

              {/* Log out actions */}
              <button
                onClick={handleLogout}
                className="p-2 border border-gray-150 hover:bg-rose-50 text-gray-500 hover:text-rose-600 rounded-xl transition cursor-pointer"
                title="Switch Account / Sign Out"
              >
                <LogOut size={15} />
              </button>
            </div>

          </div>
        </div>
      </header>

      {/* Main app grid frame */}
      <main className="max-w-[1536px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Constant & Stable Project Assignment Alerts Banner */}
        {activeAssignmentAlerts.length > 0 && (
          <div className="mb-6 space-y-3">
            {activeAssignmentAlerts.map((alert) => (
              <div 
                key={alert.id}
                className="bg-amber-500/10 text-amber-900 border border-amber-500/20 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 font-sans shadow-2xs relative overflow-hidden"
              >
                <div className="flex items-start gap-3">
                  <span className="text-xl shrink-0 mt-0.5">🚨</span>
                  <div className="text-left">
                    <h4 className="font-extrabold text-sm text-amber-900 tracking-tight">
                      Action Required: {alert.projectName} {alert.projectDomain ? `(${alert.projectDomain})` : ''}
                    </h4>
                    <p className="text-xs text-amber-950 font-bold mt-1">
                      Work on this project for <span className="font-mono text-amber-900 bg-amber-100 border border-amber-250 px-1.5 py-0.5 rounded font-black">{alert.date}</span>
                    </p>
                    {alert.message && alert.message !== `Admin has requested that you submit a Work Log for ${alert.projectName} for the reporting date of ${alert.date}.` && (
                      <p className="text-[11px] text-amber-700 font-semibold italic mt-0.5">
                        &ldquo;{alert.message}&rdquo;
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 self-end sm:self-auto">
                  <button
                    onClick={() => {
                      setAssignmentPreFill({
                        projectId: alert.projectId,
                        date: alert.date
                      });
                      setActiveTab('submit');
                    }}
                    className="whitespace-nowrap px-4 py-2 bg-amber-600 hover:bg-amber-700 hover:scale-[1.01] active:scale-[0.99] text-white font-extrabold rounded-xl text-xs transition duration-75 shadow-xs cursor-pointer"
                  >
                     Update on log
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        
              {/* Mobile quick tab Navigation */}
        <div className="flex md:hidden bg-white p-2 rounded-2xl border border-gray-150 mb-6 gap-1 justify-around shadow-xs">
          {!isAdmin && (
            <button
              onClick={() => setActiveTab('submit')}
              className={`flex flex-col items-center gap-1 py-2 px-1 rounded-xl text-[10px] font-bold w-1/4 transition cursor-pointer ${
                activeTab === 'submit' ? 'text-indigo-600 bg-indigo-50/50' : 'text-gray-400 hover:text-gray-700'
              }`}
            >
              <PenTool size={15} />
              Work Log Entry
            </button>
          )}

          <button
            onClick={() => setActiveTab('logs')}
            className={`flex flex-col items-center gap-1 py-1.5 px-1 rounded-xl text-[10px] font-bold w-1/4 transition cursor-pointer ${
              activeTab === 'logs' ? 'text-indigo-600 bg-indigo-50/50' : 'text-gray-400 hover:text-gray-700'
            }`}
          >
            <Database size={15} />
            History Logs
          </button>

          <button
            onClick={() => setActiveTab('dashboard')}
            className={`flex flex-col items-center gap-1 py-1.5 px-1 rounded-xl text-[10px] font-bold w-1/4 transition cursor-pointer ${
              activeTab === 'dashboard' ? 'text-indigo-600 bg-indigo-50/50' : 'text-gray-400 hover:text-gray-700'
            }`}
          >
            <LayoutGrid size={15} />
            Dashboard
          </button>
          
          {isAdmin && (
            <button
              onClick={() => setActiveTab('settings')}
              className={`flex flex-col items-center gap-1 py-1.5 px-1 rounded-xl text-[10px] font-bold w-1/4 transition cursor-pointer ${
                activeTab === 'settings' ? 'text-indigo-600 bg-indigo-50/50' : 'text-gray-400 hover:text-gray-700'
              }`}
            >
              <Sliders size={15} />
              Settings
            </button>
          )}
        </div>

        {/* Dynamic header descriptions */}
        {activeTab !== 'dashboard' && (
          <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-150 pb-6">
            <div className="space-y-1">
              <h1 className="text-xl font-black text-gray-900 tracking-tight sm:text-2xl flex items-center gap-2">
                {activeTab === 'submit' && 'Work Log Submissions'}
                {activeTab === 'logs' && 'Daily Task History'}
                {activeTab === 'settings' && 'System Configuration Studio'}
              </h1>
            </div>

            <div className="flex items-center gap-2 text-xs">
              {activeTab === 'logs' && (
                <span className="bg-indigo-50 border border-indigo-200/60 text-indigo-700 px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 shadow-2xs">
                  ⚡ Total Logs: <strong>{filteredLogsCount !== null ? filteredLogsCount : 0} logs</strong>
                </span>
              )}
            </div>
          </div>
        )}

        {/* Primary Workspace View Switch */}
        <div className="min-h-[500px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.15 }}
            >
              {activeTab === 'submit' && !isAdmin && (
                <DSRForm
                  projects={filteredProjectsForUser}
                  onSubmit={handleAddDSR}
                  currentUserEmail={currentUserEmail}
                  allowedUsers={allowedUsers}
                  onViewLogs={() => setActiveTab('logs')}
                  customSubmissionTypes={customSubmissionTypes}
                  onSendAdminMessage={handleSendUserMessage}
                  preFill={assignmentPreFill}
                  onClearPreFill={() => setAssignmentPreFill(null)}
                />
              )}

              {activeTab === 'logs' && (
                <DSRLogs
                  entries={entries}
                  projects={projects}
                  onDeleteEntry={isAdmin ? handleDeleteDSR : undefined}
                  onUpdateStatus={handleUpdateDSRStatus}
                  onSendRemark={isAdmin ? handleSendRemark : undefined}
                  isAdmin={isAdmin}
                  customSubmissionTypes={customSubmissionTypes}
                  allowedUsers={allowedUsers}
                  currentUserEmail={currentUserEmail}
                  onFilteredCountChange={setFilteredLogsCount}
                  focusUniqueId={focusLogKey}
                  onFocusHandled={() => setFocusLogKey(null)}
                />
              )}

              {activeTab === 'dashboard' && (
                <DSRDashboard
                  entries={entries}
                  projects={projects}
                  allowedUsers={allowedUsers}
                  projectLocations={projectLocations}
                  isAdmin={isAdmin}
                  currentUserEmail={currentUserEmail || ''}
                  customSubmissionTypes={customSubmissionTypes}
                  alerts={alerts}
                  onAddAlert={handleAddAlert}
                  onUpdateProject={handleUpdateProject}
                  adminEmails={adminEmails}
                  activeSubTab={dashboardSubTab}
                  onSubTabChange={setDashboardSubTab}
                />
              )}

              {activeTab === 'settings' && isAdmin && (
                <DSRSettings
                  projects={projects}
                  adminEmails={adminEmails}
                  entries={entries}
                  onAddAdminEmail={handleAddAdminEmail}
                  onDeleteAdminEmail={handleDeleteAdminEmail}
                  currentUserEmail={currentUserEmail}
                  customSubmissionTypes={customSubmissionTypes}
                  onAddCustomSubmissionType={handleAddCustomSubmissionType}
                  onDeleteCustomSubmissionType={handleDeleteCustomSubmissionType}
                  sheetSettings={sheetSettings}
                  onUpdateSheetSettings={handleUpdateSheetSettings}
                  onTriggerSync={handleTriggerSync}
                  isSyncing={isSyncing}
                  allowedUsers={allowedUsers}
                  onSetAllowedUsers={setAllowedUsers}
                  projectLocations={projectLocations}
                  onSetProjectLocations={setProjectLocations}
                  onUpdateProjects={setProjects}
                  alerts={alerts}
                  onAddAlert={handleAddAlert}
                  onClearMultipleAlerts={handleClearMultipleAlerts}
                  onResetToDefault={handleResetToDefault}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

      </main>
    </div>
  );
}
