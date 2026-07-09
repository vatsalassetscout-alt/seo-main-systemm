/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Project } from '../types';
import { Plus, X, ArrowUpDown, Palette, Search, Save, Check, Loader2 } from 'lucide-react';

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

// Palette offered for the row color-tagging filter
const COLOR_SWATCHES = [
  { label: 'Green', value: '#d1fae5' },
  { label: 'Yellow', value: '#fef9c3' },
  { label: 'Orange', value: '#ffedd5' },
  { label: 'Red', value: '#fee2e2' },
  { label: 'Blue', value: '#dbeafe' },
  { label: 'Purple', value: '#ede9fe' },
  { label: 'Gray', value: '#e5e7eb' },
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

  // Sort filter (High to Low / Low to High on a chosen dynamic column)
  const [sortColumnId, setSortColumnId] = useState<string>('');
  const [sortDirection, setSortDirection] = useState<'desc' | 'asc'>('desc');

  // Color-tagging filter mode
  const [colorModeOn, setColorModeOn] = useState(false);
  const [selectedRowIds, setSelectedRowIds] = useState<Record<string, boolean>>({});

  const skipNextAutoSave = useRef(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load saved grid on mount
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
        console.error('Failed to load Update Ranking grid:', e);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  // Debounced auto-save whenever the grid changes (skip the very first load)
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
        console.error('Failed to save Update Ranking grid:', e);
        setSaveState('error');
      }
    }, 700);
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

        <div className="flex items-center gap-2 flex-wrap">
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

          {isAdmin && (
            <>
              {/* Sort filter (High to Low / Low to High) */}
              <select
                value={sortColumnId}
                onChange={(e) => setSortColumnId(e.target.value)}
                className="text-xs font-bold border border-gray-200 rounded-xl px-2.5 py-2 bg-white focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
              >
                <option value="">Sort: None</option>
                {grid.columns.map(c => (
                  <option key={c.id} value={c.id}>Sort by "{c.name}"</option>
                ))}
              </select>
              {sortColumnId && (
                <button
                  onClick={() => setSortDirection(d => d === 'desc' ? 'asc' : 'desc')}
                  className="flex items-center gap-1 text-xs font-bold border border-gray-200 rounded-xl px-2.5 py-2 bg-white hover:bg-gray-50 cursor-pointer"
                  title="Toggle sort direction"
                >
                  <ArrowUpDown size={12} />
                  {sortDirection === 'desc' ? 'High → Low' : 'Low → High'}
                </button>
              )}

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
            </>
          )}
        </div>
      </div>

      {/* Color palette bar - shown once rows are checked in color mode */}
      {colorModeOn && selectedCount > 0 && (
        <div className="mx-4 mt-3 p-2.5 bg-indigo-50 border border-indigo-150 rounded-xl flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold text-indigo-800">{selectedCount} row{selectedCount > 1 ? 's' : ''} selected —</span>
          {COLOR_SWATCHES.map(sw => (
            <button
              key={sw.value}
              title={sw.label}
              onClick={() => applyColorToSelected(sw.value)}
              className="w-6 h-6 rounded-full border-2 border-white shadow-2xs cursor-pointer hover:scale-110 transition"
              style={{ backgroundColor: sw.value }}
            />
          ))}
          <button
            onClick={clearColorFromSelected}
            className="text-[10px] font-bold text-gray-600 hover:text-rose-600 px-2 py-1 rounded-lg hover:bg-white transition cursor-pointer"
          >
            Clear color
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="p-12 text-center text-xs text-gray-500 font-bold">Loading ranking sheet...</div>
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
