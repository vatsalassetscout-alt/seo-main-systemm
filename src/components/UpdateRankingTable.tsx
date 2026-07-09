/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Project } from '../types';
import { Plus, X, ArrowUpDown, Palette, Search, Save, Check, Loader2, ChevronDown } from 'lucide-react';

interface RankingColumn {
  id: string;
  name: string;
}

interface ManualRankingGrid {
  columns: RankingColumn[];
  values: Record<string, Record<string, string>>; // projectId -> columnId -> numeric string
  rowColors: Record<string, string>; // projectId -> hex color
}

interface UpdateRankingTableProps {
  projects: Project[];
  isAdmin?: boolean;
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

export default function UpdateRankingTable({ projects, isAdmin = false }: UpdateRankingTableProps) {
  const [grid, setGrid] = useState<ManualRankingGrid>(EMPTY_GRID);
  const [isLoading, setIsLoading] = useState(true);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [searchTerm, setSearchTerm] = useState('');

  // Sort filter (High to Low / Low to High) applied to one chosen column
  const [sortColumnId, setSortColumnId] = useState<string>('');
  const [sortDirection, setSortDirection] = useState<'desc' | 'asc'>('desc');
  const [sortPanelOpen, setSortPanelOpen] = useState(false);

  // Color-tagging filter mode
  const [colorModeOn, setColorModeOn] = useState(false);
  const [selectedRowIds, setSelectedRowIds] = useState<Record<string, boolean>>({});
  const [customColor, setCustomColor] = useState('#c7d2fe');

  const skipNextAutoSave = useRef(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load saved grid on mount (data lives only in the Supabase "manual_rankings" table)
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/manual-rankings');
        if (res.ok) {
          const data = await res.json();
          setGrid({
            columns: Array.isArray(data.columns) ? data.columns : [],
            values: data.values && typeof data.values === 'object' ? data.values : {},
            rowColors: data.rowColors && typeof data.rowColors === 'object' ? data.rowColors : {}
          });
        }
      } catch (e) {
        console.error('Failed to load Update Ranking data:', e);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

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
        console.error('Failed to save Update Ranking data:', e);
        setSaveState('error');
      }
    }, 400);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid]);

  const addColumn = () => {
    const name = window.prompt('Name this new ranking column (e.g. "Week 1", "July Check"):');
    if (!name || !name.trim()) return;
    const newCol: RankingColumn = {
      id: `col-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: name.trim()
    };
    setGrid(prev => ({ ...prev, columns: [...prev.columns, newCol] }));
  };

  const renameColumn = (colId: string) => {
    const current = grid.columns.find(c => c.id === colId);
    const name = window.prompt('Rename column:', current?.name || '');
    if (!name || !name.trim()) return;
    setGrid(prev => ({
      ...prev,
      columns: prev.columns.map(c => c.id === colId ? { ...c, name: name.trim() } : c)
    }));
  };

  const deleteColumn = (colId: string) => {
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
  const activeSortColumnName = grid.columns.find(c => c.id === sortColumnId)?.name;

  return (
    <div>
      {/* Toolbar */}
      <div className="p-4 bg-gray-50/50 border-b border-gray-150 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider">Update Ranking</h3>
          <p className="text-[10px] text-gray-500 font-semibold mt-0.5">
            Manually track ranking numbers per project across as many columns as you need.
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

          {/* Sort filter: High to Low / Low to High, applied to a chosen column */}
          <div className="relative">
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
              <div className="absolute right-0 sm:left-0 top-full mt-1.5 w-64 bg-white border border-gray-200 rounded-xl shadow-lg z-30 p-3">
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
                  <p className="text-[11px] text-gray-400 font-semibold">Add a ranking column first.</p>
                ) : (
                  <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
                    {grid.columns.map(col => (
                      <label key={col.id} className="flex items-center gap-2 text-xs font-semibold text-gray-700 cursor-pointer hover:bg-gray-50 rounded-lg px-1.5 py-1">
                        <input
                          type="checkbox"
                          checked={sortColumnId === col.id}
                          onChange={() => chooseSortColumn(col.id)}
                          className="cursor-pointer"
                        />
                        {col.name}
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

          {/* Color tagging filter */}
          <button
            onClick={() => { setColorModeOn(v => !v); setSelectedRowIds({}); }}
            className={`flex items-center gap-1.5 text-xs font-bold border rounded-xl px-2.5 py-2 cursor-pointer transition ${
              colorModeOn ? 'bg-indigo-600 border-indigo-700 text-white' : 'bg-white border-gray-200 hover:bg-gray-50 text-gray-700'
            }`}
          >
            <Palette size={12} />
            Color Tag {colorModeOn ? 'On' : ''}
          </button>
        </div>
      </div>

      {/* Color palette bar - shown once rows are checked in color mode */}
      {colorModeOn && selectedCount > 0 && (
        <div className="mx-4 mt-3 p-3 bg-indigo-50 border border-indigo-150 rounded-xl">
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
        <div className="overflow-x-auto mt-1">
          <table className="text-left text-xs border-collapse w-full">
            <thead className="bg-slate-50/70 text-slate-500 font-extrabold text-[10px] uppercase border-b border-gray-150">
              <tr>
                {colorModeOn && <th className="px-3 py-3 w-10 sticky left-0 bg-slate-50/95 z-20"></th>}
                <th className={`px-3 py-3 w-14 text-center sticky bg-slate-50/95 z-20 ${colorModeOn ? 'left-10' : 'left-0'}`}>Sr No.</th>
                <th className="px-4 py-3 min-w-[180px] sticky bg-slate-50/95 z-20" style={{ left: colorModeOn ? '104px' : '64px' }}>Project Name</th>
                <th className="px-4 py-3 min-w-[160px]">Domain</th>
                <th className="px-4 py-3 min-w-[140px]">Location</th>

                {grid.columns.map(col => (
                  <th key={col.id} className="px-3 py-3 min-w-[130px] group/col relative">
                    <div className="flex items-center justify-between gap-1.5">
                      <button
                        onClick={() => renameColumn(col.id)}
                        className="truncate text-left hover:text-indigo-600 cursor-pointer"
                        title="Click to rename column"
                      >
                        {col.name}
                      </button>
                      <button
                        onClick={() => deleteColumn(col.id)}
                        className="opacity-0 group-hover/col:opacity-100 text-gray-400 hover:text-rose-600 transition cursor-pointer shrink-0"
                        title="Remove column"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  </th>
                ))}

                <th className="px-3 py-3 w-12">
                  <button
                    onClick={addColumn}
                    title="Add a new ranking column"
                    className="w-7 h-7 flex items-center justify-center rounded-lg border border-dashed border-indigo-300 text-indigo-600 hover:bg-indigo-50 cursor-pointer transition"
                  >
                    <Plus size={14} />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-150">
              {visibleProjects.map((proj, idx) => {
                const rowColor = grid.rowColors[proj.id];
                const isChecked = !!selectedRowIds[proj.id];
                return (
                  <tr key={proj.id} style={rowColor ? { backgroundColor: rowColor } : undefined} className="hover:bg-slate-50/60 transition">
                    {colorModeOn && (
                      <td className="px-3 py-2.5 sticky left-0 z-10" style={{ backgroundColor: rowColor || '#fff' }}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => setSelectedRowIds(prev => ({ ...prev, [proj.id]: e.target.checked }))}
                          className="cursor-pointer"
                        />
                      </td>
                    )}
                    <td className={`px-3 py-2.5 text-center font-bold text-gray-500 sticky z-10 ${colorModeOn ? 'left-10' : 'left-0'}`} style={{ backgroundColor: rowColor || '#fff' }}>
                      {idx + 1}
                    </td>
                    <td className="px-4 py-2.5 font-bold text-gray-800 sticky z-10" style={{ left: colorModeOn ? '104px' : '64px', backgroundColor: rowColor || '#fff' }}>
                      {proj.name}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 font-semibold">{proj.domain || '—'}</td>
                    <td className="px-4 py-2.5 text-gray-600 font-semibold">{proj.location || '—'}</td>

                    {grid.columns.map(col => (
                      <td key={col.id} className="px-3 py-2">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={grid.values[proj.id]?.[col.id] || ''}
                          onChange={(e) => updateCell(proj.id, col.id, e.target.value)}
                          placeholder="—"
                          className="w-full text-xs font-bold text-gray-800 px-2 py-1.5 border border-transparent hover:border-gray-200 focus:border-indigo-400 rounded-lg focus:outline-hidden bg-transparent focus:bg-white transition"
                        />
                      </td>
                    ))}

                    <td></td>
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
