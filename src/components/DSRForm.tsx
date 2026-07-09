/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Project, ProjectWork, CustomSubmissionType, AppUser } from '../types';
import { getUserDisplayName } from '../lib/userUtils';
import {
  Calendar,
  Layers,
  Hash,
  PenTool,
  Plus,
  Image,
  CheckCircle2,
  Files,
  FileText,
  MessageSquare,
  Presentation,
  User,
  Link
} from 'lucide-react';
import { motion } from 'motion/react';

interface DSRFormProps {
  projects: Project[];
  onSubmit: (works: Omit<ProjectWork, 'id'>[], date: string) => void;
  currentUserEmail: string;
  allowedUsers?: AppUser[];
  onViewLogs?: () => void;
  customSubmissionTypes?: CustomSubmissionType[];
  onSendAdminMessage?: (message: string) => void;
  preFill?: { projectId: string; date: string } | null;
  onClearPreFill?: () => void;
}

export default function DSRForm({
  projects,
  onSubmit,
  currentUserEmail,
  allowedUsers = [],
  onViewLogs,
  customSubmissionTypes = [],
  onSendAdminMessage,
  preFill,
  onClearPreFill,
}: DSRFormProps) {
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );

  // We support single project entry in a submission session based on user preference
  const [worksList, setWorksList] = useState<any[]>([
    {
      projectId: '',
      projectName: '',
      listingCount: '',
      blogCount: '',
      forumCount: '',
      pdfCount: '',
      imageCount: '',
      videoPptCount: '',
      profileCount: '',
      linkCount: '',
      blog: '',
      customValues: {},
      workTypes: ['seo_backlink'], // default to SEO backlink submission
      contentUpdates: [],
      selectedKeywords: [],
      workSummary: '',
      extraWorkNote: '',
    }
  ]);

  const [isSuccess, setIsSuccess] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [dropdownSearch, setDropdownSearch] = useState('');

  const handleToggleContentUpdate = (index: number, type: string) => {
    setValidationError(null);
    const work = worksList[index];
    const current = work.contentUpdates || [];
    
    if (type === 'restructure') {
      const isSelected = current.includes('restructure');
      handleUpdateWorkBlock(index, { contentUpdates: isSelected ? [] : ['restructure'] });
    } else {
      const isSelected = current.includes(type);
      if (isSelected) {
        const next = current.filter((o: string) => o !== type && o !== 'restructure');
        handleUpdateWorkBlock(index, { contentUpdates: next });
      } else {
        const currentOthers = current.filter((o: string) => o !== 'restructure');
        const next = [...currentOthers, type];
        handleUpdateWorkBlock(index, { contentUpdates: next });
      }
    }
  };

  useEffect(() => {
    if (preFill && preFill.projectId) {
      setSelectedDate(preFill.date);
      const matched = projects.find(p => p.id === preFill.projectId);
      if (matched) {
        setWorksList([{
          projectId: matched.id,
          projectName: matched.name,
          listingCount: '',
          blogCount: '',
          forumCount: '',
          pdfCount: '',
          imageCount: '',
          videoPptCount: '',
          profileCount: '',
          linkCount: '',
          blog: '',
          customValues: {},
          workTypes: ['seo_backlink'],
          contentUpdates: [],
          selectedKeywords: [],
          workSummary: '',
          extraWorkNote: '',
        }]);
      }
      if (onClearPreFill) {
        onClearPreFill();
      }
    }
  }, [preFill, projects, onClearPreFill]);

  // Update item field
  const handleUpdateWorkBlock = (index: number, updates: Partial<any>) => {
    setWorksList((prev) =>
      prev.map((item, idx) => {
        if (idx !== index) return item;
        const next = { ...item, ...updates };
        
        // If changing projectId, sync projectName and reset keywords
        if (updates.projectId) {
          const matchedProj = projects.find((p) => p.id === updates.projectId);
          if (matchedProj) {
            next.projectName = matchedProj.name;
          }
          next.selectedKeywords = [];
        }
        return next;
      })
    );
  };

  const handleResetForm = () => {
    setWorksList([
      {
        projectId: '',
        projectName: '',
        listingCount: '',
        blogCount: '',
        forumCount: '',
        pdfCount: '',
        imageCount: '',
        videoPptCount: '',
        profileCount: '',
        linkCount: '',
        blog: '',
        customValues: {},
        workTypes: ['seo_backlink'],
        contentUpdates: [],
        selectedKeywords: [],
        workSummary: '',
        extraWorkNote: '',
      }
    ]);
    setIsSuccess(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    if (!selectedDate) {
      setValidationError('Please select the reporting date.');
      return;
    }

    const todayStr = new Date().toISOString().split('T')[0];
    if (selectedDate > todayStr) {
      setValidationError('You are not allowed to submit a log for a future date. Only current or previous days are permitted.');
      return;
    }

    // Validate the work entry
    const work = worksList[0];
    const extraWorkNoteTrimmed = (work.extraWorkNote || '').trim();
    const isDomainBlockUsed = !!work.projectId;

    // Either the Domain block or the Extra/New Work Done block must be filled — not both required
    if (!isDomainBlockUsed && !extraWorkNoteTrimmed) {
      setValidationError('Please either select a domain (and fill its details) or write something under "Extra / New Work Done".');
      return;
    }

    let workTypes: string[] = [];
    let hasSEO = false;
    let hasContentUpdate = false;
    let listingCount = 0, blogCount = 0, forumCount = 0, pdfCount = 0, imageCount = 0, videoPptCount = 0, profileCount = 0, linkCount = 0;
    const cleanCustomValues: Record<string, any> = {};

    const parseVal = (val: any) => {
      if (val === undefined || val === null || val === '') return 0;
      const num = Number(val);
      if (isNaN(num)) {
        return NaN;
      }
      return num;
    };

    // Only run the Domain-block-specific validations when the user actually chose a domain
    if (isDomainBlockUsed) {
      workTypes = work.workTypes || [];
      if (workTypes.length === 0) {
        setValidationError('Please select at least one Work Type (SEO Backlink and/or Content Update).');
        return;
      }

      hasSEO = workTypes.includes('seo_backlink');
      hasContentUpdate = workTypes.includes('content_update');

      listingCount = hasSEO ? parseVal(work.listingCount) : 0;
      blogCount = hasSEO ? parseVal(work.blogCount) : 0;
      forumCount = hasSEO ? parseVal(work.forumCount) : 0;
      pdfCount = hasSEO ? parseVal(work.pdfCount) : 0;
      imageCount = hasSEO ? parseVal(work.imageCount) : 0;
      videoPptCount = hasSEO ? parseVal(work.videoPptCount) : 0;
      profileCount = hasSEO ? parseVal(work.profileCount) : 0;
      linkCount = hasSEO ? parseVal(work.linkCount) : 0;

      if (hasSEO && (
        isNaN(listingCount) || isNaN(blogCount) || isNaN(forumCount) || isNaN(pdfCount) ||
        isNaN(imageCount) || isNaN(videoPptCount) || isNaN(profileCount) || isNaN(linkCount)
      )) {
        setValidationError('Please enter a valid number for all count inputs under SEO Backlink Submission.');
        return;
      }

      if (hasSEO && (
        listingCount < 0 || blogCount < 0 || forumCount < 0 || pdfCount < 0 ||
        imageCount < 0 || videoPptCount < 0 || profileCount < 0 || linkCount < 0
      )) {
        setValidationError('Negative numbers are strictly not allowed for count inputs under SEO Backlink Submission.');
        return;
      }

      if (hasContentUpdate && (!work.contentUpdates || work.contentUpdates.length === 0)) {
        setValidationError('Please select at least one content update option (check box).');
        return;
      }

      // Keyword selection is mandatory whenever the selected domain has keywords configured
      const selectedProjForKeywords = projects.find((p) => p.id === work.projectId);
      const availableKeywords = (selectedProjForKeywords?.keywords || []).filter(Boolean);
      if (availableKeywords.length > 0 && (!work.selectedKeywords || work.selectedKeywords.length === 0)) {
        setValidationError('Please select at least one keyword for the chosen domain.');
        return;
      }

      // Parse and validate custom submission types
      if (hasSEO) {
        for (const cType of customSubmissionTypes) {
          const rawVal = work.customValues?.[cType.id];
          const parsed = parseVal(rawVal);
          if (isNaN(parsed)) {
            setValidationError(`Please enter a valid number for "${cType.name}".`);
            return;
          }
          if (parsed < 0) {
            setValidationError(`Negative values are not allowed for "${cType.name}".`);
            return;
          }
          cleanCustomValues[cType.id] = parsed;
        }
      }

      // Put selectedKeywords inside customValues for flexible sheets storage if chosen
      if (work.selectedKeywords && work.selectedKeywords.length > 0) {
        cleanCustomValues['selectedKeywords'] = work.selectedKeywords;
      }
    }

    const cleanWorksList: Omit<ProjectWork, 'id'>[] = [
      {
        projectId: work.projectId || '',
        projectName: work.projectName || '',
        listingCount,
        blogCount,
        forumCount,
        pdfCount,
        imageCount,
        videoPptCount,
        profileCount,
        linkCount,
        blog: work.blog || '',
        customValues: cleanCustomValues,
        workTypes,
        contentUpdates: work.contentUpdates || [],
        selectedKeywords: work.selectedKeywords || [],
        workSummary: work.workSummary || '',
        extraWorkNote: extraWorkNoteTrimmed,
      }
    ];

    // Call submit handler with our clean array
    onSubmit(cleanWorksList, selectedDate);

    setIsSuccess(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="space-y-8">
      {isSuccess ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white p-8 rounded-3xl border border-gray-150 shadow-md text-center space-y-6 max-w-xl mx-auto py-12"
        >
          <div className="inline-flex w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 items-center justify-center">
            <CheckCircle2 size={32} className="animate-pulse text-emerald-600" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold text-gray-900">Work Log Submitted Successfully!</h2>
            <p className="text-xs text-gray-500">
              Your Work Log report has been compiled and recorded under <strong>{getUserDisplayName(currentUserEmail, allowedUsers)}</strong>.
            </p>
          </div>
          <div className="border-t border-gray-100 pt-8 space-y-5">
            <p className="text-sm font-semibold text-gray-700">
              Would you like to log another entry?
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                type="button"
                onClick={handleResetForm}
                className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition cursor-pointer flex items-center justify-center gap-1.5 shadow-xs"
              >
                <Plus size={14} /> Log Another Entry
              </button>
              {onViewLogs && (
                <button
                  type="button"
                  onClick={onViewLogs}
                  className="px-6 py-3 border border-gray-200 hover:bg-gray-50 text-gray-700 font-bold rounded-xl text-xs transition cursor-pointer flex items-center justify-center gap-1.5 shadow-xs"
                >
                  <Files size={14} /> View Work Log History
                </button>
              )}
            </div>
          </div>
        </motion.div>
      ) : (
        <>
          <form onSubmit={handleSubmit} className="space-y-8">
            {/* Single Project Work Item Container */}
            <div className="space-y-6">

              {worksList.map((work, idx) => (
                <div
                  key={idx}
                  className="bg-white rounded-3xl border border-gray-150 shadow-xs overflow-hidden relative group"
                >
                  {/* Block Header Tab */}
                  <div className="bg-gray-50/50 px-6 py-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-700 font-extrabold text-xs flex items-center justify-center">
                        ✓
                      </span>
                      <div>
                        <h4 className="font-bold text-gray-900 text-sm">Work Log</h4>
                      </div>
                    </div>

                    {/* Date Selection Box Aligned on the Right Side of the same line inside the big block header */}
                    <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-gray-150 shadow-3xs">
                      <input
                        id="reporting-date"
                        type="date"
                        required
                        value={selectedDate}
                        max={new Date().toISOString().split('T')[0]}
                        onChange={(e) => setSelectedDate(e.target.value)}
                        className="px-2.5 py-1 bg-gray-50 border border-gray-200 rounded-lg text-gray-955 font-bold focus:outline-none focus:ring-1 focus:ring-indigo-600 transition text-[11px] cursor-pointer hover:bg-gray-100"
                      />
                    </div>
                  </div>

                  {/* Body Form inputs */}
                  <div className="p-6 sm:p-8 space-y-6">
                                       {/* Select Project block with brand-new searchable dropdown & keyword selector */}
                    <div className="space-y-4">
                      {/* Select Project block - full width at top */}
                      <div className="space-y-2">
                        <label className="block text-xs font-bold text-indigo-750 uppercase tracking-wider flex items-center gap-2">
                          <Layers size={14} className="text-indigo-600" />
                          Domain
                        </label>
                        
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => {
                              setIsDropdownOpen(!isDropdownOpen);
                              setDropdownSearch('');
                            }}
                            className="w-full px-4 py-3 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-xl text-gray-955 font-bold flex items-center justify-between text-sm cursor-pointer transition focus:ring-2 focus:ring-indigo-600 focus:outline-none animate-pulse-once"
                          >
                            <span className="truncate">
                              {projects.find((p) => p.id === work.projectId)?.domain || 
                               projects.find((p) => p.id === work.projectId)?.name || 
                               'Select a Domain'}
                            </span>
                            <span className="text-gray-400 shrink-0 select-none text-[10px] ml-2">▼</span>
                          </button>

                          {isDropdownOpen && (
                            <>
                              {/* Backdrop overlay for closing if clicked outside */}
                              <div 
                                className="fixed inset-0 z-45 bg-transparent" 
                                onClick={() => setIsDropdownOpen(false)}
                              />
                              
                              {/* Dropdown Options Box */}
                              <div className="absolute left-0 right-0 mt-1.5 p-2 bg-white border border-gray-150 rounded-2xl shadow-lg z-50 max-h-68 flex flex-col animate-scale-in">
                                {/* Search bar input container */}
                                <div className="relative m-1 mb-2">
                                  <span className="absolute left-3 top-2.5 text-gray-450 text-xs">🔍</span>
                                  <input
                                    type="text"
                                    placeholder="Search domain or project..."
                                    value={dropdownSearch}
                                    onChange={(e) => setDropdownSearch(e.target.value)}
                                    className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-gray-200 focus:border-indigo-505 rounded-xl text-xs text-gray-955 font-medium focus:outline-none focus:ring-1 focus:ring-indigo-505"
                                    autoFocus
                                  />
                                </div>

                                {/* Scrolled list */}
                                <div className="overflow-y-auto max-h-48 space-y-0.5 pr-1">
                                  {(() => {
                                    const filtered = projects.filter((p) => {
                                      const term = dropdownSearch.toLowerCase().trim();
                                      const domainMatch = p.domain ? p.domain.toLowerCase().includes(term) : false;
                                      const nameMatch = p.name ? p.name.toLowerCase().includes(term) : false;
                                      return domainMatch || nameMatch;
                                    });

                                    // Deduplicate projects by domain/name to avoid repeated project names in the dropdown list
                                    const uniqueFiltered: typeof filtered = [];
                                    const seen = new Set<string>();
                                    for (const p of filtered) {
                                      const key = (p.domain || p.name || '').trim().toLowerCase();
                                      if (key && !seen.has(key)) {
                                        seen.add(key);
                                        uniqueFiltered.push(p);
                                      } else if (!key) {
                                        uniqueFiltered.push(p);
                                      }
                                    }

                                    if (uniqueFiltered.length === 0) {
                                      return (
                                        <div className="p-3 text-center text-xs text-gray-400 select-none font-medium">
                                          No matching domains found
                                        </div>
                                      );
                                    }

                                    return uniqueFiltered.map((p) => {
                                      const isSelected = work.projectId === p.id;
                                      return (
                                        <button
                                          key={p.id}
                                          type="button"
                                          onClick={() => {
                                            handleUpdateWorkBlock(idx, { projectId: p.id });
                                            setIsDropdownOpen(false);
                                            setDropdownSearch('');
                                          }}
                                          className={`w-full text-left px-3 py-2 rounded-xl text-xs font-bold transition flex items-center justify-between cursor-pointer ${
                                            isSelected
                                              ? 'bg-indigo-50 text-indigo-700'
                                              : 'hover:bg-slate-50 text-gray-800'
                                          }`}
                                        >
                                          <span className="truncate">{p.domain || p.name}</span>
                                          {isSelected && <span className="text-indigo-650 shrink-0 font-extrabold text-[10px]">✓</span>}
                                        </button>
                                      );
                                    });
                                  })()}
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Dynamic Keywords Multi-Select Sub-Section (Placed Under Domain) */}
                      {(() => {
                        const matchedProj = projects.find((p) => p.id === work.projectId);
                        const kws = (matchedProj?.keywords || []).filter(Boolean);
                        if (kws.length === 0) return null;

                        return (
                          <div id="keywords-selector-container" className="space-y-2 p-4 bg-slate-50/50 rounded-2xl border border-gray-150 shadow-3xs">
                            <span className="block text-[10px] font-black text-slate-500 uppercase tracking-wider">
                              Select Keywords <span className="text-rose-500">*</span>
                            </span>
                            <div className="flex flex-wrap gap-2">
                              {kws.map((kw) => {
                                const currentKeywords = work.selectedKeywords || [];
                                const selected = currentKeywords.includes(kw);
                                const selectedIdx = currentKeywords.indexOf(kw);
                                const selectionNumber = selectedIdx !== -1 ? selectedIdx + 1 : null;

                                return (
                                  <button
                                    key={kw}
                                    type="button"
                                    onClick={() => {
                                      const next = selected
                                        ? currentKeywords.filter((k: string) => k !== kw)
                                        : [...currentKeywords, kw];
                                      if (next.length <= 8) {
                                        handleUpdateWorkBlock(idx, { selectedKeywords: next });
                                      }
                                    }}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition select-none cursor-pointer ${
                                      selected
                                        ? 'bg-amber-100 text-amber-900 border-amber-300'
                                        : 'bg-white hover:bg-slate-100 border-gray-200 text-gray-700'
                                    }`}
                                  >
                                    {selected ? (
                                      <span className="w-4 h-4 rounded-full bg-amber-500 text-white flex items-center justify-center text-[9px] font-black shrink-0 leading-none">
                                        {selectionNumber}
                                      </span>
                                    ) : (
                                      <span className="text-[10px] text-gray-400">#</span>
                                    )}
                                    <span className="truncate leading-none select-none">{kw}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}
                    </div>                    {/* Section: Work Type */}
                    <div className="space-y-6">
                      <div className="flex items-center gap-2 border-b border-gray-150 pb-3">
                        <div className="w-6 h-6 rounded-md bg-indigo-50 text-indigo-700 flex items-center justify-center">
                          <PenTool size={12} className="shrink-0" />
                        </div>
                        <h5 className="text-xs font-black text-gray-700 uppercase tracking-wider">Select Work Type</h5>
                      </div>                      {/* Work Types Toggle List - Stacked Vertically with Inline Dynamic Panels */}
                      <div className="flex flex-col gap-6">
                        
                        {/* 1. SEO Backlink block */}
                        <div className="space-y-3">
                          {/* SEO Backlink Option Card */}
                          <label
                            className={`relative flex items-start gap-3.5 p-4.5 rounded-2xl border cursor-pointer select-none transition ${
                              (work.workTypes || []).includes('seo_backlink')
                                ? 'border-indigo-600 bg-indigo-50/20 ring-1 ring-indigo-600'
                                : 'border-gray-200 bg-white hover:bg-gray-50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={(work.workTypes || []).includes('seo_backlink')}
                              onChange={() => {
                                const current = work.workTypes || [];
                                const next = current.includes('seo_backlink')
                                  ? current.filter((t: string) => t !== 'seo_backlink')
                                  : [...current, 'seo_backlink'];
                                handleUpdateWorkBlock(idx, { workTypes: next });
                              }}
                              className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 mt-1 cursor-pointer"
                            />
                            <div className="space-y-0.5">
                              <span className="block text-xs font-bold text-gray-900">SEO Backlink Submission</span>
                              <span className="block text-[10px] text-gray-400 font-medium">Log submission counts for listings, blogs, PDFs, and images.</span>
                            </div>
                          </label>

                          {/* Dynamic Content Panel 1: SEO Backlink Submission Counts */}
                          {(work.workTypes || []).includes('seo_backlink') && (
                            <motion.div
                              initial={{ opacity: 0, scale: 0.98 }}
                              animate={{ opacity: 1, scale: 1 }}
                              className="border border-indigo-100 bg-indigo-50/10 rounded-2xl p-5 space-y-4"
                            >
                              <span className="block text-[10px] font-extrabold text-indigo-950 uppercase tracking-widest">
                                🚀 SEO Submission Quantities
                              </span>
                                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                                {/* 1. Blogs / Articles count */}
                                <div className="flex items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-gray-150 shadow-2xs">
                                  <label htmlFor={`blog-cnt-${idx}`} className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1.5 shrink-0 select-none">
                                    <PenTool size={13} className="text-indigo-600 shrink-0" />
                                    Blog / Article
                                  </label>
                                  <input
                                    id={`blog-cnt-${idx}`}
                                    type="number"
                                    min="0"
                                    placeholder="0"
                                    value={work.blogCount}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      if (val !== '' && Number(val) < 0) return;
                                      handleUpdateWorkBlock(idx, { blogCount: val });
                                    }}
                                    className="w-20 px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-gray-955 font-bold placeholder-gray-305 focus:outline-none focus:ring-1 focus:ring-indigo-600 transition text-sm font-mono text-center"
                                  />
                                </div>

                                {/* 2. Listing count */}
                                <div className="flex items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-gray-150 shadow-2xs">
                                  <label htmlFor={`listing-cnt-${idx}`} className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1.5 shrink-0 select-none">
                                    <Hash size={13} className="text-indigo-600 shrink-0" />
                                    Listings
                                  </label>
                                  <input
                                    id={`listing-cnt-${idx}`}
                                    type="number"
                                    min="0"
                                    placeholder="0"
                                    value={work.listingCount}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      if (val !== '' && Number(val) < 0) return;
                                      handleUpdateWorkBlock(idx, { listingCount: val });
                                    }}
                                    className="w-20 px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-gray-955 font-bold placeholder-gray-305 focus:outline-none focus:ring-1 focus:ring-indigo-600 transition text-sm font-mono text-center"
                                  />
                                </div>

                                {/* 3. Forum count */}
                                <div className="flex items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-gray-150 shadow-2xs">
                                  <label htmlFor={`forum-cnt-${idx}`} className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1.5 shrink-0 select-none">
                                    <MessageSquare size={13} className="text-indigo-600" />
                                    Forum
                                  </label>
                                  <input
                                    id={`forum-cnt-${idx}`}
                                    type="number"
                                    min="0"
                                    placeholder="0"
                                    value={work.forumCount}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      if (val !== '' && Number(val) < 0) return;
                                      handleUpdateWorkBlock(idx, { forumCount: val });
                                    }}
                                    className="w-20 px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-gray-955 font-bold placeholder-gray-305 focus:outline-none focus:ring-1 focus:ring-indigo-600 transition text-sm font-mono text-center"
                                  />
                                </div>

                                {/* 4. PDF count */}
                                <div className="flex items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-gray-150 shadow-2xs">
                                  <label htmlFor={`pdf-cnt-${idx}`} className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1.5 shrink-0 select-none text-ellipsis overflow-hidden">
                                    <FileText size={13} className="text-indigo-600 shrink-0" />
                                    PDF
                                  </label>
                                  <input
                                    id={`pdf-cnt-${idx}`}
                                    type="number"
                                    min="0"
                                    placeholder="0"
                                    value={work.pdfCount}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      if (val !== '' && Number(val) < 0) return;
                                      handleUpdateWorkBlock(idx, { pdfCount: val });
                                    }}
                                    className="w-20 px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-gray-955 font-bold placeholder-gray-305 focus:outline-none focus:ring-1 focus:ring-indigo-600 transition text-sm font-mono text-center"
                                  />
                                </div>

                                {/* 5. Image count */}
                                <div className="flex items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-gray-150 shadow-2xs">
                                  <label htmlFor={`image-cnt-${idx}`} className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1.5 shrink-0 select-none">
                                    <Image size={13} className="text-indigo-600 shrink-0" />
                                    Images
                                  </label>
                                  <input
                                    id={`image-cnt-${idx}`}
                                    type="number"
                                    min="0"
                                    placeholder="0"
                                    value={work.imageCount}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      if (val !== '' && Number(val) < 0) return;
                                      handleUpdateWorkBlock(idx, { imageCount: val });
                                    }}
                                    className="w-20 px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-gray-955 font-bold placeholder-gray-305 focus:outline-none focus:ring-1 focus:ring-indigo-600 transition text-sm font-mono text-center"
                                  />
                                </div>

                                {/* 6. Video PPT count */}
                                <div className="flex items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-gray-150 shadow-2xs">
                                  <label htmlFor={`videoppt-cnt-${idx}`} className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1.5 shrink-0 select-none">
                                    <Presentation size={13} className="text-indigo-600 shrink-0" />
                                    Video / PPT
                                  </label>
                                  <input
                                    id={`videoppt-cnt-${idx}`}
                                    type="number"
                                    min="0"
                                    placeholder="0"
                                    value={work.videoPptCount}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      if (val !== '' && Number(val) < 0) return;
                                      handleUpdateWorkBlock(idx, { videoPptCount: val });
                                    }}
                                    className="w-20 px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-gray-955 font-bold placeholder-gray-305 focus:outline-none focus:ring-1 focus:ring-indigo-600 transition text-sm font-mono text-center"
                                  />
                                </div>

                                {/* 7. Profile count */}
                                <div className="flex items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-gray-150 shadow-2xs">
                                  <label htmlFor={`profile-cnt-${idx}`} className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1.5 shrink-0 select-none">
                                    <User size={13} className="text-indigo-600 shrink-0" />
                                    Profile
                                  </label>
                                  <input
                                    id={`profile-cnt-${idx}`}
                                    type="number"
                                    min="0"
                                    placeholder="0"
                                    value={work.profileCount}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      if (val !== '' && Number(val) < 0) return;
                                      handleUpdateWorkBlock(idx, { profileCount: val });
                                    }}
                                    className="w-20 px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-gray-955 font-bold placeholder-gray-305 focus:outline-none focus:ring-1 focus:ring-indigo-600 transition text-sm font-mono text-center"
                                  />
                                </div>

                                {/* 8. Link count */}
                                <div className="flex items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-gray-150 shadow-2xs">
                                  <label htmlFor={`link-cnt-${idx}`} className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1.5 shrink-0 select-none">
                                    <Link size={13} className="text-indigo-600 shrink-0" />
                                    Links
                                  </label>
                                  <input
                                    id={`link-cnt-${idx}`}
                                    type="number"
                                    min="0"
                                    placeholder="0"
                                    value={work.linkCount}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      if (val !== '' && Number(val) < 0) return;
                                      handleUpdateWorkBlock(idx, { linkCount: val });
                                    }}
                                    className="w-20 px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-gray-955 font-bold placeholder-gray-305 focus:outline-none focus:ring-1 focus:ring-indigo-600 transition text-sm font-mono text-center"
                                  />
                                </div>

                                {/* Custom Dynamic Submission fields */}
                                {customSubmissionTypes.map((type) => (
                                  <div key={type.id} className="flex items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-indigo-150 shadow-2xs">
                                    <label htmlFor={`custom-cnt-${type.id}-${idx}`} className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1.5 shrink-0 select-none truncate">
                                      <Hash size={13} className="text-purple-600 shrink-0" />
                                      {type.name}
                                    </label>
                                    <input
                                      id={`custom-cnt-${type.id}-${idx}`}
                                      type="number"
                                      min="0"
                                      placeholder="0"
                                      value={work.customValues?.[type.id] !== undefined ? work.customValues[type.id] : ''}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        if (val !== '' && Number(val) < 0) return;
                                        const nextCustomValues = {
                                          ...(work.customValues || {}),
                                          [type.id]: val
                                        };
                                        handleUpdateWorkBlock(idx, { customValues: nextCustomValues });
                                      }}
                                      className="w-20 px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-gray-955 font-bold placeholder-gray-350 focus:outline-none focus:ring-1 focus:ring-indigo-600 transition text-sm font-mono text-center"
                                    />
                                  </div>
                                ))}
                              </div>
                            </motion.div>
                          )}
                        </div>

                        {/* 2. Content Update block */}
                        <div className="space-y-3">
                          {/* Content Update Option Card */}
                          <label
                            className={`relative flex items-start gap-3.5 p-4.5 rounded-2xl border cursor-pointer select-none transition ${
                              (work.workTypes || []).includes('content_update')
                                ? 'border-indigo-600 bg-indigo-50/20 ring-1 ring-indigo-600'
                                : 'border-gray-200 bg-white hover:bg-gray-50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={(work.workTypes || []).includes('content_update')}
                              onChange={() => {
                                const current = work.workTypes || [];
                                const next = current.includes('content_update')
                                  ? current.filter((t: string) => t !== 'content_update')
                                  : [...current, 'content_update'];
                                handleUpdateWorkBlock(idx, { workTypes: next });
                              }}
                              className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 mt-1 cursor-pointer"
                            />
                            <div className="space-y-0.5">
                              <span className="block text-xs font-bold text-gray-900">Content Update</span>
                              <span className="block text-[10px] text-gray-400 font-medium">Select checkboxes such as meta tags, keywords, restructure logs.</span>
                            </div>
                          </label>

                          {/* Dynamic Content Panel 2: Content Update Checkboxes */}
                          {(work.workTypes || []).includes('content_update') && (
                            <motion.div
                              initial={{ opacity: 0, scale: 0.98 }}
                              animate={{ opacity: 1, scale: 1 }}
                              className="border border-purple-100 bg-purple-50/10 rounded-2xl p-5 space-y-4"
                            >
                              <div className="space-y-0.5">
                                <span className="block text-[10px] font-extrabold text-purple-950 uppercase tracking-widest">
                                   Content Update Checklist
                                </span>
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 bg-white p-4.5 rounded-xl border border-purple-100 shadow-2xs">
                                {/* Checkbox 1: Meta Title & Description */}
                                <label className="flex items-center gap-3 p-2.5 hover:bg-slate-50 rounded-lg cursor-pointer transition select-none">
                                  <input
                                    type="checkbox"
                                    checked={(work.contentUpdates || []).includes('meta_title_desc')}
                                    onChange={() => handleToggleContentUpdate(idx, 'meta_title_desc')}
                                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-505 border-gray-300 cursor-pointer"
                                  />
                                  <span className="text-xs font-bold text-gray-800">Meta Title & Description</span>
                                </label>

                                {/* Checkbox 2: Keyword Update */}
                                <label className="flex items-center gap-3 p-2.5 hover:bg-slate-50 rounded-lg cursor-pointer transition select-none">
                                  <input
                                    type="checkbox"
                                    checked={(work.contentUpdates || []).includes('keyword_update')}
                                    onChange={() => handleToggleContentUpdate(idx, 'keyword_update')}
                                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-505 border-gray-300 cursor-pointer"
                                  />
                                  <span className="text-xs font-bold text-gray-800">Keyword Update</span>
                                </label>

                                {/* Checkbox 3: Section Update */}
                                <label className="flex items-center gap-3 p-2.5 hover:bg-slate-50 rounded-lg cursor-pointer transition select-none">
                                  <input
                                    type="checkbox"
                                    checked={(work.contentUpdates || []).includes('section_update')}
                                    onChange={() => handleToggleContentUpdate(idx, 'section_update')}
                                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-505 border-gray-300 cursor-pointer"
                                  />
                                  <span className="text-xs font-bold text-gray-800">Section Update</span>
                                </label>

                                {/* Checkbox 4: Restructure */}
                                <label className="flex items-center gap-3 p-2.5 hover:bg-slate-50 rounded-lg cursor-pointer transition select-none">
                                  <input
                                    type="checkbox"
                                    checked={(work.contentUpdates || []).includes('restructure')}
                                    onChange={() => handleToggleContentUpdate(idx, 'restructure')}
                                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-505 border-gray-300 cursor-pointer"
                                  />
                                  <span className="text-xs font-bold text-gray-800">Restructure</span>
                                </label>
                              </div>
                            </motion.div>
                          )}
                        </div>

                      </div>
                      <div className="space-y-2">
                        <label htmlFor={`work-summary-${idx}`} className="block text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1.5">
                           Work Notes / Summary
                        </label>
                        <textarea
                          id={`work-summary-${idx}`}
                          rows={3}
                          value={work.workSummary || ''}
                          placeholder="Type details or list references here..."
                          onChange={(e) => handleUpdateWorkBlock(idx, { workSummary: e.target.value })}
                          className="w-full px-4 py-3 bg-gray-50 border border-gray-200 focus:border-indigo-600 focus:bg-white rounded-xl text-xs text-gray-950 font-medium placeholder-gray-400 focus:outline-none transition leading-relaxed"
                        />
                      </div>
                    </div>

                  </div>
                </div>
              ))}
            </div>

            {/* Extra / New Work Done — separate, optional block (not tied to domain selection) */}
            <div className="bg-white rounded-3xl border border-gray-150 shadow-xs overflow-hidden">
              <div className="bg-gray-50/50 px-6 py-4 border-b border-gray-100 flex items-center gap-3">
                <span className="w-8 h-8 rounded-lg bg-amber-50 text-amber-700 font-extrabold text-xs flex items-center justify-center">
                  ＋
                </span>
                <div>
                  <h4 className="font-bold text-gray-900 text-sm">Extra / New Work Done</h4>
         
                </div>
              </div>
              <div className="px-6 sm:px-8 pb-6 sm:pb-8 pt-3 space-y-2">
                <label htmlFor="extra-work-note" className="block text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1.5">
                  
                </label>
                <textarea
                  id="extra-work-note"
                  rows={3}
                  value={worksList[0]?.extraWorkNote || ''}
                  placeholder="describe any extra or new work done..."
                  onChange={(e) => handleUpdateWorkBlock(0, { extraWorkNote: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 focus:border-indigo-600 focus:bg-white rounded-xl text-xs text-gray-950 font-medium placeholder-gray-400 focus:outline-none transition leading-relaxed"
                />
              </div>
            </div>

            {validationError && (
              <div className="p-4 bg-rose-50 border-l-4 border-rose-500 text-rose-800 rounded-r-xl text-sm font-semibold shadow-xs animate-shake">
                {validationError}
              </div>
            )}

            {/* Submit Actions Panel */}
            <div className="flex justify-end items-center gap-4 pt-4">
              <button
                id="work-log-compile-btn"
                type="submit"
                className="px-8 py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition shadow-sm hover:shadow-md flex items-center gap-2 cursor-pointer grow sm:grow-0 justify-center"
              >
                <CheckCircle2 size={16} />
                Submit Work Log
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
