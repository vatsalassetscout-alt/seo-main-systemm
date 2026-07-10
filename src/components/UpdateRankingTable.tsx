/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Project } from '../types';
import { Plus, X, ArrowUpDown, Palette, Search, Check, Loader2, ChevronDown } from 'lucide-react';

export interface RankingColumn {
  id: string;
  name: string;
}

export interface ManualRankingGrid {
  columns: RankingColumn[];
  values: Record<string, Record<string, string>>; // projectId -> columnId -> numeric string
  rowColors: Record<string, string>; // legacy field, kept for backward compatibility with saved data
}

interface UpdateRankingTableProps {
  projects: Project[];
  isAdmin?: boolean;
  grid: ManualRankingGrid;
  setGrid: React.Dispatch<React.SetStateAction<ManualRankingGrid>>;
  isLoading: boolean;
}

const EMPTY_GRID: ManualRankingGrid = { columns: [], values: {}, rowColors: {} };

// Full color palette offered for the row color-tagging filter (24 presets)
const COLOR_SWATCHES = [
  { label: 'Green', value: '#d1fae5' },
  { label: 'Emerald', value: '#a7f3d0' },
  { label: 'Teal', value: '#ccfbf1' },
  { label: 'Cyan', value: '#cffafe' },
  { label: 'Sky', value: '#e0f2fe' },
  { label: 'Blue', value: '#dbeafe' },
  { label: 'Indigo', value: '#e0e7ff' },
  { label: 'Violet', value: '#ede9fe' },
  { label: 'Purple', value: '#f3e8ff' },
  { label: 'Fuchsia', value: '#fae8ff' },
  { label: 'Pink', value: '#fce7f3' },
  { label: 'Rose', value: '#ffe4e6' },
  { label: 'Red', value: '#fee2e2' },
  { label: 'Orange', value: '#ffedd5' },
  { label: 'Amber', value: '#fef3c7' },
  { label: 'Yellow', value: '#fef9c3' },
  { label: 'Lime', value: '#ecfccb' },
  { label: 'Gray', value: '#e5e7eb' },
  { label: 'Slate', value: '#e2e8f0' },
  { label: 'Stone', value: '#e7e5e4' },
  { label: 'Dark Green', value: '#86efac' },
  { label: 'Dark Blue', value: '#93c5fd' },
  { label: 'Dark Red', value: '#fca5a5' },
  { label: 'Dark Purple', value: '#d8b4fe' },
];

// Only digits and commas allowed while typing ranking values
const sanitizeNumericInput = (raw: string) => raw.replace(/[^0-9,]/g, '');

// Turns "1,234" style strings into a comparable number for sorting (blank -> sorts last)
const numericSortValue = (raw: string | undefined): number => {
  if (!raw) return -Infinity;
  const cleaned = raw.replace(/,/g, '').trim();
  if (cleaned === '') return -Infinity;
  const n = parseFloat(cleaned);
  return isNaN(n) ? -Infinity : n;
};

// Sizes a ranking column based on its name length instead of a fixed oversized width.
// Keeps short names (e.g. "W1") compact while still fitting longer names (e.g. "July Check").
const columnWidth = (name: string): number => {
  const px = 56 + name.length * 8;
  return Math.min(180, Math.max(76, px));
};

// Frozen (sticky) left-side columns - Sr No / Project Name / Domain / Location
// always sit at these exact widths, no matter what's in them or how many
// ranking columns get added. Only the ranking columns scroll horizontally,
// like frozen panes in Google Sheets.
const CHECKBOX_COL_WIDTH = 40;   // color-mode checkbox column
const SR_NO_COL_WIDTH = 56;      // "Sr No." column
const NAME_COL_WIDTH = 220;      // widened to fit full project names
const DOMAIN_COL_WIDTH = 220;    // widened to fit full domain URLs
const LOCATION_COL_WIDTH = 140;  // widened to fit full location names

export default function UpdateRankingTable({ projects, isAdmin = false, grid, setGrid, isLoading }: UpdateRankingTableProps) {
  // Permissions are intentionally flipped from "isAdmin": admin can only VIEW
  // this section (plus use the sort filter), while regular users get full
  // editing rights (values, add/rename/delete columns, color tagging).
  const canEdit = !isAdmin;
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [searchTerm, setSearchTerm] = useState('');

  // Sort filter (High to Low / Low to High) applied to one chosen column.
  // This is local, per-session state only (never saved/shared), so an admin's
  // chosen sort never affects what a user sees, and vice versa.
  const [sortColumnId, setSortColumnId] = useState<string>('');
  const [sortDirection, setSortDirection] = useState<'desc' | 'asc'>('desc');
  const [sortPanelOpen, setSortPanelOpen] = useState(false);
  const sortPanelRef = useRef<HTMLDivElement | null>(null);

  // Color-tagging filter mode - available to admin and user alike
  const [colorModeOn, setColorModeOn] = useState(false);
  const [selectedRowIds, setSelectedRowIds] = useState<Record<string, boolean>>({});
  const [customColor, setCustomColor] = useState('#c7d2fe');

  const skipNextAutoSave = useRef(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Grid data is now fetched once, up front, by the parent DSRDashboard
  // (alongside projects/rankings) and handed down as a prop, so switching
  // into this tab no longer triggers its own network request or spinner.

  // Debounced auto-save whenever the grid changes (skip the very first load)
  // Debounce shortened to 400ms for a snappier feel; typing updates the UI
  // instantly (optimistic) while the save happens quietly in the background.
  useEffect(() => {
    if (skipNextAutoSave.current) {
      skipNextAutoSave.current = false;
      return;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState('saving');
    saveTimer.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/manual-rankings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(grid)
        });
        setSaveState(res.ok ? 'saved' : 'error');
      } catch (e) {
        console.error('Failed to save Manual Ranking data:', e);
        setSaveState('error');
      }
    }, 400);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid]);

  // Close the sort panel when clicking outside of it
  useEffect(() => {
    if (!sortPanelOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (sortPanelRef.current && !sortPanelRef.current.contains(e.target as Node)) {
        setSortPanelOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [sortPanelOpen]);

  const addColumn = () => {
    if (!canEdit) return;
    const name = window.prompt('Name this new ranking column (e.g. "Week 1", "July Check"):');
    if (!name || !name.trim()) return;
    const newCol: RankingColumn = {
      id: `col-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: name.trim()
    };
    setGrid(prev => ({ ...prev, columns: [...prev.columns, newCol] }));
  };

  const renameColumn = (colId: string) => {
    if (!canEdit) return;
    const current = grid.columns.find(c => c.id === colId);
    const name = window.prompt('Rename column:', current?.name || '');
    if (!name || !name.trim()) return;
    setGrid(prev => ({
      ...prev,
      columns: prev.columns.map(c => c.id === colId ? { ...c, name: name.trim() } : c)
    }));
  };

  const deleteColumn = (colId: string) => {
    if (!canEdit) return;
    if (!window.confirm('Remove this column and all its filled data? This cannot be undone.')) return;
    setGrid(prev => ({
      ...prev,
      columns: prev.columns.filter(c => c.id !== colId),
      values: Object.fromEntries(
        Object.entries(prev.values).map(([pid, row]: [string, Record<string, string>]) => {
          const rest: Record<string, string> = Object.assign({}, row);
          delete rest[colId];
          return [pid, rest] as [string, Record<string, string>];
        })
      )
    }));
    if (sortColumnId === colId) setSortColumnId('');
  };

  const updateCell = (projectId: string, colId: string, raw: string) => {
    if (!canEdit) return;
    const value = sanitizeNumericInput(raw);
    setGrid(prev => ({
      ...prev,
      values: {
        ...prev.values,
        [projectId]: { ...(prev.values[projectId] || {}), [colId]: value }
      }
    }));
  };

  // Checking a column in the sort panel makes that the active sort column immediately
  const chooseSortColumn = (colId: string) => {
    setSortColumnId(prev => (prev === colId ? '' : colId));
  };

  const applyColorToSelected = (color: string) => {
    setGrid(prev => {
      const nextColors = { ...prev.rowColors };
      Object.keys(selectedRowIds).forEach(pid => {
        if (selectedRowIds[pid]) nextColors[pid] = color;
      });
      return { ...prev, rowColors: nextColors };
    });
    setSelectedRowIds({});
  };

  const clearColorFromSelected = () => {
    setGrid(prev => {
      const nextColors = { ...prev.rowColors };
      Object.keys(selectedRowIds).forEach(pid => {
        if (selectedRowIds[pid]) delete nextColors[pid];
      });
      return { ...prev, rowColors: nextColors };
    });
    setSelectedRowIds({});
  };

  const visibleProjects = useMemo(() => {
    let list = projects.filter(p => {
      if (!searchTerm.trim()) return true;
      const term = searchTerm.toLowerCase();
      return (p.name || '').toLowerCase().includes(term) || (p.domain || '').toLowerCase().includes(term);
    });

    if (sortColumnId) {
      list = [...list].sort((a, b) => {
        const av = numericSortValue(grid.values[a.id]?.[sortColumnId]);
        const bv = numericSortValue(grid.values[b.id]?.[sortColumnId]);
        return sortDirection === 'desc' ? bv - av : av - bv;
      });
    }
    return list;
  }, [projects, searchTerm, sortColumnId, sortDirection, grid.values]);

  const selectedCount = Object.values(selectedRowIds).filter(Boolean).length;

  // Frozen pane: Sr No / Project Name / Domain / Location stay pinned at
  // fixed widths no matter what ranking columns get added - only the ranking
  // columns scroll horizontally.
  const srNoLeft = colorModeOn ? CHECKBOX_COL_WIDTH : 0;
  const nameLeft = srNoLeft + SR_NO_COL_WIDTH;
  const domainLeft = nameLeft + NAME_COL_WIDTH;
  const locationLeft = domainLeft + DOMAIN_COL_WIDTH;

  const activeSortColumnName = grid.columns.find(c => c.id === sortColumnId)?.name;

  return (
    <div>
      {/* Toolbar */}
      <div className="p-4 bg-gray-50/50 border-b border-gray-150 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider">
            {isAdmin ? 'Manual Ranking' : 'Update Ranking'}
          </h3>
          <p className="text-[10px] text-gray-500 font-semibold mt-0.5">
            {canEdit
              ? 'Manually track ranking numbers per project across as many columns as you need.'
              : 'View ranking numbers per project. Sort and search freely.'}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap relative">
          {/* Save status */}
          <div className="flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1.5 rounded-lg bg-white border border-gray-200">
            {saveState === 'saving' && <><Loader2 size={11} className="animate-spin text-indigo-500" /> Saving…</>}
            {saveState === 'saved' && <><Check size={11} className="text-emerald-600" /> Saved</>}
            {saveState === 'error' && <span className="text-rose-600">Save failed</span>}
            {saveState === 'idle' && <span className="text-gray-400">All changes saved</span>}
          </div>

          <div className="relative w-full sm:w-56">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-gray-400">
              <Search size={13} />
            </span>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search projects or domain..."
              className="w-full text-xs pl-8 pr-3 py-2 border border-gray-200 rounded-xl focus:outline-hidden focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
            />
          </div>

          {/* Sort filter: High to Low / Low to High, applied to a chosen column.
              This is per-user local state: an admin's sort choice is only ever
              visible in the admin's own view, and a user's sort choice only in theirs. */}
          <div className="relative" ref={sortPanelRef}>
            <button
              onClick={() => setSortPanelOpen(v => !v)}
              className={`flex items-center gap-1.5 text-xs font-bold border rounded-xl px-2.5 py-2 cursor-pointer transition ${
                sortColumnId ? 'bg-indigo-600 border-indigo-700 text-white' : 'bg-white border-gray-200 hover:bg-gray-50 text-gray-700'
              }`}
            >
              <ArrowUpDown size={12} />
              {sortColumnId ? `${activeSortColumnName}: ${sortDirection === 'desc' ? 'High → Low' : 'Low → High'}` : 'Sort'}
              <ChevronDown size={12} />
            </button>

            {sortPanelOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-64 max-w-[85vw] max-h-80 overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-xl z-50 p-3">
                <p className="text-[10px] font-black text-gray-500 uppercase tracking-wider mb-2">Sort direction</p>
                <div className="flex gap-2 mb-3">
                  <button
                    onClick={() => setSortDirection('desc')}
                    className={`flex-1 text-xs font-bold rounded-lg px-2 py-1.5 border cursor-pointer transition ${
                      sortDirection === 'desc' ? 'bg-indigo-600 text-white border-indigo-700' : 'bg-white border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    High → Low
                  </button>
                  <button
                    onClick={() => setSortDirection('asc')}
                    className={`flex-1 text-xs font-bold rounded-lg px-2 py-1.5 border cursor-pointer transition ${
                      sortDirection === 'asc' ? 'bg-indigo-600 text-white border-indigo-700' : 'bg-white border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    Low → High
                  </button>
                </div>

                <p className="text-[10px] font-black text-gray-500 uppercase tracking-wider mb-2">Apply to column</p>
                {grid.columns.length === 0 ? (
                  <p className="text-[11px] text-gray-400 font-semibold">
                    {canEdit ? 'Add a ranking column first.' : 'No ranking columns yet.'}
                  </p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {grid.columns.map(col => (
                      <label key={col.id} className="flex items-center gap-2 text-xs font-semibold text-gray-700 cursor-pointer hover:bg-gray-50 rounded-lg px-1.5 py-1">
                        <input
                          type="checkbox"
                          checked={sortColumnId === col.id}
                          onChange={() => chooseSortColumn(col.id)}
                          className="cursor-pointer"
                        />
                        <span className="truncate">{col.name}</span>
                      </label>
                    ))}
                  </div>
                )}

                {sortColumnId && (
                  <button
                    onClick={() => { setSortColumnId(''); }}
                    className="mt-2 text-[10px] font-bold text-gray-500 hover:text-rose-600 cursor-pointer"
                  >
                    Clear sort
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Color tagging filter - users only; admin is view-only here */}
          {canEdit && (
            <button
              onClick={() => { setColorModeOn(v => !v); setSelectedRowIds({}); }}
              className={`flex items-center gap-1.5 text-xs font-bold border rounded-xl px-2.5 py-2 cursor-pointer transition ${
                colorModeOn ? 'bg-indigo-600 border-indigo-700 text-white' : 'bg-white border-gray-200 hover:bg-gray-50 text-gray-700'
              }`}
            >
              <Palette size={12} />
              Color Tag {colorModeOn ? 'On' : ''}
            </button>
          )}
        </div>
      </div>

      {/* Color palette bar - shown once rows are checked in color mode (users only).
          Sticky so it stays fixed in view instead of scrolling away with the table. */}
      {canEdit && colorModeOn && selectedCount > 0 && (
        <div className="sticky top-0 z-40 mx-4 mt-3 p-3 bg-indigo-50 border border-indigo-150 rounded-xl shadow-md">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold text-indigo-800">{selectedCount} row{selectedCount > 1 ? 's' : ''} selected</span>
            <button
              onClick={clearColorFromSelected}
              className="text-[10px] font-bold text-gray-600 hover:text-rose-600 px-2 py-1 rounded-lg hover:bg-white transition cursor-pointer"
            >
              Clear color
            </button>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {COLOR_SWATCHES.map(sw => (
              <button
                key={sw.value}
                title={sw.label}
                onClick={() => applyColorToSelected(sw.value)}
                className="w-6 h-6 rounded-full border-2 border-white shadow-2xs cursor-pointer hover:scale-110 transition"
                style={{ backgroundColor: sw.value }}
              />
            ))}

            {/* Custom color picker - pick any color beyond the presets */}
            <div className="flex items-center gap-1 ml-1 pl-2 border-l border-indigo-200">
              <input
                type="color"
                value={customColor}
                onChange={(e) => setCustomColor(e.target.value)}
                title="Pick a custom color"
                className="w-6 h-6 rounded-full border-2 border-white shadow-2xs cursor-pointer overflow-hidden p-0"
              />
              <button
                onClick={() => applyColorToSelected(customColor)}
                className="text-[10px] font-bold text-indigo-700 hover:text-indigo-900 px-2 py-1 rounded-lg hover:bg-white transition cursor-pointer"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="p-12 text-center text-xs text-gray-500 font-bold">Loading ranking data...</div>
      ) : visibleProjects.length === 0 ? (
        <div className="p-12 text-center text-xs text-gray-500 font-bold bg-slate-50/40 rounded-b-2xl border-t border-slate-150">
          No projects found matching the search criteria.
        </div>
      ) : (
        <div className="overflow-auto rounded-b-2xl mt-1 max-h-[70vh]">
          <table className="text-left text-xs border-collapse w-full" style={{ tableLayout: 'fixed' }}>
            <thead className="bg-slate-50/70 text-slate-500 font-extrabold text-[10px] uppercase border-b border-gray-150">
              <tr>
                {colorModeOn && <th className="px-3 py-3 sticky top-0 left-0 bg-slate-50/95 z-30" style={{ width: CHECKBOX_COL_WIDTH, minWidth: CHECKBOX_COL_WIDTH, maxWidth: CHECKBOX_COL_WIDTH }}></th>}
                <th
                  className="px-3 py-3 text-center sticky top-0 bg-slate-50/95 z-30"
                  style={{ left: srNoLeft, width: SR_NO_COL_WIDTH, minWidth: SR_NO_COL_WIDTH, maxWidth: SR_NO_COL_WIDTH }}
                >
                  Sr No.
                </th>
                <th
                  className="px-1.5 py-3 sticky top-0 bg-slate-50/95 z-30 truncate"
                  style={{ left: nameLeft, width: NAME_COL_WIDTH, minWidth: NAME_COL_WIDTH, maxWidth: NAME_COL_WIDTH }}
                >
                  Project Name
                </th>
                <th
                  className="px-1.5 py-3 sticky top-0 bg-slate-50/95 z-30 truncate"
                  style={{ left: domainLeft, width: DOMAIN_COL_WIDTH, minWidth: DOMAIN_COL_WIDTH, maxWidth: DOMAIN_COL_WIDTH }}
                >
                  Domain
                </th>
                <th
                  className="px-1.5 py-3 sticky top-0 bg-slate-50/95 z-30 truncate"
                  style={{ left: locationLeft, width: LOCATION_COL_WIDTH, minWidth: LOCATION_COL_WIDTH, maxWidth: LOCATION_COL_WIDTH }}
                >
                  Location
                </th>

                {grid.columns.map(col => {
                  const w = columnWidth(col.name);
                  return (
                    <th key={col.id} className="px-2.5 py-3 group/col relative sticky top-0 z-20 bg-slate-50/95" style={{ width: w, minWidth: w, maxWidth: w }}>
                      <div className="flex items-center justify-between gap-1">
                        {canEdit ? (
                          <button
                            onClick={() => renameColumn(col.id)}
                            className="truncate text-left hover:text-indigo-600 cursor-pointer"
                            title="Click to rename column"
                          >
                            {col.name}
                          </button>
                        ) : (
                          <span className="truncate" title={col.name}>{col.name}</span>
                        )}
                        {canEdit && (
                          <button
                            onClick={() => deleteColumn(col.id)}
                            className="opacity-0 group-hover/col:opacity-100 text-gray-400 hover:text-rose-600 transition cursor-pointer shrink-0"
                            title="Remove column"
                          >
                            <X size={11} />
                          </button>
                        )}
                      </div>
                    </th>
                  );
                })}

                {canEdit && (
                  <th className="px-3 py-3 w-12 sticky top-0 z-20 bg-slate-50/95">
                    <button
                      onClick={addColumn}
                      title="Add a new ranking column"
                      className="w-7 h-7 flex items-center justify-center rounded-lg border border-dashed border-indigo-300 text-indigo-600 hover:bg-indigo-50 cursor-pointer transition"
                    >
                      <Plus size={14} />
                    </button>
                  </th>
                )}
                {/* Filler column: no fixed width, so it soaks up all remaining
                    horizontal space. Lets a colored row's background extend
                    all the way to the right edge instead of stopping at the
                    last data column. */}
                <th className="w-full sticky top-0 z-20 bg-slate-50/95"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-150">
              {visibleProjects.map((proj, idx) => {
                const rowColor = grid.rowColors[proj.id];
                const isChecked = !!selectedRowIds[proj.id];
                return (
                  <tr key={proj.id} style={rowColor ? { backgroundColor: rowColor } : undefined} className="hover:bg-slate-50/60 transition">
                    {colorModeOn && (
                      <td
                        className="px-3 py-2.5 sticky left-0 z-10"
                        style={{ width: CHECKBOX_COL_WIDTH, minWidth: CHECKBOX_COL_WIDTH, maxWidth: CHECKBOX_COL_WIDTH, backgroundColor: rowColor || '#fff' }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => setSelectedRowIds(prev => ({ ...prev, [proj.id]: e.target.checked }))}
                          className="cursor-pointer"
                        />
                      </td>
                    )}
                    <td
                      className="px-3 py-2.5 text-center font-bold text-gray-500 sticky z-10"
                      style={{ left: srNoLeft, width: SR_NO_COL_WIDTH, minWidth: SR_NO_COL_WIDTH, maxWidth: SR_NO_COL_WIDTH, backgroundColor: rowColor || '#fff' }}
                    >
                      {idx + 1}
                    </td>
                    <td
                      className="px-1.5 py-2.5 font-bold text-gray-800 sticky z-10 truncate"
                      style={{ left: nameLeft, width: NAME_COL_WIDTH, minWidth: NAME_COL_WIDTH, maxWidth: NAME_COL_WIDTH, backgroundColor: rowColor || '#fff' }}
                      title={proj.name}
                    >
                      {proj.name}
                    </td>
                    <td
                      className="px-1.5 py-2.5 text-gray-600 font-semibold sticky z-10 truncate"
                      style={{ left: domainLeft, width: DOMAIN_COL_WIDTH, minWidth: DOMAIN_COL_WIDTH, maxWidth: DOMAIN_COL_WIDTH, backgroundColor: rowColor || '#fff' }}
                      title={proj.domain || ''}
                    >
                      {proj.domain || '—'}
                    </td>
                    <td
                      className="px-1.5 py-2.5 text-gray-600 font-semibold sticky z-10 truncate"
                      style={{ left: locationLeft, width: LOCATION_COL_WIDTH, minWidth: LOCATION_COL_WIDTH, maxWidth: LOCATION_COL_WIDTH, backgroundColor: rowColor || '#fff' }}
                      title={proj.location || ''}
                    >
                      {proj.location || '—'}
                    </td>

                    {grid.columns.map(col => {
                      const w = columnWidth(col.name);
                      const cellValue = grid.values[proj.id]?.[col.id] || '';
                      return (
                        <td key={col.id} className="p-0" style={{ width: w, minWidth: w, maxWidth: w }}>
                          {canEdit ? (
                            <input
                              type="text"
                              inputMode="numeric"
                              value={cellValue}
                              onChange={(e) => updateCell(proj.id, col.id, e.target.value)}
                              placeholder="—"
                              className="w-full text-xs font-bold text-gray-800 px-2.5 py-2.5 border border-transparent hover:border-gray-200 focus:border-indigo-400 rounded-lg focus:outline-hidden bg-transparent focus:bg-white transition"
                            />
                          ) : (
                            <span className="block px-2.5 py-2.5 text-xs font-bold text-gray-800 truncate">
                              {cellValue || '—'}
                            </span>
                          )}
                        </td>
                      );
                    })}

                    {canEdit && <td></td>}
                    {/* Filler cell: carries the row color out to the full
                        width of the table, matching the header filler <th>. */}
                    <td className="w-full" style={{ backgroundColor: rowColor || '#fff' }}></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
